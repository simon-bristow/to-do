"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Status, Task } from "@/db/schema";
import { SourceBadge } from "./bits";

type Patch = Partial<Pick<Task, "title" | "notes" | "dueDate" | "dueTime" | "status">>;

const STATUSES: { value: Status; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

/** Turn URLs in plain text into links. */
function linkify(text: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--accent)] underline">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

export default function TaskEditor({
  task,
  onClose,
  onSave,
  onDelete,
}: {
  task: Task;
  today: string;
  onClose: () => void;
  onSave: (p: Patch) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [dueTime, setDueTime] = useState(task.dueTime ?? "");
  const [editingNotes, setEditingNotes] = useState(!task.notes);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ctx = task.context;
  const sourceName = task.source === "pipedrive" ? "Pipedrive" : task.source === "slack" ? "Slack" : null;

  const save = () => {
    const patch: Patch = {};
    if (title.trim() !== task.title) patch.title = title;
    if (notes !== task.notes) patch.notes = notes;
    if ((dueDate || null) !== task.dueDate) patch.dueDate = dueDate || null;
    if ((dueTime || null) !== task.dueTime) patch.dueTime = dueTime || null;
    if (Object.keys(patch).length) onSave(patch);
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && save();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onClick={save} role="presentation">
      <aside
        role="dialog"
        aria-label="Edit task"
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-[var(--card)] shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-5 py-3">
          <SourceBadge source={task.source} type={ctx?.type} />
          {task.externalUrl && sourceName && (
            <a href={task.externalUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--accent)] hover:underline">
              Open in {sourceName} ↗
            </a>
          )}
          <button onClick={save} className="ml-auto rounded-md px-3 py-1 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]">
            Done
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5">
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            rows={2}
            className="resize-none bg-transparent text-lg font-medium outline-none"
            aria-label="Title"
          />

          <div className="flex gap-1 rounded-lg bg-[var(--hover)] p-1 text-sm" role="radiogroup" aria-label="Status">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                role="radio"
                aria-checked={task.status === s.value}
                onClick={() => onSave({ status: s.value })}
                className={`flex-1 rounded-md py-1.5 ${task.status === s.value ? "bg-[var(--card)] font-medium shadow-sm" : "text-[var(--muted)]"}`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              Due date
              <input
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  if (!e.target.value) setDueTime("");
                }}
                className="rounded-md border border-[var(--line)] bg-transparent px-2 py-1.5 text-sm text-[var(--ink)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              Time {task.source === "slack" && <span>(not synced to Slack)</span>}
              <input
                type="time"
                value={dueTime}
                disabled={!dueDate}
                onChange={(e) => setDueTime(e.target.value)}
                className="rounded-md border border-[var(--line)] bg-transparent px-2 py-1.5 text-sm text-[var(--ink)] disabled:opacity-50"
              />
            </label>
          </div>

          {ctx && (ctx.deal || ctx.person || ctx.org) && (
            <div className="rounded-lg border border-[var(--line)] p-3 text-sm">
              {ctx.deal && (
                <p>
                  <span className="text-[var(--muted)]">Deal </span>
                  <a href={ctx.deal.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
                    {ctx.deal.title}
                  </a>
                </p>
              )}
              {ctx.org && (
                <p>
                  <span className="text-[var(--muted)]">Organisation </span>
                  <a href={ctx.org.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
                    {ctx.org.name}
                  </a>
                </p>
              )}
              {ctx.person && (
                <div>
                  <p>
                    <span className="text-[var(--muted)]">Contact </span>
                    <a href={ctx.person.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
                      {ctx.person.name}
                    </a>
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
                    {ctx.person.emails.map((e) => (
                      <a key={e} href={`mailto:${e}`} className="text-[var(--accent)] hover:underline">
                        {e}
                      </a>
                    ))}
                    {ctx.person.phones.map((p) => (
                      <a key={p} href={`tel:${p.replace(/\s/g, "")}`} className="text-[var(--accent)] hover:underline">
                        {p}
                      </a>
                    ))}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <div className="flex items-center text-xs text-[var(--muted)]">
              Notes
              {!editingNotes && (
                <button onClick={() => setEditingNotes(true)} className="ml-auto text-[var(--accent)] hover:underline">
                  Edit
                </button>
              )}
            </div>
            {editingNotes ? (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={8}
                placeholder="Add notes…"
                className="rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
            ) : (
              <p className="text-sm break-words whitespace-pre-wrap">{linkify(notes)}</p>
            )}
          </div>

          {task.syncError && (
            <p className="rounded-md bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
              Last sync failed: {task.syncError}. It will retry on the next sync.
            </p>
          )}

          <div className="mt-4 border-t border-[var(--line)] pt-4">
            {confirmDelete ? (
              <div className="flex items-center gap-2 text-sm">
                <span>{sourceName ? `Delete from the app and ${sourceName}?` : "Delete this task?"}</span>
                <button onClick={onDelete} className="rounded-md bg-[var(--danger)] px-3 py-1 font-medium text-white">
                  Delete
                </button>
                <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 text-[var(--muted)]">
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="text-sm text-[var(--danger)] hover:underline">
                Delete task
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
