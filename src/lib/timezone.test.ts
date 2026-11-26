import { describe, expect, it } from 'vitest';
import {
  computeEffectiveSeconds,
  formatDurationHMS,
  formatDurationHuman,
  getISTDateString,
  getISTMonthBounds,
  getISTWeekBounds,
  istDateTimeToUtcIso,
  utcIsoToISTTimeInput,
} from '@/lib/timezone';

describe('Asia/Kolkata timezone and timer calculations', () => {
  it('computes IST calendar date correctly across UTC midnight boundary', () => {
    // 2026-11-26T19:00:00Z is 2026-11-27 00:30 IST
    expect(getISTDateString('2026-11-26T19:00:00Z')).toBe('2026-11-27');
    // 2026-11-26T18:00:00Z is 2026-11-26 23:30 IST
    expect(getISTDateString('2026-11-26T18:00:00Z')).toBe('2026-11-26');
  });

  it('converts IST date + time to UTC ISO and back accurately', () => {
    const utcIso = istDateTimeToUtcIso('2026-11-26', '09:30');
    expect(utcIso).toBe('2026-11-26T04:00:00.000Z');
    expect(utcIsoToISTTimeInput(utcIso)).toBe('09:30');
  });

  it('computes Monday-Sunday week bounds and month bounds in IST', () => {
    // 2026-11-26 is a Thursday
    expect(getISTWeekBounds('2026-11-26')).toEqual({
      start: '2026-11-23',
      end: '2026-11-29',
    });
    expect(getISTMonthBounds('2026-11-26')).toEqual({
      start: '2026-11-01',
      end: '2026-11-30',
    });
  });

  it('calculates elapsed seconds from saved timestamps across refreshes and pauses', () => {
    const runningEntry = {
      status: 'running' as const,
      accumulated_seconds: 120,
      duration_seconds: 0,
      last_resumed_at: '2026-11-26T04:00:00.000Z',
    };
    const nowMs = new Date('2026-11-26T04:01:15.000Z').getTime();
    expect(computeEffectiveSeconds(runningEntry, nowMs)).toBe(195);

    const pausedEntry = {
      status: 'paused' as const,
      accumulated_seconds: 195,
      duration_seconds: 195,
      last_resumed_at: null,
    };
    expect(computeEffectiveSeconds(pausedEntry, nowMs + 60000)).toBe(195);

    const completedEntry = {
      status: 'completed' as const,
      accumulated_seconds: 3600,
      duration_seconds: 3600,
      last_resumed_at: null,
    };
    expect(computeEffectiveSeconds(completedEntry, nowMs)).toBe(3600);
  });

  it('formats durations cleanly', () => {
    expect(formatDurationHMS(3665)).toBe('01:01:05');
    expect(formatDurationHuman(5400)).toBe('1h 30m');
    expect(formatDurationHuman(45)).toBe('45s');
  });
});
