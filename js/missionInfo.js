import { setupScrollFade } from './utils/scrollFade.js';

const $ = (id) => document.getElementById(id);

/** Etiqueta y unidad de cada variable del JSON (las no listadas se muestran con su clave) */
const CORE_VARIABLES = {
  slope: ['Pendiente', '°'],
  radar_roughness: ['Rugosidad de radar', ''],
  apparent_thermal_inertia: ['Inercia térmica aparente', 'TIU'],
  soil_moisture: ['Humedad del suelo', ''],
  visual_texture: ['Textura visual', ''],
  low_sun_shadows: ['Sombras con sol bajo', '%'],
  line_of_sight: ['Línea de visión', '%'],
  diurnal_thermal_range: ['Rango térmico diurno', 'K'],
  dust_aerosols: ['Polvo y aerosoles', ''],
  insolation: ['Insolación', 'W/m²']
};

const AUDIT_VARIABLES = {
  rock_abundance_pct: ['Abundancia de rocas', '%'],
  grain_size_um: ['Tamaño de grano', 'µm'],
  angle_of_repose_deg: ['Ángulo de reposo', '°'],
  depth_to_bedrock: ['Profundidad a roca madre', 'm'], // combina _min_m y _max_m
  vrm_microrelief: ['Microrrelieve (VRM)', ''],
  dielectric_constant: ['Constante dieléctrica', ''],
  salinity_wt_pct: ['Salinidad', 'wt%'],
  diffuse_ratio: ['Razón difusa', ''],
  albedo: ['Albedo', ''],
  vegetation_ndvi: ['Vegetación (NDVI)', ''],
  surface_pressure_kpa: ['Presión superficial', 'kPa'],
  wind_typical_ms: ['Viento típico', 'm/s'],
  wind_gust_ms: ['Ráfagas de viento', 'm/s'],
  abrasive_mohs: ['Abrasividad (Mohs)', '']
};

const BODY_LABELS = { moon: 'Luna', mars: 'Marte' };

const formatCoord = (value, pos, neg) => `${Math.abs(value).toFixed(2)}° ${value >= 0 ? pos : neg}`;
const formatValue = (value) => (value === null || value === undefined ? '<span class="cmp-empty">—</span>' : value);

/** Profundidad a roca madre: un solo rango en lugar de dos valores */
function mergeDepth(variables) {
  const entries = { ...variables };
  if ('depth_to_bedrock_min_m' in entries || 'depth_to_bedrock_max_m' in entries) {
    const { depth_to_bedrock_min_m: min, depth_to_bedrock_max_m: max } = entries;
    delete entries.depth_to_bedrock_min_m;
    delete entries.depth_to_bedrock_max_m;
    entries.depth_to_bedrock = min === null && max === null ? null : `${min ?? '?'}–${max ?? '?'}`;
  }
  return entries;
}

/** Número de análogos terrestres que se ofrecen por misión */
const ANALOG_SLOTS = 3;

/**
 * Valores del análogo terrestre para la comparación.
 * TODO: aún no hay datos reales de la Tierra; cuando lleguen, devolver aquí
 * `mergeDepth({ ...analog.region.coreVariables, ...analog.region.auditVariables })`.
 */
function earthValues(analog, keys) {
  return Object.fromEntries(keys.map((key) => [key, null]));
}

/** Bloque de la tabla: fila de título del grupo + una fila por variable (cuerpo | Tierra) */
function comparisonGroup(title, variables, labels, analog) {
  const own = mergeDepth(variables);
  const keys = Object.keys(own);
  const earth = earthValues(analog, keys);
  const rows = keys
    .map((key) => {
      const [label, unit] = labels[key] ?? [key, ''];
      return `<tr>
        <th scope="row">${label}${unit ? `<span class="cmp-unit">${unit}</span>` : ''}</th>
        <td>${formatValue(own[key])}</td>
        <td class="cmp-earth">${formatValue(earth[key])}</td>
      </tr>`;
    })
    .join('');
  return `<tbody>
      <tr class="cmp-group"><th colspan="3" scope="colgroup">${title}</th></tr>
      ${rows}
    </tbody>`;
}

// Mismos trazos que los iconos del menú principal y de la lista de misiones
const EARTH_ICON =
  '<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5S9.6 5.8 12 3.5Z"/></svg>';

/** Tarjeta de análogo: igual que las de misiones (icono | divisor | nombre y datos) con el % al final */
function analogCard(analog, index) {
  const { name, regionId, coordinates } = analog.region;
  const percent = Math.round(analog.similarity * 100);
  return `<li class="menu-enter" style="--i: ${index + 5}">
      <button type="button" class="menu-tag menu-tag--mission" data-index="${index}">
        <span class="menu-icon-box">${EARTH_ICON}</span>
        <span class="menu-divider"></span>
        <span class="menu-label">
          <span>${name}</span>
          <span class="mission-meta">${regionId} · ${formatCoord(coordinates.latitude, 'N', 'S')}, ${formatCoord(coordinates.longitude, 'E', 'O')}</span>
        </span>
        <span class="menu-score" style="--score: ${percent}" aria-label="${percent} % de similitud"><b>${percent}&nbsp;%</b></span>
      </button>
    </li>`;
}

/** Hueco reservado mientras no haya terrenos terrestres con los que comparar */
function pendingCard(index) {
  return `<li class="menu-enter" style="--i: ${index + 5}">
      <div class="menu-tag menu-tag--mission is-pending">
        <span class="menu-icon-box">${EARTH_ICON}</span>
        <span class="menu-divider"></span>
        <span class="menu-label">
          <span>Pendiente</span>
          <span class="mission-meta">Sin datos terrestres todavía</span>
        </span>
        <span class="menu-score" style="--score: 0"><b>—</b></span>
      </div>
    </li>`;
}

/**
 * Panel izquierdo de la misión con dos apartados:
 *  - Lista: el terreno seleccionado y sus análogos terrestres más parecidos (hasta 3 tarjetas).
 *  - Comparación: al pulsar una tarjeta, la tabla del terreno frente a ese análogo. Se vuelve a
 *    la lista con `backToList()` (lo llama el botón superior «Volver a análogos»).
 *
 * @param onAnalogChange(analog | null) se llama al entrar en un análogo (con él) y al volver a la
 *        lista (con null): la Tierra solo se muestra mientras se está dentro de un análogo
 * @returns { show(region, analogs, bodyName), hide(), backToList(), inAnalog }
 */
export function setupMissionInfo({ onAnalogChange } = {}) {
  const panel = $('mission-info');
  const body = $('mission-info-body');
  const updateScrollEnd = setupScrollFade(panel);

  let region = null;
  let bodyLabel = '';
  let analogs = [];
  let shown = -1; // análogo en el que se ha entrado (-1 = lista)

  function render(html) {
    body.innerHTML = html;
    panel.scrollTop = 0;
    updateScrollEnd();
  }

  function renderList() {
    const { latitude, longitude } = region.coordinates;
    const cards = Array.from({ length: ANALOG_SLOTS }, (_, i) =>
      analogs[i] ? analogCard(analogs[i], i) : pendingCard(i)
    ).join('');
    render(`
      <p class="info-section info-lead menu-enter" style="--i: 1">Análogos terrestres más parecidos a</p>
      <h2 class="info-name menu-enter" style="--i: 2">${region.name}</h2>
      <p class="info-coords menu-enter" style="--i: 3">${region.regionId} · ${formatCoord(latitude, 'N', 'S')} · ${formatCoord(longitude, 'E', 'O')}</p>
      <div class="menu-accent missions-accent" aria-hidden="true"></div>
      <section class="cmp-analogs">
        <ol class="menu-options" aria-label="Análogos terrestres: elige uno para ver la comparación">${cards}</ol>
      </section>`);
  }

  function renderComparison(index) {
    const analog = analogs[index];
    const { name, regionId, coordinates } = analog.region;
    const percent = Math.round(analog.similarity * 100);
    render(`
      <h2 class="info-name menu-enter" style="--i: 2">${name}</h2>
      <p class="info-coords menu-enter" style="--i: 3">${regionId} · ${formatCoord(coordinates.latitude, 'N', 'S')} · ${formatCoord(coordinates.longitude, 'E', 'O')} · ${percent}&nbsp;% de similitud</p>
      <div class="menu-accent missions-accent" aria-hidden="true"></div>
      <section class="cmp-detail menu-enter" style="--i: 4">
        <table class="cmp-table">
          <caption class="sr-only">Comparación de variables entre ${region.name} (${bodyLabel}) y ${name} (Tierra)</caption>
          <thead>
            <tr>
              <th scope="col">Variable</th>
              <th scope="col" class="cmp-col-body">${bodyLabel}<span class="cmp-col-sub">${region.regionId}</span></th>
              <th scope="col" class="cmp-col-earth">Tierra<span class="cmp-col-sub">${regionId}</span></th>
            </tr>
          </thead>
          ${comparisonGroup('Variables principales', region.coreVariables ?? {}, CORE_VARIABLES, analog)}
          ${comparisonGroup('Variables de auditoría', region.auditVariables ?? {}, AUDIT_VARIABLES, analog)}
        </table>
      </section>`);
  }

  body.addEventListener('click', (event) => {
    const card = event.target.closest('button[data-index]');
    if (!card) return;
    const index = Number(card.dataset.index);
    shown = index;
    onAnalogChange?.(analogs[index]);
    renderComparison(index);
  });

  return {
    /** true mientras se ve la comparación de un análogo */
    get inAnalog() {
      return shown !== -1;
    },
    /** De la comparación a la lista de análogos; el foco vuelve a la tarjeta de la que se salió */
    backToList() {
      if (shown === -1) return;
      const from = shown;
      shown = -1;
      onAnalogChange?.(null);
      renderList();
      body.querySelector(`[data-index="${from}"]`)?.focus({ preventScroll: true });
    },
    show(selectedRegion, foundAnalogs, bodyName) {
      region = selectedRegion;
      bodyLabel = BODY_LABELS[bodyName] ?? bodyName;
      analogs = foundAnalogs.slice(0, ANALOG_SLOTS);
      shown = -1;
      renderList();
      panel.classList.remove('is-hidden');
      panel.setAttribute('aria-hidden', 'false');
    },
    hide() {
      region = null;
      analogs = [];
      shown = -1;
      panel.classList.add('is-hidden');
      panel.setAttribute('aria-hidden', 'true');
    }
  };
}
