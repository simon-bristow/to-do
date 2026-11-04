import { NextResponse, type NextRequest } from "next/server";
import { syncAll } from "@/lib/sync/engine";
import { auth, authDisabled } from "@/auth";

export const maxDuration = 60;

async function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (authDisabled()) return true;
  return Boolean((await auth())?.user);
}

/** Called every 5 minutes by a scheduler (Vercel Cron or cron-job.org), or by the app. */
export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ results: await syncAll() });
}
export const POST = GET;
