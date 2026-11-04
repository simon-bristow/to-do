import type { TaskContext } from "@/db/schema";
import { htmlToText, textToHtml } from "@/lib/notes";
import { localToUtc, utcToLocal } from "@/lib/time";
import type { LookupResult, Provider, RemotePatch, RemoteTask } from "./types";

type Activity = {
  id: number;
  subject: string;
  type: string;
  owner_id: number;
  is_deleted?: boolean;
  update_time: string;
  deal_id: number | null;
  person_id: number | null;
  org_id: number | null;
  due_date: string | null;
  due_time: string | null; // UTC, "HH:MM" or "HH:MM:SS"
  done: boolean;
  note: string | null;
  participants?: { person_id: number; primary: boolean }[];
};

type Labeled = { value: string; primary?: boolean };

const env = () => ({
  token: process.env.PIPEDRIVE_API_TOKEN ?? "",
  domain: process.env.PIPEDRIVE_COMPANY_DOMAIN ?? "",
  userId: process.env.PIPEDRIVE_USER_ID ?? "",
});

export class PipedriveError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { token, domain } = env();
  const res = await fetch(`https://${domain}.pipedrive.com/api/v2${path}`, {
    ...init,
    headers: { "x-api-token": token, "content-type": "application/json", ...init.headers },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    throw new PipedriveError(`Pipedrive ${init.method ?? "GET"} ${path}: ${res.status} ${body.error ?? ""}`.trim(), res.status);
  }
  return body as T;
}

async function listAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const page = await api<{ data: T[] | null; additional_data?: { next_cursor?: string | null } }>(
      `${path}${sep}limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    out.push(...(page.data ?? []));
    cursor = page.additional_data?.next_cursor ?? undefined;
  } while (cursor);
  return out;
}

async function byIds<T extends { id: number }>(entity: string, ids: number[]) {
  const map = new Map<number, T>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const rows = await listAll<T>(`/${entity}?ids=${chunk.join(",")}`);
    rows.forEach((r) => map.set(r.id, r));
  }
  return map;
}

const values = (xs?: Labeled[] | null) =>
  (xs ?? []).filter((x) => x.value).sort((a, b) => Number(!!b.primary) - Number(!!a.primary)).map((x) => x.value);

export function activityToRemote(
  a: Activity,
  ctx: {
    deals: Map<number, { id: number; title: string }>;
    persons: Map<number, { id: number; name: string; emails?: Labeled[]; phones?: Labeled[] }>;
    orgs: Map<number, { id: number; name: string }>;
  },
  domain: string,
): RemoteTask {
  const base = `https://${domain}.pipedrive.com`;
  let dueDate = a.due_date;
  let dueTime: string | null = null;
  if (a.due_date && a.due_time) {
    const l = utcToLocal(a.due_date, a.due_time);
    dueDate = l.date;
    dueTime = l.time;
  }
  const personId = a.person_id ?? a.participants?.find((p) => p.primary)?.person_id ?? null;
  const deal = a.deal_id ? ctx.deals.get(a.deal_id) : undefined;
  const person = personId ? ctx.persons.get(personId) : undefined;
  const org = a.org_id ? ctx.orgs.get(a.org_id) : undefined;
  const context: TaskContext = { type: a.type };
  if (deal) context.deal = { id: deal.id, title: deal.title, url: `${base}/deal/${deal.id}` };
  if (person)
    context.person = {
      id: person.id,
      name: person.name,
      url: `${base}/person/${person.id}`,
      emails: values(person.emails),
      phones: values(person.phones),
    };
  if (org) context.org = { id: org.id, name: org.name, url: `${base}/organization/${org.id}` };

  // Pipedrive has no standalone activity page; link to the most specific parent.
  const externalUrl = context.deal?.url ?? context.person?.url ?? context.org?.url ?? `${base}/activities/list`;

  return {
    externalId: String(a.id),
    externalUrl,
    title: a.subject,
    notes: htmlToText(a.note),
    dueDate,
    dueTime,
    done: a.done,
    updatedAt: new Date(a.update_time.endsWith("Z") ? a.update_time : `${a.update_time.replace(" ", "T")}Z`),
    context,
  };
}

async function withContext(activities: Activity[]) {
  const { domain } = env();
  const [deals, persons, orgs] = await Promise.all([
    byIds<{ id: number; title: string }>("deals", activities.flatMap((a) => (a.deal_id ? [a.deal_id] : []))),
    byIds<{ id: number; name: string; emails?: Labeled[]; phones?: Labeled[] }>(
      "persons",
      activities.flatMap((a) => {
        const id = a.person_id ?? a.participants?.find((p) => p.primary)?.person_id;
        return id ? [id] : [];
      }),
    ),
    byIds<{ id: number; name: string }>("organizations", activities.flatMap((a) => (a.org_id ? [a.org_id] : []))),
  ]);
  return activities.map((a) => activityToRemote(a, { deals, persons, orgs }, domain));
}

export function patchToActivity(p: RemotePatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (p.title !== undefined) body.subject = p.title;
  if (p.notes !== undefined) body.note = textToHtml(p.notes);
  if (p.done !== undefined) body.done = p.done;
  if (p.dueDate !== undefined || p.dueTime !== undefined) {
    if (p.dueDate && p.dueTime) {
      const u = localToUtc(p.dueDate, p.dueTime);
      body.due_date = u.date;
      body.due_time = u.time;
    } else {
      body.due_date = p.dueDate ?? null;
      body.due_time = null;
    }
  }
  return body;
}

export const pipedrive: Provider = {
  source: "pipedrive",
  enabled: () => {
    const e = env();
    return Boolean(e.token && e.domain && e.userId);
  },
  async listOpen() {
    const { userId } = env();
    const acts = await listAll<Activity>(`/activities?owner_id=${userId}&done=false`);
    return withContext(acts.filter((a) => !a.is_deleted));
  },
  async lookup(id): Promise<LookupResult> {
    try {
      const { data } = await api<{ data: Activity | null }>(`/activities/${id}`);
      if (!data || data.is_deleted || String(data.owner_id) !== env().userId) return { kind: "gone" };
      const [task] = await withContext([data]);
      return { kind: "found", task };
    } catch (e) {
      if (e instanceof PipedriveError && (e.status === 404 || e.status === 410)) return { kind: "gone" };
      throw e;
    }
  },
  async update(id, patch) {
    await api(`/activities/${id}`, { method: "PATCH", body: JSON.stringify(patchToActivity(patch)) });
  },
  async remove(id) {
    try {
      await api(`/activities/${id}`, { method: "DELETE" });
    } catch (e) {
      if (e instanceof PipedriveError && e.status === 404) return; // already gone
      throw e;
    }
  },
};
