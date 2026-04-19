// Pure logic for the scheduler's timing decisions.
// Kept free of db.server / shopify.server imports so tests can import this
// without pulling runtime side effects.

export interface SchedulerSettings {
  isActive: boolean;
  nextRunAt: Date | null;
}

export function shouldRun(settings: SchedulerSettings, now: Date): boolean {
  if (!settings.isActive) return false;
  // Cadence is anchored to nextRunAt, set on toggle ON and after each scan.
  if (!settings.nextRunAt) return false;
  return now >= new Date(settings.nextRunAt);
}

export function computeNextRunAt(
  frequency: number,
  frequencyUnit: string,
  from: Date = new Date(),
): Date {
  const next = new Date(from);
  if (frequencyUnit === "minutes") {
    next.setTime(next.getTime() + frequency * 60 * 1000);
  } else {
    next.setTime(next.getTime() + frequency * 24 * 60 * 60 * 1000);
  }
  return next;
}
