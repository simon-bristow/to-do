import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const SOURCES = ["local", "pipedrive", "slack"] as const;
export type Source = (typeof SOURCES)[number];

export const STATUSES = ["todo", "in_progress", "done"] as const;
export type Status = (typeof STATUSES)[number];

/** Fields that can be edited in the app and pushed back to a source. */
export const SYNCABLE_FIELDS = ["title", "notes", "dueDate", "dueTime", "done"] as const;
export type SyncableField = (typeof SYNCABLE_FIELDS)[number];

export type TaskContext = {
  type?: string;
  deal?: { id: number; title: string; url: string };
  person?: {
    id: number;
    name: string;
    url: string;
    emails: string[];
    phones: string[];
  };
  org?: { id: number; name: string; url: string };
};

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").$type<Source>().notNull().default("local"),
    /** ID of the item in the source system (null for local tasks). */
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    title: text("title").notNull(),
    /** Plain text; URLs are auto-linked in the UI. */
    notes: text("notes").notNull().default(""),
    /** YYYY-MM-DD in the app timezone. */
    dueDate: text("due_date"),
    /** HH:MM in the app timezone. */
    dueTime: text("due_time"),
    status: text("status").$type<Status>().notNull().default("todo"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    context: jsonb("context").$type<TaskContext>(),
    /** Last time the task was edited in the app. */
    localUpdatedAt: timestamp("local_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Source's own update time, as of the last pull. */
    remoteUpdatedAt: timestamp("remote_updated_at", { withTimezone: true }),
    /** Fields edited locally that still need pushing to the source. */
    dirtyFields: text("dirty_fields").array().$type<SyncableField[]>().notNull().default([]),
    /** Set when deleted in the app; row is removed once the source delete succeeds. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    syncError: text("sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tasks_source_external_id").on(t.source, t.externalId),
    index("tasks_due_date").on(t.dueDate),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").$type<Source>().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ok: text("ok"),
  summary: jsonb("summary"),
});
