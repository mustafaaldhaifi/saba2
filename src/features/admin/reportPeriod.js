/**
 * Reads the days covered by a monthly summary for one report period.
 * 1. Combine nested and legacy dotted day fields without replacing nested values.
 * 2. Return every day for a month or only the selected day when provided.
 */
export function daysForReportPeriod(summary, selectedDay = '') {
    // STEP 1: Both Firestore day shapes are used by existing summaries.
    const days = { ...(summary.days || {}) };
    Object.entries(summary).forEach(([key, value]) => {
        if (key.startsWith('days.') && !days[key.slice(5)]) days[key.slice(5)] = value;
    });

    // STEP 2: A missing day contributes no values to a daily report.
    if (!selectedDay) return days;
    const dayKey = selectedDay.slice(-2);
    const value = days[dayKey] ?? days[String(Number(dayKey))];
    return value ? { [dayKey]: value } : {};
}

/**
 * Calculates report values from the selected day or month.
 * 1. Use the first opening and last closing balance in the period.
 * 2. Sum flow fields across the included days.
 */
export function totalsForReportPeriod(days, fields) {
    // STEP 1: Stock balances are point-in-time values, not monthly sums.
    const sortedDays = Object.keys(days).sort((left, right) => Number(left) - Number(right));
    if (!sortedDays.length) return null;
    const first = days[sortedDays[0]];
    const last = days[sortedDays[sortedDays.length - 1]];

    // STEP 2: Daily mode has one day; monthly mode sums each flow field.
    const fieldTotals = Object.fromEntries(fields.map(field => [field,
        sortedDays.reduce((total, day) => total + Number(days[day]?.[field] || 0), 0)
    ]));
    return {
        openingStock_pure: Number(first?.openingStock || 0),
        remaining_pure: Number(last?.closeStock || 0),
        fieldTotals
    };
}
