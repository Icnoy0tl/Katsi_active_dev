import { ANALOGS_API, CUSTOM_ANALOGS_API, REGIONS_API } from './config.js';

/**
 * Respuestas ya recibidas por URL: los datos del backend son estáticos, así que volver a un
 * filtro o a una misión ya vista no repite la petición. Se guarda la promesa (dos clics seguidos
 * comparten la misma petición) y se borra si falla, para que reintentar funcione.
 */
const responseCache = new Map();

function getJSON(url, timeoutMs) {
  if (!responseCache.has(url)) {
    const request = fetch(url, { signal: AbortSignal.timeout(timeoutMs) }).then((response) => {
      if (!response.ok) throw new Error(`Analogs API: HTTP ${response.status}`);
      return response.json();
    });
    request.catch(() => responseCache.delete(url));
    responseCache.set(url, request);
  }
  return responseCache.get(url);
}

function apiUrl(base, params) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value));
  return `${base}?${query}`;
}

/**
 * Terrenos de `planet` que sirven para la misión `filter`, ordenados por el backend
 * (`GET /api/regions`) según la similitud de su mejor análogo terrestre con los pesos de la
 * misión. Se devuelven los objetos de `bodyRegions` (los que dibujan los marcadores).
 *
 * @returns [{ region, score, bestAnalog: { regionId, name, similarity, coverage } }] de mejor a peor
 */
export async function fetchMissionRegions(planet, filter, bodyRegions) {
  const { regions = [] } = await getJSON(apiUrl(REGIONS_API.url, { planet, filter }), REGIONS_API.timeoutMs);
  const byId = new Map(bodyRegions.map((region) => [region.regionId, region]));
  return regions
    .filter(({ regionId }) => byId.has(regionId))
    .map(({ regionId, score, bestAnalog }) => ({ region: byId.get(regionId), score, bestAnalog }));
}

/**
 * Los `count` análogos terrestres de la región `regionId` de `planet` según el backend
 * (`GET /api/analog`): el cálculo vive solo allí. `filter` es el perfil de misión que pondera las
 * variables (ver MISSION_FILTERS; '' = sin filtro). Lanza un error si la petición falla, responde
 * con error o tarda más de `ANALOGS_API.timeoutMs`; quien llama decide cómo mostrarlo.
 *
 * Si la región terrestre ya está cargada en el front (`earthRegions`, mismo regionId) se usa esa
 * para mostrarla (es el mismo objeto que dibujan los marcadores).
 *
 * @returns [{ region, similarity, features }] en el orden del backend (de mayor a menor similitud);
 *          `features`: desglose por variable de knn.CompareFeatures ({ name, compatibility, … })
 */
export async function fetchClosestAnalogs(regionId, planet, earthRegions, filter = '', count = 3) {
  const { matches = [] } = await getJSON(apiUrl(ANALOGS_API.url, { planet, regionId, filter }), ANALOGS_API.timeoutMs);
  const byId = new Map(earthRegions?.map((region) => [region.regionId, region]));
  return matches.slice(0, count).map(({ regionId, region, similarity, features = [] }) => ({
    region: byId.get(regionId) ?? region,
    similarity,
    features
  }));
}

/**
 * Análogos terrestres de los datos propios del usuario (`POST /api/analog/custom`): envía los dos
 * JSON tal cual. Si el backend los rechaza, el error lleva su mensaje (pensado para el usuario).
 *
 * @returns { mission, results: [{ selectedRegion, matches, extrapolation, dataCoverage }] }
 */
export async function fetchCustomAnalogs(characteristics, mission) {
  const response = await fetch(CUSTOM_ANALOGS_API.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characteristics, mission }),
    signal: AbortSignal.timeout(CUSTOM_ANALOGS_API.timeoutMs)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error ?? `Analogs API: HTTP ${response.status}`);
    error.fromBackend = Boolean(payload?.error);
    throw error;
  }
  return payload;
}
