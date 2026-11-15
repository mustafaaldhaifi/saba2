import assert from 'node:assert/strict';
import test from 'node:test';
import { reportBranchesForCity, sortReportBranches } from './reportBranches.js';

const branches = [
    { id: 'outside-z', name: 'زهراء', city: 'other' },
    { id: 'riyadh-b', name: 'بشاير', city: 'ryad' },
    { id: 'outside-a', name: 'أمل', city: 'other' },
    { id: 'legacy', name: 'أصيل' },
    { id: 'riyadh-a', name: 'أنس', city: 'ryad' }
];

test('all-city reports list Riyadh branches first and sort names within each group', () => {
    assert.deepEqual(sortReportBranches(reportBranchesForCity(branches, 'all')).map(branch => branch.id),
        ['legacy', 'riyadh-a', 'riyadh-b', 'outside-a', 'outside-z']);
    assert.equal(branches[0].id, 'outside-z');
});

test('city-specific reports keep legacy branches in Riyadh only', () => {
    assert.deepEqual(reportBranchesForCity(branches, 'ryad').map(branch => branch.id),
        ['riyadh-b', 'legacy', 'riyadh-a']);
    assert.deepEqual(reportBranchesForCity(branches, 'other').map(branch => branch.id),
        ['outside-z', 'outside-a']);
});
