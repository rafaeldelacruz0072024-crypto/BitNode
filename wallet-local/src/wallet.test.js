import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_SUPPLY, tokenMetrics, validateAddress, displayUnits } from './wallet.js';
test('suministro y quema sin redondear balances enteros', () => {
  assert.deepEqual(tokenMetrics(INITIAL_SUPPLY), { supply: INITIAL_SUPPLY, burned: 0n, percent: 0 });
  assert.equal(tokenMetrics(INITIAL_SUPPLY / 2n).percent, 50);
  assert.equal(tokenMetrics(0n).burned, INITIAL_SUPPLY);
  assert.throws(() => tokenMetrics(INITIAL_SUPPLY + 1n));
  assert.throws(() => tokenMetrics(-1n));
  assert.equal(displayUnits(INITIAL_SUPPLY), '11,000,000');
  assert.equal(displayUnits(1n), '<0.000001');
});
test('direcciones inválidas no llegan al proveedor', () => {
  assert.throws(() => validateAddress('no-es-wallet'));
  assert.equal(validateAddress('0x0000000000000000000000000000000000000001'), '0x0000000000000000000000000000000000000001');
});
