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

const formatCoord = (value, pos, neg) => `${Math.abs(value).toFixed(2)}° ${value >= 0 ? pos : neg}`;
const formatValue = (value, unit) => (value === null || value === undefined ? '—' : `${value}${unit ? ` ${unit}` : ''}`);

/** Filas <dt>/<dd> de un grupo de variables */
function rows(variables, labels) {
  const entries = { ...variables };
  // Profundidad a roca madre: un solo rango en lugar de dos filas
  if ('depth_to_bedrock_min_m' in entries || 'depth_to_bedrock_max_m' in entries) {
    const { depth_to_bedrock_min_m: min, depth_to_bedrock_max_m: max } = entries;
    delete entries.depth_to_bedrock_min_m;
    delete entries.depth_to_bedrock_max_m;
    entries.depth_to_bedrock = min === null && max === null ? null : `${min ?? '?'}–${max ?? '?'}`;
  }
  return Object.entries(entries)
    .map(([key, value]) => {
      const [label, unit] = labels[key] ?? [key, ''];
      return `<div class="info-row"><dt>${label}</dt><dd>${formatValue(value, unit)}</dd></div>`;
    })
    .join('');
}

/**
 * Panel izquierdo con la información de un terreno seleccionado.
 *
 * @returns { show(region, analog), hide() } — `analog`: { region, similarity } o null
 */
export function setupMissionInfo() {
  const panel = $('mission-info');
  const body = $('mission-info-body');

  return {
    show(region, analog) {
      const { latitude, longitude } = region.coordinates;
      const analogHtml = analog
        ? `<section class="menu-enter" style="--i: 4">
            <h3 class="info-section">Análogo terrestre</h3>
            <p class="info-analog">${analog.region.name}</p>
            <dl>
              <div class="info-row"><dt>Similitud (variables principales)</dt><dd>${Math.round(analog.similarity * 100)} %</dd></div>
              <div class="info-row"><dt>Coordenadas</dt><dd>${formatCoord(analog.region.coordinates.latitude, 'N', 'S')} · ${formatCoord(analog.region.coordinates.longitude, 'E', 'O')}</dd></div>
            </dl>
          </section>`
        : '';
      body.innerHTML = `
        <p class="info-id menu-enter" style="--i: 1">${region.regionId}</p>
        <h2 class="info-name menu-enter" style="--i: 2">${region.name}</h2>
        <p class="info-coords menu-enter" style="--i: 3">${formatCoord(latitude, 'N', 'S')} · ${formatCoord(longitude, 'E', 'O')}</p>
        <div class="menu-accent missions-accent" aria-hidden="true"></div>
        ${analogHtml}
        <section class="menu-enter" style="--i: 5">
          <h3 class="info-section">Variables principales</h3>
          <dl>${rows(region.coreVariables ?? {}, CORE_VARIABLES)}</dl>
        </section>
        <section class="menu-enter" style="--i: 6">
          <h3 class="info-section">Variables de auditoría</h3>
          <dl>${rows(region.auditVariables ?? {}, AUDIT_VARIABLES)}</dl>
        </section>`;
      panel.scrollTop = 0;
      panel.classList.remove('is-hidden');
      panel.setAttribute('aria-hidden', 'false');
    },
    hide() {
      panel.classList.add('is-hidden');
      panel.setAttribute('aria-hidden', 'true');
    }
  };
}
