import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateInventoryTransfer, canTransferInventoryDifference } from './inventoryTransferMath.js';

test('fully posted surplus is excluded from selection, including select all', () => {
  assert.equal(canTransferInventoryDifference({ difference: 8, appliedSurplus: 8 }), false);
  assert.equal(canTransferInventoryDifference({ difference: -3, appliedSurplus: 0 }), true);
  assert.equal(canTransferInventoryDifference({ difference: 0, appliedSurplus: 0 }), false);
  assert.equal(canTransferInventoryDifference({ difference: 8, appliedSurplus: 8, settledDifference: 8 }), true);
});

test('already posted surplus is not added a second time', () => {
  assert.deepEqual(calculateInventoryTransfer(
    { expectedQuantity: 10, actualQuantity: 18, difference: 8, appliedSurplus: 8 },
    { add: 8, closeStock: 18 },
  ), { rawDifference: 8, pending: 0, nextAdd: 8, nextClosing: 18 });
});

test('a shortage is applied to the latest daily inventory', () => {
  assert.deepEqual(calculateInventoryTransfer(
    { expectedQuantity: 10, actualQuantity: 7, difference: -3, appliedSurplus: 0 },
    { add: 2, closeStock: 12 },
  ), { rawDifference: -3, pending: -3, nextAdd: -1, nextClosing: 9 });
});

test('a corrected answer transfers only the change since prior settlement', () => {
  assert.deepEqual(calculateInventoryTransfer(
    { expectedQuantity: 10, actualQuantity: 15, difference: -3, appliedSurplus: 8, settledDifference: 8 },
    { add: 8, closeStock: 18 },
  ), { rawDifference: 5, pending: -3, nextAdd: 5, nextClosing: 15 });
});

test('correcting an auto-posted surplus to zero requires a reversal', () => {
  assert.deepEqual(calculateInventoryTransfer(
    { expectedQuantity: 10, actualQuantity: 10, difference: -8, appliedSurplus: 8, settledDifference: 8 },
    { add: 8, closeStock: 18 },
  ), { rawDifference: 0, pending: -8, nextAdd: 0, nextClosing: 10 });
});
