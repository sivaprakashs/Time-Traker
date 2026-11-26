import type { TimeEntry } from '@/types/database';

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60 * 1000; // UTC+05:30 (India Standard Time, no DST)

/**
 * Returns YYYY-MM-DD in Asia/Kolkata timezone for a given Date or ISO timestamp.
 */
export function getISTDateString(input: Date | string = new Date()): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Parses a YYYY-MM-DD string into UTC midnight + IST offset helper for pure calendar math.
 */
function parseCalendarDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

function formatCalendarDate(utcDate: Date): string {
  const y = utcDate.getUTCFullYear();
  const m = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utcDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const d = parseCalendarDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return formatCalendarDate(d);
}

/**
 * Returns Monday..Sunday bounds in Asia/Kolkata for the week containing `dateStr`.
 */
export function getISTWeekBounds(dateStr: string = getISTDateString()): {
  start: string;
  end: string;
} {
  const d = parseCalendarDate(dateStr);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = addDaysToDateString(dateStr, diffToMonday);
  const end = addDaysToDateString(start, 6);
  return { start, end };
}

/**
 * Returns 1st..last day bounds in Asia/Kolkata for the month containing `dateStr`.
 */
export function getISTMonthBounds(dateStr: string = getISTDateString()): {
  start: string;
  end: string;
} {
  const [y, m] = dateStr.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0));
  return { start, end: formatCalendarDate(lastDay) };
}

export function getISTDaysInRange(start: string, end: string): string[] {
  const result: string[] = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 366) {
    result.push(cursor);
    cursor = addDaysToDateString(cursor, 1);
    guard += 1;
  }
  return result;
}

export function formatISTDate(
  input: string | Date,
  options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  },
): string {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const dt = new Date(`${input}T00:00:00+05:30`);
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: DEFAULT_TIMEZONE,
      ...options,
    }).format(dt);
  }
  const dt = typeof input === 'string' ? new Date(input) : input;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: DEFAULT_TIMEZONE,
    ...options,
  }).format(dt);
}

export function formatISTTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: DEFAULT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(isoString));
}

export function formatISTDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: DEFAULT_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(isoString));
}

/**
 * Converts an IST calendar date (YYYY-MM-DD) and time (HH:mm) to a UTC ISO string.
 */
export function istDateTimeToUtcIso(dateStr: string, timeStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, hh || 0, mm || 0, 0, 0) - IST_OFFSET_MS;
  return new Date(utcMs).toISOString();
}

/**
 * Extracts HH:mm (24h) in Asia/Kolkata from a UTC ISO string for <input type="time">.
 */
export function utcIsoToISTTimeInput(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DEFAULT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hh}:${mm}`;
}

export function formatDurationHMS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [hrs, mins, secs].map((v) => String(v).padStart(2, '0')).join(':');
}

export function formatDurationHuman(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  if (hrs === 0 && mins === 0) {
    return safe > 0 ? `${safe}s` : '0m';
  }
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

export function formatHoursDecimal(totalSeconds: number): string {
  return (Math.max(0, totalSeconds) / 3600).toFixed(2);
}

/**
 * Computes elapsed seconds from saved timestamps rather than browser tick counters.
 */
export function computeEffectiveSeconds(
  entry: Pick<TimeEntry, 'status' | 'accumulated_seconds' | 'duration_seconds' | 'last_resumed_at'>,
  serverNowMs: number = Date.now(),
): number {
  if (entry.status === 'completed') {
    return Math.max(0, entry.duration_seconds || 0);
  }
  if (entry.status === 'paused') {
    return Math.max(0, entry.accumulated_seconds || 0);
  }
  const resumedMs = entry.last_resumed_at ? new Date(entry.last_resumed_at).getTime() : serverNowMs;
  const deltaSeconds = Math.max(0, Math.floor((serverNowMs - resumedMs) / 1000));
  return Math.max(0, (entry.accumulated_seconds || 0) + deltaSeconds);
}
