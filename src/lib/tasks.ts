import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { syncRuns, tasks, type Status, type SyncableField, type Task } from "@/db/schema";
import { addDays, todayInTz } from "@/lib/time";

export type TaskInput = {
  title?: string;
  notes?: string;
  dueDate?: string | null;
  dueTime?: string | null;
  status?: Status;
};

/** Visible tasks: not deleted; done ones only for the last 14 days. */
export async function listTasks(): Promise<Task[]> {
  const cutoff = new Date(`${addDays(todayInTz(), -14)}T00:00:00Z`);
  return db
    .select()
    .from(tasks)
    .where(and(isNull(tasks.deletedAt), or(sql`${tasks.status} <> 'done'`, gte(tasks.completedAt, cutoff))))
    .orderBy(sql`${tasks.dueDate} asc nulls last`, sql`${tasks.dueTime} asc nulls last`, desc(tasks.createdAt));
}

export async function lastSync() {
  const [row] = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1);
  return row ?? null;
}

export async function createTask(input: TaskInput) {
  const [row] = await db
    .insert(tasks)
    .values({
      source: "local",
      title: input.title?.trim() || "Untitled",
      notes: input.notes ?? "",
      dueDate: input.dueDate || null,
      dueTime: input.dueDate ? input.dueTime || null : null,
      status: input.status ?? "todo",
      completedAt: input.status === "done" ? new Date() : null,
    })
    .returning();
  return row;
}

/** Apply an edit and record which fields need pushing to the source. */
export async function updateTask(id: string, input: TaskInput) {
  const [cur] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!cur || cur.deletedAt) throw new Error("Task not found");

  const next: Partial<Task> = {};
  const dirty = new Set<SyncableField>(cur.dirtyFields);
  if (input.title !== undefined && input.title.trim() !== cur.title) {
    next.title = input.title.trim() || "Untitled";
    dirty.add("title");
  }
  if (input.notes !== undefined && input.notes !== cur.notes) {
    next.notes = input.notes;
    dirty.add("notes");
  }
  if (input.dueDate !== undefined && (input.dueDate || null) !== cur.dueDate) {
    next.dueDate = input.dueDate || null;
    dirty.add("dueDate");
  }
  const dueTime = input.dueTime === undefined ? undefined : (next.dueDate ?? cur.dueDate) ? input.dueTime || null : null;
  if (dueTime !== undefined && dueTime !== cur.dueTime) {
    next.dueTime = dueTime;
    dirty.add("dueTime");
  }
  if (next.dueDate === null && cur.dueTime) {
    next.dueTime = null;
    dirty.add("dueTime");
  }
  if (input.status !== undefined && input.status !== cur.status) {
    next.status = input.status;
    next.completedAt = input.status === "done" ? new Date() : null;
    // Sources only know done / not done; "in progress" lives in the app.
    if ((input.status === "done") !== (cur.status === "done")) dirty.add("done");
  }
  if (!Object.keys(next).length) return cur;

  const [row] = await db
    .update(tasks)
    .set({
      ...next,
      localUpdatedAt: new Date(),
      dirtyFields: cur.source === "local" ? [] : [...dirty],
    })
    .where(eq(tasks.id, id))
    .returning();
  return row;
}

/** Local tasks are removed now; synced tasks are tombstoned until the source delete succeeds. */
export async function deleteTask(id: string) {
  const [cur] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!cur) return;
  if (cur.source === "local") await db.delete(tasks).where(eq(tasks.id, id));
  else await db.update(tasks).set({ deletedAt: new Date(), localUpdatedAt: new Date() }).where(eq(tasks.id, id));
}
