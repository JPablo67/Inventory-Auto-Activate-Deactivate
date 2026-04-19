import { describe, expect, it } from "vitest";
import {
  computeNextRunAt,
  shouldRun,
  type SchedulerSettings,
} from "./scheduler-logic";

describe("shouldRun", () => {
  const now = new Date("2026-04-15T12:00:00Z");

  it("returns false when settings.isActive is false", () => {
    const s: SchedulerSettings = { isActive: false, nextRunAt: new Date("2026-04-14T00:00:00Z") };
    expect(shouldRun(s, now)).toBe(false);
  });

  it("returns false when nextRunAt is null", () => {
    const s: SchedulerSettings = { isActive: true, nextRunAt: null };
    expect(shouldRun(s, now)).toBe(false);
  });

  it("returns false when now is before nextRunAt", () => {
    const s: SchedulerSettings = { isActive: true, nextRunAt: new Date("2026-04-15T12:00:01Z") };
    expect(shouldRun(s, now)).toBe(false);
  });

  it("returns true when now equals nextRunAt (inclusive boundary)", () => {
    const s: SchedulerSettings = { isActive: true, nextRunAt: new Date("2026-04-15T12:00:00Z") };
    expect(shouldRun(s, now)).toBe(true);
  });

  it("returns true when now is after nextRunAt", () => {
    const s: SchedulerSettings = { isActive: true, nextRunAt: new Date("2026-04-15T11:00:00Z") };
    expect(shouldRun(s, now)).toBe(true);
  });

  it("accepts a string-like nextRunAt (Prisma sometimes hydrates as string)", () => {
    // Passing a string through the type escape hatch mirrors real-world data
    // that may not be a proper Date instance before Prisma parses it.
    const s = { isActive: true, nextRunAt: "2026-04-15T11:00:00Z" as unknown as Date };
    expect(shouldRun(s, now)).toBe(true);
  });
});

describe("computeNextRunAt", () => {
  const from = new Date("2026-04-15T12:00:00Z");

  it("adds minutes when frequencyUnit is 'minutes'", () => {
    const next = computeNextRunAt(15, "minutes", from);
    expect(next.toISOString()).toBe("2026-04-15T12:15:00.000Z");
  });

  it("adds days when frequencyUnit is 'days'", () => {
    const next = computeNextRunAt(7, "days", from);
    expect(next.toISOString()).toBe("2026-04-22T12:00:00.000Z");
  });

  it("treats any non-'minutes' unit as days (fallback branch)", () => {
    const next = computeNextRunAt(1, "hours", from);
    // 'hours' is not 'minutes', so the else-branch adds days
    expect(next.toISOString()).toBe("2026-04-16T12:00:00.000Z");
  });

  it("does not mutate the `from` argument", () => {
    const original = from.getTime();
    computeNextRunAt(30, "minutes", from);
    expect(from.getTime()).toBe(original);
  });

  it("handles minute values that roll over into the next day", () => {
    const late = new Date("2026-04-15T23:50:00Z");
    const next = computeNextRunAt(20, "minutes", late);
    expect(next.toISOString()).toBe("2026-04-16T00:10:00.000Z");
  });

  it("supports large day counts", () => {
    const next = computeNextRunAt(365, "days", from);
    expect(next.toISOString()).toBe("2027-04-15T12:00:00.000Z");
  });
});
