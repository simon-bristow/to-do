import { describe, expect, it } from "vitest";
import type { Task } from "@/db/schema";
import { reconcile, remoteToLocal } from "@/lib/sync/reconcile";
import type { RemoteTask } from "@/lib/sync/types";

const t0 = new Date("2026-11-01T00:00:00Z");
const later = (mins: number) => new Date(t0.getTime() + mins * 60_000);

function local(over: Partial<Task> = {}): Task {
  return {
    id: "L1", source: "pipedrive", externalId: "1", externalUrl: null, title: "A", notes: "",
    dueDate: null, dueTime: null, status: "todo", completedAt: null, context: null,
    localUpdatedAt: t0, remoteUpdatedAt: t0, dirtyFields: [], deletedAt: null, syncError: null, createdAt: t0,
    ...over,
  };
}
function remote(over: Partial<RemoteTask> = {}): RemoteTask {
  return { externalId: "1", title: "A", notes: "", dueDate: null, dueTime: null, done: false, updatedAt: t0, ...over };
}

describe("reconcile", () => {
  it("inserts new remote items", () => {
    const p = reconcile([], [remote()]);
    expect(p.insert).toHaveLength(1);
  });

  it("does nothing when unchanged", () => {
    const p = reconcile([local()], [remote()]);
    expect(p).toEqual({ insert: [], applyRemote: [], push: [], removeRemote: [], missing: [] });
  });

  it("applies remote changes when local is clean", () => {
    const p = reconcile([local()], [remote({ title: "B", updatedAt: later(5) })]);
    expect(p.applyRemote).toHaveLength(1);
  });

  it("pushes local edits when remote is unchanged", () => {
    const p = reconcile([local({ dirtyFields: ["title"], localUpdatedAt: later(1) })], [remote()]);
    expect(p.push).toEqual([expect.objectContaining({ fields: ["title"] })]);
  });

  it("most recent edit wins: local newer than remote change", () => {
    const p = reconcile(
      [local({ dirtyFields: ["title"], localUpdatedAt: later(10) })],
      [remote({ title: "Remote", updatedAt: later(5) })],
    );
    expect(p.push).toHaveLength(1);
    expect(p.applyRemote).toHaveLength(0);
  });

  it("most recent edit wins: remote newer than local edit", () => {
    const p = reconcile(
      [local({ dirtyFields: ["title"], localUpdatedAt: later(5) })],
      [remote({ title: "Remote", updatedAt: later(10) })],
    );
    expect(p.applyRemote).toHaveLength(1);
    expect(p.push).toHaveLength(0);
  });

  it("deletes remotely when deleted in the app, and never re-inserts", () => {
    const p = reconcile([local({ deletedAt: later(1) })], [remote()]);
    expect(p.removeRemote).toHaveLength(1);
    expect(p.insert).toHaveLength(0);
  });

  it("looks up open local items that vanished from the source", () => {
    const p = reconcile([local()], []);
    expect(p.missing).toHaveLength(1);
  });

  it("pushes completion of items that are no longer open remotely", () => {
    const p = reconcile([local({ status: "done", dirtyFields: ["done"] })], []);
    expect(p.push).toHaveLength(1);
    expect(p.missing).toHaveLength(0);
  });

  it("ignores done, clean items that are no longer open remotely", () => {
    const p = reconcile([local({ status: "done" })], []);
    expect(p.missing).toHaveLength(0);
  });
});

describe("remoteToLocal", () => {
  it("keeps in-progress status while remote is open", () => {
    expect(remoteToLocal({ status: "in_progress", completedAt: null }, remote()).status).toBe("in_progress");
  });
  it("marks done when remote is done", () => {
    const r = remoteToLocal({ status: "in_progress", completedAt: null }, remote({ done: true }));
    expect(r.status).toBe("done");
    expect(r.completedAt).toBeInstanceOf(Date);
  });
  it("reopens when remote is reopened", () => {
    expect(remoteToLocal({ status: "done", completedAt: t0 }, remote()).status).toBe("todo");
  });
});
