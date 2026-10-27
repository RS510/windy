const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const weekdayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });

export function fmtDay(unix: number): string {
  return dayFmt.format(new Date(unix * 1000));
}

export function fmtHour(unix: number): string {
  return hourFmt.format(new Date(unix * 1000));
}

export function fmtWeekday(unix: number): string {
  return weekdayFmt.format(new Date(unix * 1000));
}

export function fmtDayHour(unix: number): string {
  return `${fmtDay(unix)} ${fmtHour(unix)}`;
}

/** Local calendar day key, used to group hours into days. */
export function dayKey(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function localHour(unix: number): number {
  return new Date(unix * 1000).getHours();
}

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}
