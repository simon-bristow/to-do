import type { Source, SyncableField, TaskContext } from "@/db/schema";

/** A task as reported by a source system, normalised to app fields. */
export type RemoteTask = {
  externalId: string;
  externalUrl?: string | null;
  title: string;
  notes: string;
  dueDate: string | null; // YYYY-MM-DD, app timezone
  dueTime: string | null; // HH:MM, app timezone
  done: boolean;
  updatedAt: Date;
  context?: TaskContext | null;
};

export type RemotePatch = Partial<{
  title: string;
  notes: string;
  dueDate: string | null;
  dueTime: string | null;
  done: boolean;
}>;

/** What a missing item turned out to be when looked up individually. */
export type LookupResult = { kind: "found"; task: RemoteTask } | { kind: "gone" };

export interface Provider {
  source: Exclude<Source, "local">;
  /** True when credentials are configured. */
  enabled(): boolean;
  /** All open items that belong in the app. */
  listOpen(): Promise<RemoteTask[]>;
  /** Look up one item that disappeared from listOpen (completed or deleted?). */
  lookup(externalId: string): Promise<LookupResult>;
  update(externalId: string, patch: RemotePatch, fields: SyncableField[]): Promise<void>;
  remove(externalId: string): Promise<void>;
}
