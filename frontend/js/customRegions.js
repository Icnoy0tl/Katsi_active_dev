/**
 * Terrenos propios que el usuario añadió al sistema desde la vista API. Viven solo en este
 * navegador (localStorage): cada uno guarda la región tal como la aceptó el backend, el cuerpo
 * donde se muestra y los análogos calculados con la misión del usuario, así que al recargar
 * aparecen en la Luna o en Marte sin volver a subir los JSON.
 *
 * Si el navegador no deja guardar (ventana privada, almacenamiento lleno), siguen disponibles
 * durante la sesión.
 *
 * Entrada: { body: 'moon' | 'mars', region, mission, matches, savedAt }
 *   region: selectedRegion del backend; mission: nombre de la misión del usuario;
 *   matches: análogos de POST /api/analog/custom ({ regionId, similarity, region, features, … })
 */

const STORAGE_KEY = 'hackanenes:custom-regions';
export const BODIES = ['moon', 'mars'];

const isEntry = (entry) =>
  BODIES.includes(entry?.body) && typeof entry.region?.regionId === 'string' && Array.isArray(entry.matches);

function read() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(stored) ? stored.filter(isEntry) : [];
  } catch {
    return [];
  }
}

let entries = read();
const listeners = new Set();

function commit(next) {
  entries = next;
  try {
    if (entries.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    else localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('Custom terrains could not be stored in this browser; they last until reload.', err);
  }
  listeners.forEach((listener) => listener(entries));
}

export const customRegions = {
  /** Todas las entradas, en el orden en que se añadieron */
  all: () => entries,
  get: (regionId) => entries.find((entry) => entry.region.regionId === regionId) ?? null,
  /** Añade o sustituye (mismo regionId) un terreno */
  save(entry) {
    const saved = { ...entry, savedAt: Date.now() };
    const index = entries.findIndex((e) => e.region.regionId === entry.region.regionId);
    commit(index === -1 ? [...entries, saved] : entries.map((e, i) => (i === index ? saved : e)));
  },
  remove(regionId) {
    commit(entries.filter((entry) => entry.region.regionId !== regionId));
  },
  clear() {
    commit([]);
  },
  /** `listener(entries)` en cada cambio; devuelve la función para darse de baja */
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};

/**
 * Cuerpo al que pertenece una región subida: primero lo que diga su id o nombre
 * (USER-MOON-01, «lunar»…), después el `planet` del JSON; null si no hay pista
 */
export function guessBody(region, planet) {
  const hint = `${region.regionId} ${region.name}`.toLowerCase();
  if (/\b(moon|lunar|luna)\b/.test(hint)) return 'moon';
  if (/\b(mars|martian|marte)\b/.test(hint)) return 'mars';
  const declared = String(planet ?? '').toLowerCase();
  return BODIES.includes(declared) ? declared : null;
}
