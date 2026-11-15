/**
 * Busca los `count` terrenos análogos más parecidos a `target` entre `candidates`, comparando sus
 * `coreVariables`. Cada variable se normaliza por su rango (mín–máx entre todos los terrenos
 * comparados) para que todas pesen igual; se ignoran las que falten o sean null.
 *
 * similitud = 1 − distancia cuadrática media normalizada (1 = idénticos, 0 = opuestos en todo)
 *
 * @returns [{ region, similarity }] ordenados de mayor a menor similitud (vacío si no hay candidatos)
 */
export function findClosestAnalogs(target, candidates, count = 3) {
  if (!candidates?.length) return [];
  const pool = [target, ...candidates];
  const keys = Object.keys(target.coreVariables ?? {});

  const ranges = {};
  keys.forEach((key) => {
    const values = pool.map((r) => r.coreVariables?.[key]).filter((v) => typeof v === 'number');
    ranges[key] = Math.max(...values) - Math.min(...values) || 1;
  });

  const scored = [];
  candidates.forEach((candidate) => {
    let sum = 0;
    let used = 0;
    keys.forEach((key) => {
      const a = target.coreVariables[key];
      const b = candidate.coreVariables?.[key];
      if (typeof a !== 'number' || typeof b !== 'number') return;
      sum += ((a - b) / ranges[key]) ** 2;
      used++;
    });
    if (!used) return;
    scored.push({ region: candidate, similarity: 1 - Math.sqrt(sum / used) });
  });
  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, count);
}
