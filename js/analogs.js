/**
 * Busca el terreno análogo más parecido a `target` entre `candidates`, comparando sus
 * `coreVariables`. Cada variable se normaliza por su rango (mín–máx entre todos los terrenos
 * comparados) para que todas pesen igual; se ignoran las que falten o sean null.
 *
 * similitud = 1 − distancia cuadrática media normalizada (1 = idénticos, 0 = opuestos en todo)
 *
 * @returns { region, similarity } | null
 */
export function findClosestAnalog(target, candidates) {
  const pool = [target, ...candidates];
  const keys = Object.keys(target.coreVariables ?? {});

  const ranges = {};
  keys.forEach((key) => {
    const values = pool.map((r) => r.coreVariables?.[key]).filter((v) => typeof v === 'number');
    ranges[key] = Math.max(...values) - Math.min(...values) || 1;
  });

  let best = null;
  candidates.forEach((candidate) => {
    let sum = 0;
    let count = 0;
    keys.forEach((key) => {
      const a = target.coreVariables[key];
      const b = candidate.coreVariables?.[key];
      if (typeof a !== 'number' || typeof b !== 'number') return;
      sum += ((a - b) / ranges[key]) ** 2;
      count++;
    });
    if (!count) return;
    const similarity = 1 - Math.sqrt(sum / count);
    if (!best || similarity > best.similarity) best = { region: candidate, similarity };
  });
  return best;
}
