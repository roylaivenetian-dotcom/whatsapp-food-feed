/** Week helpers in Asia/Hong_Kong (UTC+8, no DST). */

const TZ = "Asia/Hong_Kong";

export function hongKongDateISO(d = new Date()): string {
  // en-CA yields YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Monday (inclusive) of the HKT week containing `isoDate` (YYYY-MM-DD). */
export function weekStartMonday(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  // Construct noon UTC+8 equivalent as UTC so weekday is stable
  const utc = Date.UTC(y, m - 1, d, 4, 0, 0); // 12:00 HKT
  const day = new Date(utc).getUTCDay(); // 0=Sun
  const offsetToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(utc);
  mon.setUTCDate(mon.getUTCDate() + offsetToMon);
  return hongKongDateISO(mon);
}

export function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d, 4, 0, 0);
  const next = new Date(utc);
  next.setUTCDate(next.getUTCDate() + days);
  return hongKongDateISO(next);
}

/** Work week Mon–Fri for UI panels. */
export function workWeekRange(isoDate: string): {
  weekStart: string;
  weekEnd: string;
  weekId: string;
} {
  const weekStart = weekStartMonday(isoDate);
  const weekEnd = addDaysISO(weekStart, 4);
  return { weekStart, weekEnd, weekId: `${weekStart}_${weekEnd}` };
}
