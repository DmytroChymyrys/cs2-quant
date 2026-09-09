import { describe, expect, it } from 'vitest';
import { scheduledInterval } from '../src/lib/schedule';
describe('experiment schedule accounting', () => {
  it('does not invent windows before enablement', () => {
    expect(scheduledInterval(new Date('2026-09-09T18:03:00Z'), '')).toBeNull();
    expect(scheduledInterval(new Date('2026-09-09T18:03:00Z'), '2026-09-09T18:05:00Z')?.expectedWindows).toBe(0);
  });
  it('counts only closed windows from the startup boundary', () => {
    const start = '2026-09-09T18:05:00Z';
    expect(scheduledInterval(new Date('2026-09-09T18:09:59Z'), start)?.expectedWindows).toBe(0);
    expect(scheduledInterval(new Date('2026-09-09T18:10:00Z'), start)?.expectedWindows).toBe(1);
    expect(scheduledInterval(new Date('2026-09-09T18:16:00Z'), start)?.expectedWindows).toBe(2);
    expect(scheduledInterval(new Date('2026-09-10T18:05:00Z'), start)?.expectedWindows).toBe(288);
  });
  it('uses a rolling 24 hours after the first day and rejects ambiguous starts', () => {
    expect(scheduledInterval(new Date('2026-09-11T18:05:00Z'), '2026-09-09T18:05:00Z')?.expectedWindows).toBe(288);
    expect(() => scheduledInterval(new Date(), 'invalid')).toThrow('INVALID_SCHEDULE_START');
    expect(() => scheduledInterval(new Date(), '2026-09-09T18:05:01Z')).toThrow('INVALID_SCHEDULE_START');
  });
});
