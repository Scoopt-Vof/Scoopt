import { describe, it, expect } from 'vitest';
import { amsterdamHour, shouldRunNow } from '../src/jobs/nightly-refresh';

// Railway runs the job at 01:00 and 02:00 UTC every day; exactly one of those
// is 03:00 in Amsterdam depending on daylight saving.
describe('nightly refresh timing', () => {
  it('summer (CEST, UTC+2): runs at 01:00 UTC, skips 02:00 UTC', () => {
    expect(amsterdamHour(new Date('2026-07-01T01:00:00Z'))).toBe(3);
    expect(shouldRunNow(new Date('2026-07-01T01:00:00Z'))).toBe(true);
    expect(shouldRunNow(new Date('2026-07-01T02:00:00Z'))).toBe(false);
  });

  it('winter (CET, UTC+1): runs at 02:00 UTC, skips 01:00 UTC', () => {
    expect(amsterdamHour(new Date('2026-12-01T02:00:00Z'))).toBe(3);
    expect(shouldRunNow(new Date('2026-12-01T02:00:00Z'))).toBe(true);
    expect(shouldRunNow(new Date('2026-12-01T01:00:00Z'))).toBe(false);
  });

  it('change-over nights still run exactly once', () => {
    // Clocks go back 25 Oct 2026 (03:00 CEST -> 02:00 CET) and forward 28 Mar 2027.
    const runs = (day: string) =>
      ['01', '02'].filter((h) => shouldRunNow(new Date(`${day}T${h}:00:00Z`))).length;
    expect(runs('2026-10-25')).toBe(1);
    expect(runs('2027-03-28')).toBe(1);
  });

  it('FORCE_REFRESH runs at any hour', () => {
    expect(shouldRunNow(new Date('2026-07-01T12:00:00Z'), true)).toBe(true);
  });
});
