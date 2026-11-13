export function normalizeSqlRows(rows, columns) {
  const keys = Object.keys(columns).sort();
  return rows.map(row => {
    if (Object.keys(row).sort().join() !== keys.join()) throw new Error('SQL columns differ from the curated manifest.');
    return Object.fromEntries(keys.map(key => {
      let value = row[key];
      const kind = columns[key];
      if (value === null) return [key, value];
      if (kind === 'int64') {
        if (typeof value === 'string' && /^-?(?:0|[1-9]\d*)$/.test(value)) value = Number(value);
        if (!Number.isSafeInteger(value)) throw new Error(`SQL bigint cannot be represented exactly: ${key}.`);
      } else if (kind === 'double') {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`SQL numeric type mismatch: ${key}.`);
      } else if (kind === 'boolean') {
        if (typeof value !== 'boolean') throw new Error(`SQL boolean type mismatch: ${key}.`);
      } else if (kind !== 'string' || typeof value !== 'string') {
        throw new Error(`SQL text/type mismatch: ${key}.`);
      }
      return [key, value];
    }));
  });
}
