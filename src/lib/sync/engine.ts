import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { syncRuns, tasks, type Source, type SyncableField, type Task } from "@/db/schema";
import { reconcile, remoteToLocal } from "./reconcile";
import type { Provider, RemotePatch } from "./types";
import { providers } from "./providers";

function patchFor(task: Task, fields: SyncableField[]): RemotePatch {
  const p: RemotePatch = {};
  for (const f of fields) {
    if (f === "done") p.done = task.status === "done";
    else if (f === "title") p.title = task.title;
    else if (f === "notes") p.notes = task.notes;
    else if (f === "dueDate") p.dueDate = task.dueDate;
    else if (f === "dueTime") p.dueTime = task.dueTime;
  }
  // Pipedrive needs date and time together.
  if ("dueTime" in p && !("dueDate" in p)) p.dueDate = task.dueDate;
  return p;
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

async function pushOne(provider: Provider, task: Task, fields: SyncableField[]) {
  try {
    await provider.update(task.externalId!, patchFor(task, fields), fields);
    // Only clear the fields we pushed; the user may have edited again meanwhile.
    const [fresh] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    const editedSince = fresh && fresh.localUpdatedAt > task.localUpdatedAt;
    const remaining = (fresh?.dirtyFields ?? []).filter((f) => editedSince || !fields.includes(f));
    await db
      .update(tasks)
      .set({ dirtyFields: remaining, syncError: null, remoteUpdatedAt: new Date() })
      .where(eq(tasks.id, task.id));
    return true;
  } catch (e) {
    await db.update(tasks).set({ syncError: errMsg(e) }).where(eq(tasks.id, task.id));
    return false;
  }
}

async function removeOne(provider: Provider, task: Task) {
  try {
    await provider.remove(task.externalId!);
    await db.delete(tasks).where(eq(tasks.id, task.id));
    return true;
  } catch (e) {
    await db.update(tasks).set({ syncError: errMsg(e) }).where(eq(tasks.id, task.id));
    return false;
  }
}

/** Push a single task's pending change right away (called after an edit in the app). */
export async function pushTask(id: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task || task.source === "local" || !task.externalId) return;
  const provider = providers.find((p) => p.source === task.source);
  if (!provider?.enabled()) return;
  if (task.deletedAt) await removeOne(provider, task);
  else if (task.dirtyFields.length) await pushOne(provider, task, task.dirtyFields);
}

export async function syncSource(provider: Provider) {
  const [run] = await db.insert(syncRuns).values({ source: provider.source }).returning();
  const summary = { inserted: 0, updated: 0, pushed: 0, removed: 0, completed: 0, gone: 0, errors: 0 };
  try {
    const remotes = await provider.listOpen();
    const locals = await db.select().from(tasks).where(eq(tasks.source, provider.source));
    const plan = reconcile(locals, remotes);

    if (plan.insert.length) {
      await db
        .insert(tasks)
        .values(plan.insert.map((r) => ({ source: provider.source as Source, externalId: r.externalId, ...remoteToLocal(null, r) })))
        .onConflictDoNothing();
      summary.inserted = plan.insert.length;
    }
    for (const { task, remote } of plan.applyRemote) {
      await db.update(tasks).set(remoteToLocal(task, remote)).where(eq(tasks.id, task.id));
      summary.updated++;
    }
    for (const { task, fields } of plan.push) {
      if (await pushOne(provider, task, fields)) summary.pushed++;
      else summary.errors++;
    }
    for (const task of plan.removeRemote) {
      if (await removeOne(provider, task)) summary.removed++;
      else summary.errors++;
    }
    const goneIds: string[] = [];
    for (const task of plan.missing) {
      try {
        const res = await provider.lookup(task.externalId!);
        if (res.kind === "gone") goneIds.push(task.id);
        else {
          await db.update(tasks).set(remoteToLocal(task, res.task)).where(eq(tasks.id, task.id));
          if (res.task.done) summary.completed++;
        }
      } catch (e) {
        summary.errors++;
        await db.update(tasks).set({ syncError: errMsg(e) }).where(eq(tasks.id, task.id));
      }
    }
    if (goneIds.length) {
      await db.delete(tasks).where(and(eq(tasks.source, provider.source), inArray(tasks.id, goneIds)));
      summary.gone = goneIds.length;
    }
    await db.update(syncRuns).set({ finishedAt: new Date(), ok: "true", summary }).where(eq(syncRuns.id, run.id));
    return { source: provider.source, ok: true, ...summary };
  } catch (e) {
    const error = errMsg(e);
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), ok: "false", summary: { ...summary, error } })
      .where(eq(syncRuns.id, run.id));
    return { source: provider.source, ok: false, error, ...summary };
  }
}

export async function syncAll() {
  const results = [];
  for (const p of providers) {
    if (p.enabled()) results.push(await syncSource(p));
    else results.push({ source: p.source, ok: true, skipped: "not configured" });
  }
  return results;
}
