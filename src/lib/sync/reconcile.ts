import type { SyncableField, Task } from "@/db/schema";
import type { RemoteTask } from "./types";

export type Plan = {
  /** Remote items not yet in the app. */
  insert: RemoteTask[];
  /** Local rows to overwrite with newer remote data. */
  applyRemote: { task: Task; remote: RemoteTask }[];
  /** Local edits to push (local edit is the most recent). */
  push: { task: Task; fields: SyncableField[] }[];
  /** Deleted in the app; delete in the source. */
  removeRemote: Task[];
  /** Local rows whose remote item is no longer open; look them up individually. */
  missing: Task[];
};

/**
 * Decide what to do for one source, using "most recent edit wins" per task.
 * Pure function: no I/O, so it can be unit tested.
 */
export function reconcile(locals: Task[], remotes: RemoteTask[]): Plan {
  const plan: Plan = { insert: [], applyRemote: [], push: [], removeRemote: [], missing: [] };
  const byExt = new Map(locals.filter((t) => t.externalId).map((t) => [t.externalId!, t]));
  const seen = new Set<string>();

  for (const remote of remotes) {
    seen.add(remote.externalId);
    const local = byExt.get(remote.externalId);
    if (!local) {
      plan.insert.push(remote);
      continue;
    }
    if (local.deletedAt) continue; // handled below

    const remoteChanged =
      !local.remoteUpdatedAt || remote.updatedAt.getTime() > local.remoteUpdatedAt.getTime();
    const localDirty = local.dirtyFields.length > 0;

    if (localDirty && (!remoteChanged || local.localUpdatedAt >= remote.updatedAt)) {
      plan.push.push({ task: local, fields: local.dirtyFields });
    } else if (remoteChanged) {
      plan.applyRemote.push({ task: local, remote });
    }
  }

  for (const local of locals) {
    if (!local.externalId) continue;
    if (local.deletedAt) {
      plan.removeRemote.push(local);
      continue;
    }
    if (seen.has(local.externalId)) continue;
    if (local.dirtyFields.length > 0) {
      // e.g. completed in the app but not yet pushed: push, don't look up.
      plan.push.push({ task: local, fields: local.dirtyFields });
    } else if (local.status !== "done") {
      plan.missing.push(local);
    }
  }
  return plan;
}

/** Local field values to write when remote data wins. */
export function remoteToLocal(local: Pick<Task, "status" | "completedAt"> | null, r: RemoteTask) {
  let status = local?.status ?? "todo";
  let completedAt = local?.completedAt ?? null;
  if (r.done) {
    if (status !== "done") completedAt = new Date();
    status = "done";
  } else if (status === "done") {
    status = "todo";
    completedAt = null;
  }
  return {
    title: r.title,
    notes: r.notes,
    dueDate: r.dueDate,
    dueTime: r.dueTime,
    context: r.context ?? null,
    externalUrl: r.externalUrl ?? null,
    remoteUpdatedAt: r.updatedAt,
    status,
    completedAt,
    dirtyFields: [] as SyncableField[],
    syncError: null,
  };
}
