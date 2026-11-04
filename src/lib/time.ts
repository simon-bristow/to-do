/** Timezone helpers. Pipedrive stores due_time in UTC; the app shows APP_TIMEZONE. */

export const APP_TZ = process.env.APP_TIMEZONE || "Australia/Melbourne";

function partsInTz(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** UTC date + time -> local date + time in tz. */
export function utcToLocal(date: string, time: string, tz = APP_TZ) {
  return partsInTz(new Date(`${date}T${time.slice(0, 5)}:00Z`), tz);
}

/** Local date + time in tz -> UTC date + time. */
export function localToUtc(date: string, time: string, tz = APP_TZ) {
  // Guess as if UTC, then correct by the tz offset at that instant (twice for DST edges).
  const target = Date.parse(`${date}T${time.slice(0, 5)}:00Z`);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const shown = partsInTz(new Date(guess), tz);
    const shownMs = Date.parse(`${shown.date}T${shown.time}:00Z`);
    guess += target - shownMs;
  }
  return partsInTz(new Date(guess), "UTC");
}

/** Today's date (YYYY-MM-DD) in tz. */
export function todayInTz(tz = APP_TZ, now = new Date()) {
  return partsInTz(now, tz).date;
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
