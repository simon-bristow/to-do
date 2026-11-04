"use client";

import { useEffect, useEffectEvent, useMemo, useState, useTransition } from "react";
import type { Source, Status, Task } from "@/db/schema";
import { createTaskAction, deleteTaskAction, syncNowAction, updateTaskAction } from "@/app/actions";
import TaskEditor from "./TaskEditor";
import { SourceBadge, dueLabel, isOverdue } from "./bits";

type View = "today" | "upcoming" | "source" | "board";
type Patch = Partial<Pick<Task, "title" | "notes" | "dueDate" | "dueTime" | "status">>;

const VIEWS: { id: View; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "source", label: "By source" },
  { id: "board", label: "Board" },
];

const SOURCE_LABEL: Record<Source, string> = { pipedrive: "Pipedrive", slack: "Slack", local: "App" };
const SYNC_EVERY_MS = 5 * 60_000;

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function matches(t: Task, q: string) {
  if (!q) return true;
  const hay = [t.title, t.notes, t.context?.deal?.title, t.context?.person?.name, t.context?.org?.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

export default function TaskApp(props: {
  tasks: Task[];
  today: string;
  lastSyncAt: string | null;
  connected: Record<string, boolean>;
}) {
  const { today } = props;
  const [tasks, setTasks] = useState(props.tasks);
  const [view, setView] = useState<View>("today");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<Source | "all">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [syncing, startSync] = useTransition();
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState(props.lastSyncAt);

  // Server data wins whenever the page re-renders after an action or sync.
  const [prevProps, setPrevProps] = useState(props);
  if (prevProps !== props) {
    setPrevProps(props);
    setTasks(props.tasks);
    if (props.lastSyncAt) setLastSyncAt(props.lastSyncAt);
  }

  const runSync = (manual = false) =>
    startSync(async () => {
      try {
        const results = await syncNowAction();
        const failed = results.filter((r) => !r.ok);
        setSyncMsg(failed.length ? `Sync failed: ${failed.map((f) => `${f.source} – ${"error" in f ? f.error : ""}`).join("; ")}` : manual ? "Synced" : null);
        setLastSyncAt(new Date().toISOString());
      } catch (e) {
        setSyncMsg(`Sync failed: ${e instanceof Error ? e.message : e}`);
      }
    });

  // Sync on open if stale, then every 5 minutes while the app is visible.
  const onStart = useEffectEvent(() => {
    const stale = !props.lastSyncAt || Date.now() - Date.parse(props.lastSyncAt) > 60_000;
    if (stale) runSync();
  });
  const onTick = useEffectEvent(() => document.visibilityState === "visible" && runSync());
  useEffect(() => {
    onStart();
    const id = setInterval(onTick, SYNC_EVERY_MS);
    return () => clearInterval(id);
  }, []);

  const update = (id: string, patch: Patch) => {
    setTasks((ts) =>
      ts.map((t) =>
        t.id === id
          ? { ...t, ...patch, completedAt: patch.status ? (patch.status === "done" ? new Date() : null) : t.completedAt }
          : t,
      ),
    );
    updateTaskAction(id, patch).catch((e) => setSyncMsg(`Save failed: ${e.message}`));
  };
  const remove = (id: string) => {
    setTasks((ts) => ts.filter((t) => t.id !== id));
    setEditingId(null);
    deleteTaskAction(id).catch((e) => setSyncMsg(`Delete failed: ${e.message}`));
  };
  const create = async (title: string) => {
    const dueDate = view === "today" ? today : null;
    const t = await createTaskAction({ title, dueDate });
    setTasks((ts) => [...ts, t]);
  };

  const visible = useMemo(() => tasks.filter((t) => matches(t, query)), [tasks, query]);
  const open = visible.filter((t) => t.status !== "done");
  const editing = tasks.find((t) => t.id === editingId) ?? null;

  const counts = {
    today: tasks.filter((t) => t.status !== "done" && t.dueDate && t.dueDate <= today).length,
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 pb-24 sm:px-6">
      <header className="sticky top-0 z-10 -mx-4 bg-[var(--bg)]/95 px-4 pt-4 pb-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">To-do</h1>
          <div className="ml-auto flex items-center gap-2 text-xs text-[var(--muted)]">
            <span className="hidden sm:inline">
              {syncing ? "Syncing…" : lastSyncAt ? `Synced ${timeAgo(lastSyncAt)}` : "Not synced yet"}
            </span>
            <button
              onClick={() => runSync(true)}
              disabled={syncing}
              className="rounded-md border border-[var(--line)] bg-[var(--card)] px-2.5 py-1 text-[var(--ink)] hover:bg-[var(--hover)] disabled:opacity-60"
              aria-label="Sync now"
            >
              <span className={syncing ? "inline-block animate-spin" : ""}>↻</span>
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <nav className="flex gap-1 rounded-lg bg-[var(--hover)] p-1 text-sm" aria-label="Views">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={`flex-1 rounded-md px-3 py-1.5 whitespace-nowrap sm:flex-none ${
                  view === v.id ? "bg-[var(--card)] font-medium shadow-sm" : "text-[var(--muted)]"
                }`}
                aria-current={view === v.id}
              >
                {v.label}
                {v.id === "today" && counts.today > 0 && (
                  <span className="ml-1.5 text-xs text-[var(--muted)]">{counts.today}</span>
                )}
              </button>
            ))}
          </nav>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks, notes, deals, people…"
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] sm:ml-auto sm:w-72"
          />
        </div>
        {syncMsg && (
          <p
            role="status"
            className={`mt-2 rounded-md px-3 py-1.5 text-xs ${
              syncMsg.includes("failed") ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--accent-soft)] text-[var(--accent)]"
            }`}
          >
            {syncMsg}
            <button className="float-right" onClick={() => setSyncMsg(null)} aria-label="Dismiss">
              ×
            </button>
          </p>
        )}
        {Object.entries(props.connected).some(([, v]) => !v) && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Not connected:{" "}
            {Object.entries(props.connected)
              .filter(([, v]) => !v)
              .map(([k]) => SOURCE_LABEL[k as Source])
              .join(", ")}{" "}
            — add credentials to enable sync.
          </p>
        )}
      </header>

      <QuickAdd onAdd={create} hint={view === "today" ? "Add a task for today" : "Add a task"} />

      <main className="mt-4">
        {query && view !== "board" ? (
          <Section title={`Results for “${query}”`} tasks={visible} {...{ today, update, setEditingId }} showDone />
        ) : view === "today" ? (
          <TodayView tasks={open} {...{ today, update, setEditingId }} />
        ) : view === "upcoming" ? (
          <UpcomingView tasks={open} {...{ today, update, setEditingId }} />
        ) : view === "source" ? (
          <SourceView tasks={open} filter={sourceFilter} setFilter={setSourceFilter} {...{ today, update, setEditingId }} />
        ) : (
          <BoardView tasks={visible} {...{ today, update, setEditingId }} />
        )}
      </main>

      {editing && (
        <TaskEditor
          key={editing.id}
          task={editing}
          today={today}
          onClose={() => setEditingId(null)}
          onSave={(patch) => update(editing.id, patch)}
          onDelete={() => remove(editing.id)}
        />
      )}
    </div>
  );
}

type RowProps = { today: string; update: (id: string, p: Patch) => void; setEditingId: (id: string) => void };

function QuickAdd({ onAdd, hint }: { onAdd: (title: string) => Promise<void>; hint: string }) {
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (!v) return;
        start(async () => {
          await onAdd(v);
          setValue("");
        });
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={`+ ${hint}`}
        className="w-full rounded-lg border border-dashed border-[var(--line)] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-solid focus:border-[var(--accent)] focus:bg-[var(--card)]"
        disabled={pending}
      />
    </form>
  );
}

function TodayView({ tasks, ...rp }: { tasks: Task[] } & RowProps) {
  const overdue = tasks.filter((t) => t.dueDate && t.dueDate < rp.today);
  const todays = tasks.filter((t) => t.dueDate === rp.today);
  const inProgress = tasks.filter((t) => t.status === "in_progress" && !(t.dueDate && t.dueDate <= rp.today));
  if (!overdue.length && !todays.length && !inProgress.length)
    return <Empty text="Nothing due today. Nice." />;
  return (
    <>
      <Section title="Overdue" tone="danger" tasks={overdue} {...rp} />
      <Section title="Today" tasks={todays} {...rp} />
      <Section title="In progress" tasks={inProgress} {...rp} />
    </>
  );
}

function UpcomingView({ tasks, ...rp }: { tasks: Task[] } & RowProps) {
  const future = tasks.filter((t) => t.dueDate && t.dueDate > rp.today);
  const horizon = addDays(rp.today, 7);
  const byDate = new Map<string, Task[]>();
  for (const t of future.filter((t) => t.dueDate! <= horizon)) byDate.set(t.dueDate!, [...(byDate.get(t.dueDate!) ?? []), t]);
  const later = future.filter((t) => t.dueDate! > horizon);
  const noDate = tasks.filter((t) => !t.dueDate);
  if (!future.length && !noDate.length) return <Empty text="Nothing upcoming." />;
  return (
    <>
      {[...byDate.entries()].map(([d, ts]) => (
        <Section key={d} title={dayHeading(d, rp.today)} tasks={ts} {...rp} />
      ))}
      <Section title="Later" tasks={later} {...rp} />
      <Section title="No date" tasks={noDate} {...rp} />
    </>
  );
}

function SourceView({
  tasks,
  filter,
  setFilter,
  ...rp
}: { tasks: Task[]; filter: Source | "all"; setFilter: (s: Source | "all") => void } & RowProps) {
  const sources: Source[] = ["pipedrive", "slack", "local"];
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {(["all", ...sources] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === s ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--line)] text-[var(--muted)]"
            }`}
          >
            {s === "all" ? "All" : SOURCE_LABEL[s]}{" "}
            <span className="text-xs opacity-70">{s === "all" ? tasks.length : tasks.filter((t) => t.source === s).length}</span>
          </button>
        ))}
      </div>
      {sources
        .filter((s) => filter === "all" || filter === s)
        .map((s) => (
          <Section key={s} title={SOURCE_LABEL[s]} tasks={tasks.filter((t) => t.source === s)} {...rp} showEmpty={filter === s} />
        ))}
    </>
  );
}

const COLUMNS: { status: Status; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

function BoardView({ tasks, ...rp }: { tasks: Task[] } & RowProps) {
  const [over, setOver] = useState<Status | null>(null);
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {COLUMNS.map((col) => {
        const items = tasks.filter((t) => t.status === col.status);
        return (
          <section
            key={col.status}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.status);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) rp.update(id, { status: col.status });
            }}
            className={`rounded-xl border p-3 transition-colors ${
              over === col.status ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--hover)]/50"
            }`}
          >
            <h2 className="mb-3 flex items-center gap-2 px-1 text-sm font-medium">
              {col.label} <span className="text-xs text-[var(--muted)]">{items.length}</span>
            </h2>
            <ul className="flex min-h-16 flex-col gap-2">
              {items.map((t) => (
                <li
                  key={t.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                  className="cursor-grab rounded-lg border border-[var(--line)] bg-[var(--card)] p-3 active:cursor-grabbing"
                >
                  <button className="w-full text-left" onClick={() => rp.setEditingId(t.id)}>
                    <p className={`text-sm ${t.status === "done" ? "text-[var(--muted)] line-through" : ""}`}>{t.title}</p>
                    <Meta task={t} today={rp.today} />
                  </button>
                  {/* Touch devices can't drag: offer a status picker. */}
                  <select
                    value={t.status}
                    onChange={(e) => rp.update(t.id, { status: e.target.value as Status })}
                    className="mt-2 w-full rounded-md border border-[var(--line)] bg-transparent px-2 py-1 text-xs text-[var(--muted)] md:hidden"
                    aria-label="Move to"
                  >
                    {COLUMNS.map((c) => (
                      <option key={c.status} value={c.status}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Section({
  title,
  tasks,
  tone,
  showEmpty,
  showDone,
  ...rp
}: { title: string; tasks: Task[]; tone?: "danger"; showEmpty?: boolean; showDone?: boolean } & RowProps) {
  if (!tasks.length && !showEmpty) return null;
  return (
    <section className="mb-6">
      <h2 className={`mb-1 px-1 text-xs font-semibold tracking-wide uppercase ${tone === "danger" ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>
        {title} <span className="font-normal">{tasks.length}</span>
      </h2>
      {tasks.length ? (
        <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)]">
          {tasks
            .filter((t) => showDone || t.status !== "done")
            .map((t) => (
              <Row key={t.id} task={t} {...rp} />
            ))}
        </ul>
      ) : (
        <Empty text="Nothing here." />
      )}
    </section>
  );
}

function Row({ task: t, today, update, setEditingId }: { task: Task } & RowProps) {
  const done = t.status === "done";
  return (
    <li className="flex items-start gap-3 px-3 py-2.5 hover:bg-[var(--hover)]">
      <input
        type="checkbox"
        checked={done}
        onChange={() => update(t.id, { status: done ? "todo" : "done" })}
        className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--accent)]"
        aria-label={done ? `Mark “${t.title}” not done` : `Complete “${t.title}”`}
      />
      <button className="min-w-0 flex-1 text-left" onClick={() => setEditingId(t.id)}>
        <p className={`text-sm leading-5 ${done ? "text-[var(--muted)] line-through" : ""}`}>
          {t.title}
          {t.status === "in_progress" && (
            <span className="ml-2 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">In progress</span>
          )}
        </p>
        <Meta task={t} today={today} />
      </button>
    </li>
  );
}

function Meta({ task: t, today }: { task: Task; today: string }) {
  const due = dueLabel(t, today);
  const ctx = [t.context?.deal?.title, t.context?.person?.name ?? t.context?.org?.name].filter(Boolean);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
      <SourceBadge source={t.source} type={t.context?.type} />
      {due && <span className={isOverdue(t, today) ? "text-[var(--danger)]" : ""}>{due}</span>}
      {ctx.length > 0 && <span className="truncate">{ctx.join(" · ")}</span>}
      {t.syncError && <span className="text-[var(--danger)]" title={t.syncError}>⚠ sync error</span>}
      {t.dirtyFields.length > 0 && !t.syncError && <span title="Waiting to sync">•</span>}
    </p>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-8 text-center text-sm text-[var(--muted)]">{text}</p>;
}

function dayHeading(date: string, today: string) {
  if (date === addDays(today, 1)) return "Tomorrow";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
}

function timeAgo(iso: string) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}
