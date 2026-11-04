"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth";
import { createTask, deleteTask, updateTask } from "@/lib/tasks";
import { pushTask, syncAll } from "@/lib/sync/engine";
import { STATUSES } from "@/db/schema";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal(""));
const time = z.string().regex(/^\d{2}:\d{2}$/).nullable().or(z.literal(""));
const input = z.object({
  title: z.string().max(500).optional(),
  notes: z.string().max(20000).optional(),
  dueDate: date.optional(),
  dueTime: time.optional(),
  status: z.enum(STATUSES).optional(),
});

export async function createTaskAction(data: z.input<typeof input>) {
  await requireUser();
  const t = await createTask(input.parse(data));
  revalidatePath("/");
  return t;
}

export async function updateTaskAction(id: string, data: z.input<typeof input>) {
  await requireUser();
  const t = await updateTask(z.uuid().parse(id), input.parse(data));
  after(() => pushTask(t.id)); // push to Pipedrive/Slack after responding
  revalidatePath("/");
  return t;
}

export async function deleteTaskAction(id: string) {
  await requireUser();
  const tid = z.uuid().parse(id);
  await deleteTask(tid);
  after(() => pushTask(tid));
  revalidatePath("/");
}

export async function syncNowAction() {
  await requireUser();
  const results = await syncAll();
  revalidatePath("/");
  return results;
}
