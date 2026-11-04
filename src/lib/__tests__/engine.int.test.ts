/**
 * Integration test: runs the sync engine against a real Postgres (DATABASE_URL)
 * with an in-memory fake provider. Skipped unless TEST_DATABASE_URL is set.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupResult, Provider, RemotePatch, RemoteTask } from "@/lib/sync/types";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
if (url) process.env.DATABASE_URL = url;

class FakeProvider implements Provider {
  source = "pipedrive" as const;
  items = new Map<string, RemoteTask>();
  calls: string[] = [];
  enabled = () => true;
  async listOpen() {
    return [...this.items.values()].filter((t) => !t.done);
  }
  async lookup(id: string): Promise<LookupResult> {
    const t = this.items.get(id);
    return t ? { kind: "found", task: t } : { kind: "gone" };
  }
  async update(id: string, patch: RemotePatch) {
    this.calls.push(`update ${id} ${JSON.stringify(patch)}`);
    const t = this.items.get(id)!;
    this.items.set(id, { ...t, ...patch, updatedAt: new Date() });
  }
  async remove(id: string) {
    this.calls.push(`remove ${id}`);
    this.items.delete(id);
  }
}

const fake = new FakeProvider();
vi.mock("@/lib/sync/providers", () => ({ providers: [fake] }));

const remote = (id: string, over: Partial<RemoteTask> = {}): RemoteTask => ({
  externalId: id, title: `Task ${id}`, notes: "", dueDate: "2026-11-05", dueTime: null, done: false,
  updatedAt: new Date(Date.now() - 60_000), ...over,
});

d("sync engine (integration)", () => {
  let db: typeof import("@/db").db;
  let schema: typeof import("@/db/schema");
  let engine: typeof import("@/lib/sync/engine");
  let svc: typeof import("@/lib/tasks");

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    schema = await import("@/db/schema");
    engine = await import("@/lib/sync/engine");
    svc = await import("@/lib/tasks");
  });
  beforeEach(async () => {
    await db.delete(schema.tasks);
    fake.items.clear();
    fake.calls = [];
  });
  const rows = () => db.select().from(schema.tasks);

  it("pulls new items, then pushes completion and deletion", async () => {
    fake.items.set("1", remote("1"));
    fake.items.set("2", remote("2"));
    await engine.syncSource(fake);
    let all = await rows();
    expect(all.map((t) => t.title).sort()).toEqual(["Task 1", "Task 2"]);

    const t1 = all.find((t) => t.externalId === "1")!;
    const t2 = all.find((t) => t.externalId === "2")!;
    await svc.updateTask(t1.id, { status: "done" });
    await engine.pushTask(t1.id);
    expect(fake.items.get("1")!.done).toBe(true);

    await svc.deleteTask(t2.id);
    await engine.pushTask(t2.id);
    expect(fake.items.has("2")).toBe(false);

    await engine.syncSource(fake);
    all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ externalId: "1", status: "done", dirtyFields: [] });
  });

  it("in-progress is app-only and survives a pull", async () => {
    fake.items.set("1", remote("1"));
    await engine.syncSource(fake);
    const [t] = await rows();
    await svc.updateTask(t.id, { status: "in_progress" });
    expect((await rows())[0].dirtyFields).toEqual([]); // nothing to push
    fake.items.set("1", remote("1", { title: "Renamed remotely", updatedAt: new Date(Date.now() + 1000) }));
    await engine.syncSource(fake);
    expect((await rows())[0]).toMatchObject({ title: "Renamed remotely", status: "in_progress" });
  });

  it("marks done when completed in the source, removes when deleted in the source", async () => {
    fake.items.set("1", remote("1"));
    fake.items.set("2", remote("2"));
    await engine.syncSource(fake);
    fake.items.set("1", remote("1", { done: true, updatedAt: new Date() }));
    fake.items.delete("2");
    const res = await engine.syncSource(fake);
    expect(res).toMatchObject({ completed: 1, gone: 1 });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("done");
  });

  it("local edit newer than remote is pushed during sync", async () => {
    fake.items.set("1", remote("1"));
    await engine.syncSource(fake);
    const [t] = await rows();
    await svc.updateTask(t.id, { title: "Edited in app", dueTime: "09:30" });
    await engine.syncSource(fake);
    expect(fake.calls[0]).toContain('"title":"Edited in app"');
    expect(fake.calls[0]).toContain('"dueTime":"09:30"');
    expect((await rows())[0].dirtyFields).toEqual([]);
  });
});
