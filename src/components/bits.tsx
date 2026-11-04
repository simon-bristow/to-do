import type { Source, Task } from "@/db/schema";

const STYLE: Record<Source, string> = {
  pipedrive: "bg-[var(--pipedrive-soft)] text-[var(--pipedrive)]",
  slack: "bg-[var(--slack-soft)] text-[var(--slack)]",
  local: "bg-[var(--local-soft)] text-[var(--local)]",
};
const LABEL: Record<Source, string> = { pipedrive: "Pipedrive", slack: "Slack", local: "App" };

export function SourceBadge({ source, type }: { source: Source; type?: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STYLE[source]}`}>
      {LABEL[source]}
      {type ? ` · ${type}` : ""}
    </span>
  );
}

export function isOverdue(t: Pick<Task, "dueDate" | "status">, today: string) {
  return t.status !== "done" && !!t.dueDate && t.dueDate < today;
}

export function dueLabel(t: Pick<Task, "dueDate" | "dueTime">, today: string) {
  if (!t.dueDate) return null;
  const d = new Date(`${t.dueDate}T00:00:00Z`);
  const days = Math.round((d.getTime() - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  let label: string;
  if (days === 0) label = "Today";
  else if (days === 1) label = "Tomorrow";
  else if (days === -1) label = "Yesterday";
  else if (days > 1 && days < 7) label = d.toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" });
  else
    label = d.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      ...(d.getUTCFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  if (t.dueTime) {
    const [h, m] = t.dueTime.split(":").map(Number);
    label += ` ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
  }
  return label;
}
