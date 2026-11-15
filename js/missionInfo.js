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

/**
 * Valores del análogo terrestre para la comparación.
 * TODO: de momento todos son null; aquí se conectarán los datos de la Tierra.
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

/** Análogo terrestre: nombre y coordenadas a la izquierda, anillo de similitud a la derecha */
function analogCard(analog) {
  const { name, coordinates } = analog.region;
  const percent = Math.round(analog.similarity * 100);
  return `<section class="cmp-analog menu-enter" style="--i: 4">
      <div>
        <h3 class="info-section">Análogo terrestre</h3>
        <p class="info-analog">${name}</p>
        <p class="info-coords">${formatCoord(coordinates.latitude, 'N', 'S')} · ${formatCoord(coordinates.longitude, 'E', 'O')}</p>
      </div>
      <div class="cmp-score" style="--score: ${percent}">
        <b>${percent}&nbsp;%</b><span>similitud</span>
      </div>
    </section>`;
}

/**
 * Panel izquierdo con la información de un terreno seleccionado y su comparación con el
 * análogo terrestre.
 *
 * @returns { show(region, analog, bodyName), hide() } — `analog`: { region, similarity } o null
 */
export function setupMissionInfo() {
  const panel = $('mission-info');
  const body = $('mission-info-body');
  const updateScrollEnd = setupScrollFade(panel);

  return {
    show(region, analog, bodyName) {
      const { latitude, longitude } = region.coordinates;
      const bodyLabel = BODY_LABELS[bodyName] ?? bodyName;

      const analogHtml = analog ? analogCard(analog) : '';

      body.innerHTML = `
        <p class="info-id menu-enter" style="--i: 1">${region.regionId}</p>
        <h2 class="info-name menu-enter" style="--i: 2">${region.name}</h2>
        <p class="info-coords menu-enter" style="--i: 3">${formatCoord(latitude, 'N', 'S')} · ${formatCoord(longitude, 'E', 'O')}</p>
        <div class="menu-accent missions-accent" aria-hidden="true"></div>
        ${analogHtml}
        <section class="menu-enter" style="--i: 5">
          <table class="cmp-table">
            <caption class="sr-only">Comparación de variables entre ${bodyLabel} y la Tierra</caption>
            <thead>
              <tr>
                <th scope="col">Variable</th>
                <th scope="col" class="cmp-col-body">${bodyLabel}</th>
                <th scope="col" class="cmp-col-earth">Tierra</th>
              </tr>
            </thead>
            ${comparisonGroup('Variables principales', region.coreVariables ?? {}, CORE_VARIABLES, analog)}
            ${comparisonGroup('Variables de auditoría', region.auditVariables ?? {}, AUDIT_VARIABLES, analog)}
          </table>
        </section>`;
      panel.scrollTop = 0;
      updateScrollEnd();
      panel.classList.remove('is-hidden');
      panel.setAttribute('aria-hidden', 'false');
    },
    hide() {
      panel.classList.add('is-hidden');
      panel.setAttribute('aria-hidden', 'true');
    }
  };
}
