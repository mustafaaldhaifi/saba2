import assert from 'node:assert/strict';
import test from 'node:test';
import { daysForReportPeriod, totalsForReportPeriod } from './reportPeriod.js';

const summary = {
    days: {
        '01': { openingStock: 10, closeStock: 8, sales: 2 },
        '02': { openingStock: 8, closeStock: 5, sales: 3 }
    },
    'days.02': { openingStock: 99, closeStock: 99, sales: 99 },
    'days.03': { openingStock: 5, closeStock: 4, sales: 1 }
};

test('monthly values use the first opening, last closing, and all daily flows', () => {
    const totals = totalsForReportPeriod(daysForReportPeriod(summary), ['sales']);
    assert.deepEqual(totals, { openingStock_pure: 10, remaining_pure: 4, fieldTotals: { sales: 6 } });
});

test('selected date limits both exports to the matching day', () => {
    const totals = totalsForReportPeriod(daysForReportPeriod(summary, '2026-11-02'), ['sales']);
    assert.deepEqual(totals, { openingStock_pure: 8, remaining_pure: 5, fieldTotals: { sales: 3 } });
    assert.deepEqual(daysForReportPeriod(summary, '2026-11-04'), {});
});

test('legacy dotted and unpadded days remain readable', () => {
    assert.equal(daysForReportPeriod({ 'days.3': { sales: 7 } }, '2026-11-03')['03'].sales, 7);
});
