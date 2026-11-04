import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { auth, authDisabled } from "@/auth";
import { lastSync, listTasks } from "@/lib/tasks";
import { todayInTz } from "@/lib/time";
import { providers } from "@/lib/sync/providers";
import TaskApp from "@/components/TaskApp";

export default function Home() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-[var(--muted)]">Loading…</p>}>
      <Tasks />
    </Suspense>
  );
}

async function Tasks() {
  await connection();
  if (!authDisabled() && !(await auth())?.user) redirect("/signin");
  const [tasks, sync] = await Promise.all([listTasks(), lastSync()]);
  return (
    <TaskApp
      tasks={tasks}
      today={todayInTz()}
      lastSyncAt={sync?.finishedAt?.toISOString() ?? null}
      connected={Object.fromEntries(providers.map((p) => [p.source, p.enabled()]))}
    />
  );
}
