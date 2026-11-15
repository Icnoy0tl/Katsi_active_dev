import { isScrolledToEnd, setupScrollFade } from './utils/scrollFade.js';
import { formatLatLon } from './utils/format.js';
import { missionCardContent } from './missionCard.js';

const $ = (id) => document.getElementById(id);

/** Etiqueta y unidad de cada variable del JSON (las no listadas se muestran con su clave) */
const CORE_VARIABLES = {
  slope: ['Slope', '°'],
  radar_roughness: ['Radar roughness', ''],
  apparent_thermal_inertia: ['Apparent thermal inertia', 'TIU'],
  soil_moisture: ['Soil moisture', ''],
  visual_texture: ['Visual texture', ''],
  low_sun_shadows: ['Low-sun shadows', '%'],
  line_of_sight: ['Line of sight', '%'],
  diurnal_thermal_range: ['Diurnal thermal range', 'K'],
  dust_aerosols: ['Dust and aerosols', ''],
  insolation: ['Insolation', 'W/m²']
};

const AUDIT_VARIABLES = {
  rock_abundance_pct: ['Rock abundance', '%'],
  grain_size_um: ['Grain size', 'µm'],
  angle_of_repose_deg: ['Angle of repose', '°'],
  depth_to_bedrock: ['Depth to bedrock', 'm'], // combina _min_m y _max_m
  vrm_microrelief: ['Microrelief (VRM)', ''],
  dielectric_constant: ['Dielectric constant', ''],
  salinity_wt_pct: ['Salinity', 'wt%'],
  diffuse_ratio: ['Diffuse ratio', ''],
  albedo: ['Albedo', ''],
  vegetation_ndvi: ['Vegetation (NDVI)', ''],
  surface_pressure_kpa: ['Surface pressure', 'kPa'],
  wind_typical_ms: ['Typical wind', 'm/s'],
  wind_gust_ms: ['Wind gusts', 'm/s'],
  abrasive_mohs: ['Abrasiveness (Mohs)', '']
};

const BODY_LABELS = { moon: 'Moon', mars: 'Mars' };

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

/** Columnas comunes a la cabecera y a las filas: así quedan alineadas aun siendo dos tablas */
const COLUMNS = '<colgroup><col /><col class="cmp-col-value" /><col class="cmp-col-value" /></colgroup>';

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
      <button type="button" class="menu-tag menu-tag--mission" data-index="${index}">${missionCardContent({
        icon: EARTH_ICON,
        title: name,
        meta: `${regionId} · ${formatLatLon(coordinates)}`,
        trailing: `<span class="menu-score" style="--score: ${percent}" aria-label="${percent}% similarity"><b>${percent}%</b></span>`
      })}
      </button>
    </li>`;
}

/** Hueco reservado mientras no haya terrenos terrestres con los que comparar */
function pendingCard(index) {
  return `<li class="menu-enter" style="--i: ${index + 5}">
      <div class="menu-tag menu-tag--mission is-pending">${missionCardContent({
        icon: EARTH_ICON,
        title: 'Pending',
        meta: 'No Earth data yet',
        trailing: '<span class="menu-score" style="--score: 0"><b>—</b></span>'
      })}
      </div>
    </li>`;
}

/** Tarjeta esqueleto mientras llegan los análogos: misma forma que la tarjeta, con barras en vez de texto */
function skeletonCard(index) {
  return `<li class="menu-enter" style="--i: ${index + 5}">
      <div class="menu-tag menu-tag--mission is-pending is-skeleton" aria-hidden="true">${missionCardContent({
        icon: EARTH_ICON,
        title: '<span class="skeleton-bar"></span>',
        meta: '<span class="skeleton-bar skeleton-bar--short"></span>',
        trailing: '<span class="menu-score" style="--score: 0"></span>'
      })}
      </div>
    </li>`;
}

const RETRY_ICON =
  '<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.2h-4.2"/></svg>';

/** Tarjeta única cuando el backend no respondió: pulsarla repite la petición */
function errorCard() {
  return `<li class="menu-enter" style="--i: 5">
      <button type="button" class="menu-tag menu-tag--mission" data-retry>${missionCardContent({
        icon: RETRY_ICON,
        title: 'Earth analogs unavailable',
        meta: 'The analogs service did not respond · Retry',
        trailing: ''
      })}
      </button>
    </li>`;
}

/**
 * Tarjetas de la lista según el estado de la petición: esqueletos mientras carga (`analogs` null),
 * una tarjeta para reintentar si falló, y si llegaron, huecos «Pending» para los que falten.
 */
function analogCards(analogs, failed) {
  if (failed) return errorCard();
  return Array.from({ length: ANALOG_SLOTS }, (_, i) => {
    if (!analogs) return skeletonCard(i);
    return analogs[i] ? analogCard(analogs[i], i) : pendingCard(i);
  }).join('');
}

/** Texto para lectores de pantalla del estado de la lista */
const listStatus = (analogs, failed) =>
  failed ? 'Earth analogs unavailable.' : analogs ? '' : 'Loading Earth analogs…';

/**
 * Panel izquierdo de la misión con dos apartados:
 *  - Lista: el terreno seleccionado y sus análogos terrestres más parecidos (hasta 3 tarjetas).
 *  - Comparación: al pulsar una tarjeta, la tabla del terreno frente a ese análogo. Se vuelve a
 *    la lista con `backToList()` (lo llama el botón superior «Volver a análogos»).
 *
 * @param onAnalogChange(analog | null) se llama al entrar en un análogo (con él) y al volver a la
 *        lista (con null): la Tierra solo se muestra mientras se está dentro de un análogo
 * @param onRetry() se llama al pulsar «reintentar» tras un fallo del backend de análogos
 * @returns { show(region, analogs, bodyName), setAnalogs(analogs), setAnalogsError(), hide(), backToList(), inAnalog }
 *          `analogs` null en `show` = aún cargando (tarjetas esqueleto hasta `setAnalogs` o
 *          `setAnalogsError`)
 */
export function setupMissionInfo({ onAnalogChange, onRetry } = {}) {
  const panel = $('mission-info');
  const body = $('mission-info-body');
  const vignette = $('cmp-vignette');
  const updateScrollEnd = setupScrollFade(panel);
  const setVignette = (visible) => vignette.classList.toggle('is-visible', visible);

  // Zona con scroll de la comparación (se recrea en cada render): difuminado inferior propio
  let cmpScroll = null;
  const updateCmpFade = () => {
    if (cmpScroll) cmpScroll.classList.toggle('is-scroll-end', isScrolledToEnd(cmpScroll));
  };
  window.addEventListener('resize', updateCmpFade);

  /** En la comparación el panel deja de hacer scroll y solo se desplazan las filas de la tabla */
  function setComparisonLayout(on) {
    panel.classList.toggle('is-comparison', on);
    cmpScroll = on ? body.querySelector('.cmp-scroll') : null;
    if (!cmpScroll) return;
    cmpScroll.addEventListener('scroll', updateCmpFade, { passive: true });
    updateCmpFade();
  }

  let region = null;
  let bodyLabel = '';
  let analogs = null;
  let analogsFailed = false; // la última petición de análogos falló
  let shown = -1; // análogo en el que se ha entrado (-1 = lista)

  function render(html) {
    body.innerHTML = html;
    panel.scrollTop = 0;
    updateScrollEnd();
  }

  function renderList() {
    setVignette(false);
    setComparisonLayout(false);
    render(`
      <p class="info-section info-lead menu-enter" style="--i: 1">Closest Earth analogs to</p>
      <h2 class="info-name menu-enter" style="--i: 2">${region.name}</h2>
      <p class="info-coords menu-enter" style="--i: 3">${region.regionId} · ${formatLatLon(region.coordinates, ' · ')}</p>
      <div class="menu-accent missions-accent" aria-hidden="true"></div>
      <section class="cmp-analogs">
        <ol class="menu-options" aria-label="Earth analogs: pick one to see the comparison" aria-busy="${!analogs && !analogsFailed}">${analogCards(analogs, analogsFailed)}</ol>
        <p class="sr-only" role="status">${listStatus(analogs, analogsFailed)}</p>
      </section>`);
  }

  function renderComparison(index) {
    const analog = analogs[index];
    const { name, regionId, coordinates } = analog.region;
    const percent = Math.round(analog.similarity * 100);
    // Misma fila en la cabecera visible y, oculta, en la tabla de filas (para lectores de pantalla)
    const headerRow = `<tr>
        <th scope="col">Variable</th>
        <th scope="col" class="cmp-col-body">${bodyLabel}<span class="cmp-col-sub">${region.regionId}</span></th>
        <th scope="col" class="cmp-col-earth">Earth<span class="cmp-col-sub">${regionId}</span></th>
      </tr>`;
    setVignette(true);
    render(`
      <h2 class="info-name menu-enter" style="--i: 2">${name}</h2>
      <p class="info-coords menu-enter" style="--i: 3">${regionId} · ${formatLatLon(coordinates, ' · ')} · ${percent}% similarity</p>
      <div class="menu-accent missions-accent" aria-hidden="true"></div>
      <section class="cmp-detail menu-enter" style="--i: 4">
        <table class="cmp-table cmp-head" aria-hidden="true">
          ${COLUMNS}
          <thead>${headerRow}</thead>
        </table>
        <div class="cmp-scroll scroll-fade">
          <table class="cmp-table">
            <caption class="sr-only">Variable comparison between ${region.name} (${bodyLabel}) and ${name} (Earth)</caption>
            ${COLUMNS}
            <thead>${headerRow}</thead>
            ${comparisonGroup('Core variables', region.coreVariables ?? {}, CORE_VARIABLES, analog)}
            ${comparisonGroup('Audit variables', region.auditVariables ?? {}, AUDIT_VARIABLES, analog)}
          </table>
        </div>
      </section>`);
    setComparisonLayout(true);
  }

  /** Vuelve a pintar solo las tarjetas (sin animar el resto de la lista); en una comparación, al volver */
  function updateCards() {
    const list = body.querySelector('.cmp-analogs ol');
    if (shown !== -1 || !list) return;
    list.innerHTML = analogCards(analogs, analogsFailed);
    list.setAttribute('aria-busy', String(!analogs && !analogsFailed));
    body.querySelector('.cmp-analogs [role="status"]').textContent = listStatus(analogs, analogsFailed);
    updateScrollEnd();
  }

  body.addEventListener('click', (event) => {
    if (event.target.closest('button[data-retry]')) {
      analogs = null;
      analogsFailed = false;
      updateCards();
      onRetry?.();
      return;
    }
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
      analogs = foundAnalogs?.slice(0, ANALOG_SLOTS) ?? null;
      analogsFailed = false;
      shown = -1;
      renderList();
      panel.classList.remove('is-hidden');
      panel.setAttribute('aria-hidden', 'false');
    },
    /** Cambia los esqueletos por los análogos que devolvió el backend */
    setAnalogs(foundAnalogs) {
      if (!region) return;
      analogs = foundAnalogs.slice(0, ANALOG_SLOTS);
      analogsFailed = false;
      updateCards();
    },
    /** Cambia los esqueletos por la tarjeta para reintentar */
    setAnalogsError() {
      if (!region) return;
      analogs = null;
      analogsFailed = true;
      updateCards();
    },
    hide() {
      region = null;
      analogs = null;
      analogsFailed = false;
      shown = -1;
      setVignette(false);
      setComparisonLayout(false);
      panel.classList.add('is-hidden');
      panel.setAttribute('aria-hidden', 'true');
    }
  };
}
