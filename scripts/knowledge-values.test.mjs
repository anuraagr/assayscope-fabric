import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSqlRows } from './knowledge-values.mjs';

test('SQL bigint strings normalize only against declared integer columns without altering measurements', () => {
  const rows = [{ n: '3', mean: 39.8039357452789, label: '003', included: true, sd: null }];
  const columns = { n: 'int64', mean: 'double', label: 'string', included: 'boolean', sd: 'double' };
  assert.deepEqual(normalizeSqlRows(rows, columns), [{
    n: 3, mean: 39.8039357452789, label: '003', included: true, sd: null,
  }]);
  assert.equal(rows[0].n, '3');
});

test('unsafe bigint, invalid text, missing and additional columns fail explicitly', () => {
  for (const value of ['9007199254740993', '3.2', '3bad', true]) {
    assert.throws(() => normalizeSqlRows([{ n: value }], { n: 'int64' }), /bigint/);
  }
  assert.throws(() => normalizeSqlRows([{ value: '1.2' }], { value: 'double' }), /numeric type/);
  assert.throws(() => normalizeSqlRows([{ n: '3', unexpected: 1 }], { n: 'int64' }), /columns differ/);
  assert.throws(() => normalizeSqlRows([{}], { n: 'int64' }), /columns differ/);
});
