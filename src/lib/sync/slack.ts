import { WebClient } from "@slack/web-api";
import type { SyncableField } from "@/db/schema";
import type { LookupResult, Provider, RemotePatch, RemoteTask } from "./types";

/** Loose shape of a List item field: the API returns typed values plus `text`/`value`. */
type Field = {
  column_id?: string;
  key?: string;
  text?: string;
  value?: unknown;
  checkbox?: boolean;
  date?: string[];
  rich_text?: unknown[];
};
type Item = { id?: string; fields?: Field[]; updated_timestamp?: string; date_created?: number };
type Column = { id?: string; key?: string; name?: string; type?: string; is_primary_column?: boolean };

export type ColumnMap = { title?: string; done?: string; due?: string; notes?: string };

const env = () => ({
  token: process.env.SLACK_USER_TOKEN ?? "",
  listId: process.env.SLACK_LIST_ID ?? "",
  overrides: {
    title: process.env.SLACK_COL_TITLE || undefined,
    done: process.env.SLACK_COL_DONE || undefined,
    due: process.env.SLACK_COL_DUE || undefined,
    notes: process.env.SLACK_COL_NOTES || undefined,
  } as ColumnMap,
});

/** Work out which columns hold title / done / due date / notes. */
export function detectColumns(schema: Column[], overrides: ColumnMap = {}): ColumnMap {
  const id = (c?: Column) => c?.id ?? c?.key;
  const find = (pred: (c: Column) => boolean) => id(schema.find(pred));
  const t = (c: Column) => (c.type ?? "").toLowerCase();
  const n = (c: Column) => `${c.key ?? ""} ${c.name ?? ""}`.toLowerCase();

  const title = overrides.title ?? find((c) => !!c.is_primary_column) ?? find((c) => t(c) === "text");
  const done =
    overrides.done ??
    find((c) => t(c) === "todo_completed") ??
    find((c) => t(c) === "checkbox" && /complete|done/.test(n(c))) ??
    find((c) => t(c) === "checkbox");
  const due =
    overrides.due ??
    find((c) => t(c) === "todo_due_date") ??
    find((c) => t(c) === "date" && /due/.test(n(c))) ??
    find((c) => t(c) === "date");
  const notes =
    overrides.notes ??
    find((c) => id(c) !== title && ["text", "rich_text"].includes(t(c)) && /note|description|detail/.test(n(c)));
  return { title, done, due, notes };
}

function fieldFor(item: Item, col?: string) {
  if (!col) return undefined;
  return item.fields?.find((f) => f.column_id === col || f.key === col);
}

function richTextToPlain(blocks: unknown): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (typeof o.text === "string") out.push(o.text);
    else if (o.type === "link" && typeof o.url === "string") out.push(o.url);
    if (Array.isArray(o.elements)) o.elements.forEach(walk);
    if (o.type === "rich_text_section" || o.type === "rich_text_preformatted") out.push("\n");
  };
  if (Array.isArray(blocks)) blocks.forEach(walk);
  return out.join("").replace(/\n+$/, "");
}

const textOf = (f?: Field) => (f ? (f.text ?? richTextToPlain(f.rich_text)).trim() : "");
const boolOf = (f?: Field) => Boolean(f?.checkbox ?? (typeof f?.value === "boolean" ? f.value : false));
function dateOf(f?: Field): string | null {
  const v = f?.date?.[0] ?? (typeof f?.value === "string" ? f.value : undefined);
  return v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

export function itemToRemote(item: Item, cols: ColumnMap, listUrl?: string): RemoteTask {
  const ts = Number(item.updated_timestamp ?? item.date_created ?? 0);
  return {
    externalId: item.id!,
    externalUrl: listUrl ?? null,
    title: textOf(fieldFor(item, cols.title)) || "(untitled)",
    notes: textOf(fieldFor(item, cols.notes)),
    dueDate: dateOf(fieldFor(item, cols.due)),
    dueTime: null, // Slack List date columns have no time
    done: boolOf(fieldFor(item, cols.done)),
    updatedAt: new Date(ts * 1000),
    context: null,
  };
}

const richText = (text: string) => [
  { type: "rich_text", elements: [{ type: "rich_text_section", elements: [{ type: "text", text }] }] },
];

export function patchToCells(rowId: string, p: RemotePatch, cols: ColumnMap) {
  const cells: Record<string, unknown>[] = [];
  if (p.title !== undefined && cols.title) cells.push({ row_id: rowId, column_id: cols.title, rich_text: richText(p.title) });
  if (p.notes !== undefined && cols.notes) cells.push({ row_id: rowId, column_id: cols.notes, rich_text: richText(p.notes) });
  if (p.done !== undefined && cols.done) cells.push({ row_id: rowId, column_id: cols.done, checkbox: p.done });
  if (p.dueDate !== undefined && cols.due) cells.push({ row_id: rowId, column_id: cols.due, date: p.dueDate ? [p.dueDate] : [] });
  return cells;
}

let cache: { cols: ColumnMap; listUrl?: string } | null = null;

function client() {
  return new WebClient(env().token);
}

async function listItems(archived = false): Promise<Item[]> {
  const { listId } = env();
  const out: Item[] = [];
  let cursor: string | undefined;
  do {
    const res = await client().slackLists.items.list({ list_id: listId, limit: 100, cursor, archived });
    out.push(...((res.items ?? []) as Item[]));
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return out;
}

/** Fetch the List schema (via any item's info) and detect column mapping. */
export async function describeList(sampleItemId?: string) {
  const { listId, overrides } = env();
  const id = sampleItemId ?? (await listItems())[0]?.id;
  if (!id) return { cols: overrides, listUrl: undefined, schema: [] as Column[] };
  const info = (await client().slackLists.items.info({ list_id: listId, id })) as {
    list?: { permalink?: string; list_metadata?: { schema?: Column[] } };
  };
  const schema = info.list?.list_metadata?.schema ?? [];
  return { cols: detectColumns(schema, overrides), listUrl: info.list?.permalink, schema };
}

async function columns(sampleItemId?: string) {
  if (!cache) {
    const d = await describeList(sampleItemId);
    if (d.schema.length) cache = { cols: d.cols, listUrl: d.listUrl };
    return d;
  }
  return cache;
}

export const slack: Provider = {
  source: "slack",
  enabled: () => Boolean(env().token && env().listId),
  async listOpen() {
    const items = await listItems();
    if (!items.length) return [];
    const { cols, listUrl } = await columns(items[0].id);
    return items.map((i) => itemToRemote(i, cols, listUrl)).filter((r) => !r.done);
  },
  async lookup(id): Promise<LookupResult> {
    try {
      const res = (await client().slackLists.items.info({ list_id: env().listId, id })) as { record?: Item };
      if (!res.record) return { kind: "gone" };
      const { cols, listUrl } = await columns(id);
      return { kind: "found", task: itemToRemote(res.record, cols, listUrl) };
    } catch (e) {
      const code = (e as { data?: { error?: string } }).data?.error;
      if (code === "row_not_found" || code === "item_not_found" || code === "record_not_found") return { kind: "gone" };
      throw e;
    }
  },
  async update(id, patch, _fields: SyncableField[]) {
    const { cols } = await columns(id);
    const cells = patchToCells(id, patch, cols);
    if (!cells.length) return;
    // Cast: SDK types are stricter than the union we build here.
    await client().slackLists.items.update({ list_id: env().listId, cells } as never);
  },
  async remove(id) {
    try {
      await client().slackLists.items.delete({ list_id: env().listId, id });
    } catch (e) {
      const code = (e as { data?: { error?: string } }).data?.error;
      if (code === "row_not_found" || code === "item_not_found") return;
      throw e;
    }
  },
};
