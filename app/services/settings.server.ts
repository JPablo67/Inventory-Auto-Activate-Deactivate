import db from "../db.server";

export interface SaveAutoSettingsInput {
    shop: string;
    isActive: boolean;
    frequency: number;
    frequencyUnit: string;
    minDaysInactive: number;
}

function frequencyToMs(frequency: number, frequencyUnit: string): number {
    return frequencyUnit === "minutes"
        ? frequency * 60 * 1000
        : frequency * 24 * 60 * 60 * 1000;
}

function clampFrequency(raw: number): number {
    const n = isNaN(raw) ? 5 : raw;
    return Math.min(90, Math.max(5, Math.round(n / 5) * 5));
}

// Persists the auto-deactivate settings and re-anchors nextRunAt only when the
// active state transitions. Disabling clears nextRunAt; toggling on schedules
// the first scan at now + frequency. While active, frequency edits don't shift
// the existing schedule (the form disables them anyway).
export async function saveAutoSettings(input: SaveAutoSettingsInput) {
    const frequency = clampFrequency(input.frequency);
    const { shop, isActive, frequencyUnit, minDaysInactive } = input;

    const now = new Date();
    const intervalMs = frequencyToMs(frequency, frequencyUnit);

    const existing = await db.settings.findUnique({ where: { shop } });
    const wasActive = existing?.isActive === true;

    let nextRunAtPatch: { nextRunAt: Date | null } | {} = {};
    if (isActive && !wasActive) {
        nextRunAtPatch = { nextRunAt: new Date(now.getTime() + intervalMs) };
    } else if (!isActive) {
        nextRunAtPatch = { nextRunAt: null };
    }

    await db.settings.upsert({
        where: { shop },
        update: {
            isActive,
            frequency,
            frequencyUnit,
            minDaysInactive,
            ...nextRunAtPatch,
        },
        create: {
            shop,
            isActive,
            frequency,
            frequencyUnit,
            minDaysInactive,
            nextRunAt: isActive ? new Date(now.getTime() + intervalMs) : null,
        },
    });
}
