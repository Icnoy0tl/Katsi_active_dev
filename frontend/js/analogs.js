import { ANALOGS_API } from './config.js';

/**
 * Los `count` análogos terrestres de la región `regionId` de `planet` según el backend
 * (`GET /api/analog`): el cálculo vive solo allí. Lanza un error si la petición falla, responde
 * con error o tarda más de `ANALOGS_API.timeoutMs`; quien llama decide cómo mostrarlo.
 *
 * Si la región terrestre ya está cargada en el front (`earthRegions`, mismo regionId) se usa esa
 * para mostrarla: conserva los null de las variables, que el backend en Go convierte en 0.
 *
 * @returns [{ region, similarity }] en el orden del backend (de mayor a menor similitud)
 */
export async function fetchClosestAnalogs(regionId, planet, earthRegions, count = 3) {
  const params = new URLSearchParams({ planet, regionId });
  const response = await fetch(`${ANALOGS_API.url}?${params}`, {
    signal: AbortSignal.timeout(ANALOGS_API.timeoutMs)
  });
  if (!response.ok) throw new Error(`Analogs API: HTTP ${response.status}`);
  const { matches = [] } = await response.json();
  const byId = new Map(earthRegions?.map((region) => [region.regionId, region]));
  return matches.slice(0, count).map(({ regionId, region, similarity }) => ({
    region: byId.get(regionId) ?? region,
    similarity
  }));
}
