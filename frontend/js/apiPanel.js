import { EARTH_ICON, RETRY_ICON, missionCardContent } from './missionCard.js';
import { fetchCustomAnalogs } from './analogs.js';
import { formatLatLon } from './utils/format.js';
import { setupScrollFade } from './utils/scrollFade.js';

const $ = (id) => document.getElementById(id);

const FILE_ICON =
  '<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5Z"/><path d="M14 3v4.5h4.5M10 12.5l-2 2 2 2M14 12.5l2 2-2 2"/></svg>';
const UPLOAD_ICON =
  '<svg class="menu-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 20h16"/></svg>';
const REMOVE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

/**
 * Ranuras del panel: los dos JSON que recibe `POST /api/analog/custom` (backend/custom.go),
 * con el `id` como clave del cuerpo de la petición
 */
const SLOTS = [
  { id: 'characteristics', title: 'Region characteristics' },
  { id: 'mission', title: 'Mission' }
];
const ANALOGS_PER_REGION = 3; // los que devuelve el backend (topK)

const formatSize = (bytes) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const percent = (x) => Math.round(x * 100);

/** Tarjeta de análogo terrestre (mismo diseño que en la comparativa, sin acción) */
function analogCard({ region, similarity }, i) {
  const score = percent(similarity);
  return `<li class="menu-enter" style="--i: ${i}">
      <div class="menu-tag menu-tag--mission api-result">${missionCardContent({
        icon: EARTH_ICON,
        title: escapeHtml(region.name),
        meta: `${escapeHtml(region.regionId)} · ${formatLatLon(region.coordinates)}`,
        trailing: `<span class="menu-score" style="--score: ${score}" aria-label="${score}% similarity"><b>${score}%</b></span>`
      })}</div>
    </li>`;
}

function skeletonCard(i) {
  return `<li class="menu-enter" style="--i: ${i}">
      <div class="menu-tag menu-tag--mission is-pending is-skeleton" aria-hidden="true">${missionCardContent({
        icon: EARTH_ICON,
        title: '<span class="skeleton-bar"></span>',
        meta: '<span class="skeleton-bar skeleton-bar--short"></span>',
        trailing: '<span class="menu-score" style="--score: 0"></span>'
      })}</div>
    </li>`;
}

/** Fallo: el mensaje del backend (datos rechazados) o reintentar si no respondió */
function errorCard(error) {
  const canRetry = !error.fromBackend;
  const tag = canRetry ? 'button type="button" data-retry' : 'div';
  return `<li class="menu-enter" style="--i: 0">
      <${tag} class="menu-tag menu-tag--mission api-result${canRetry ? '' : ' is-error'}">${missionCardContent({
        icon: canRetry ? RETRY_ICON : FILE_ICON,
        title: canRetry ? 'Earth analogs unavailable' : 'Data rejected',
        meta: canRetry ? 'The analogs service did not respond · Retry' : escapeHtml(error.message),
        trailing: ''
      })}</${tag.split(' ')[0]}>
    </li>`;
}

/** Bloque de una región del usuario: nombre, cobertura de sus datos y sus análogos */
function regionResult(result, multiple) {
  const { selectedRegion, matches = [], dataCoverage, extrapolation } = result;
  const notes = [`Data covers ${percent(dataCoverage)}% of the mission weight`];
  if (extrapolation?.dominant) notes.push('mostly outside the range of any Earth site');
  const heading = multiple
    ? `<h3 class="api-region menu-enter" style="--i: 0">${escapeHtml(selectedRegion.name)}</h3>`
    : '';
  return `${heading}
    <p class="api-note menu-enter${dataCoverage < 0.5 || extrapolation?.dominant ? ' is-warning' : ''}" style="--i: 0">${notes.join(' · ')}</p>
    <ul class="menu-options">${matches.map(analogCard).join('')}</ul>`;
}

/**
 * Panel derecho de la vista API (satélite): arrastrar y soltar los dos JSON y ver los análogos
 * terrestres que calcula el backend. Se pueden soltar ambos de golpe sobre el panel (rellenan
 * las ranuras libres en orden) o uno sobre una ranura concreta; también se pueden elegir con el
 * explorador al pulsarla. Con los dos cargados se envían solos; cambiar uno repite el cálculo.
 *
 * @returns { show(), hide() }
 */
export function setupApiPanel() {
  const panel = $('api-panel');
  const list = $('api-slots');
  const status = $('api-status');
  const input = $('api-file-input');
  const results = $('api-results');
  const files = Object.fromEntries(SLOTS.map((slot) => [slot.id, null]));
  const buttons = {};
  let pickTarget = null; // ranura que abrió el explorador de archivos
  let request = 0; // petición más reciente (las anteriores se descartan)
  const updateScrollEnd = setupScrollFade(panel);

  function renderSlot(slot) {
    const file = files[slot.id];
    const button = buttons[slot.id];
    button.classList.toggle('is-loaded', Boolean(file));
    button.innerHTML = missionCardContent({
      icon: FILE_ICON,
      title: slot.title,
      meta: file ? `${escapeHtml(file.name)} · ${formatSize(file.size)}` : 'Drop .json here or click to browse',
      trailing: file ? '' : UPLOAD_ICON
    });
    button.setAttribute('aria-label', file ? `${slot.title}: ${file.name} loaded. Replace file` : `Upload ${slot.title}`);
    button.parentElement.querySelector('.api-remove').hidden = !file;
  }

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }

  const loadedCount = () => SLOTS.filter((slot) => files[slot.id]).length;
  const readyStatus = () => `${loadedCount()} / ${SLOTS.length} files ready`;

  function showResults(html, title = 'Earth analogs') {
    results.hidden = !html;
    results.innerHTML = html
      ? `<h2 class="missions-title menu-enter" style="--i: 0">${title}</h2>
         <div class="menu-accent missions-accent" aria-hidden="true"></div>${html}`
      : '';
    updateScrollEnd();
  }

  /** Envía los dos JSON al backend y pinta los análogos de cada región */
  async function analyze() {
    const id = ++request;
    if (loadedCount() < SLOTS.length) {
      showResults('');
      return;
    }
    results.setAttribute('aria-busy', 'true');
    showResults(`<ul class="menu-options">${Array.from({ length: ANALOGS_PER_REGION }, (_, i) => skeletonCard(i)).join('')}</ul>`);
    try {
      const { mission, results: regions = [] } = await fetchCustomAnalogs(files.characteristics.data, files.mission.data);
      if (id !== request) return;
      const multiple = regions.length > 1;
      showResults(
        regions.map((result) => regionResult(result, multiple)).join(''),
        `Earth analogs · <b>${escapeHtml(mission?.mission ?? 'custom')}</b>`
      );
    } catch (error) {
      if (id !== request) return;
      showResults(`<ul class="menu-options">${errorCard(error)}</ul>`);
    } finally {
      if (id === request) results.removeAttribute('aria-busy');
    }
  }

  results.addEventListener('click', (event) => {
    if (event.target.closest('[data-retry]')) analyze();
  });

  async function load(file, slotId) {
    if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
      throw new Error(`${file.name} is not a .json file`);
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error(`${file.name} is not valid JSON`);
    }
    files[slotId] = { name: file.name, size: file.size, data };
    renderSlot(SLOTS.find((slot) => slot.id === slotId));
  }

  /** Carga los archivos: en la ranura indicada o, sin ella, en las libres por orden */
  async function accept(fileList, slotId = null) {
    const incoming = [...fileList];
    if (!incoming.length) return;
    const targets = slotId
      ? [slotId]
      : SLOTS.map((slot) => slot.id).sort((a, b) => Number(Boolean(files[a])) - Number(Boolean(files[b])));
    const errors = [];
    let loaded = 0;
    for (const [index, file] of incoming.slice(0, targets.length).entries()) {
      try {
        await load(file, targets[index]);
        loaded++;
      } catch (err) {
        errors.push(err.message);
      }
    }
    if (incoming.length > targets.length) errors.push(`Only ${targets.length} file${targets.length > 1 ? 's' : ''} accepted`);
    setStatus(errors.length ? errors.join(' · ') : readyStatus(), errors.length > 0);
    if (loaded) analyze();
  }

  // Ranuras
  SLOTS.forEach((slot, index) => {
    const item = document.createElement('li');
    item.className = 'menu-enter api-slot';
    item.style.setProperty('--i', String(index + 2));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-tag menu-tag--mission api-drop';
    button.addEventListener('click', () => {
      pickTarget = slot.id;
      input.click();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'api-remove';
    remove.setAttribute('aria-label', `Remove ${slot.title}`);
    remove.innerHTML = REMOVE_ICON;
    remove.addEventListener('click', () => {
      files[slot.id] = null;
      renderSlot(slot);
      setStatus(readyStatus());
      analyze(); // con un archivo menos se vacían los resultados (y se descarta la petición en curso)
    });
    item.append(button, remove);
    list.appendChild(item);
    buttons[slot.id] = button;
    renderSlot(slot);
  });

  input.addEventListener('change', () => {
    accept(input.files, pickTarget);
    input.value = '';
    pickTarget = null;
  });

  // Arrastrar y soltar: el panel entero acepta; la ranura bajo el cursor se resalta
  let dragDepth = 0;
  const slotUnder = (event) => event.target.closest?.('.api-slot')?.querySelector('.api-drop');
  const clearHover = () => Object.values(buttons).forEach((b) => b.classList.remove('is-drag-over'));

  panel.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth++;
    panel.classList.add('is-dragging');
  });
  panel.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    clearHover();
    slotUnder(event)?.classList.add('is-drag-over');
  });
  panel.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      panel.classList.remove('is-dragging');
      clearHover();
    }
  });
  panel.addEventListener('drop', (event) => {
    event.preventDefault();
    const target = slotUnder(event);
    const slotId = target ? Object.keys(buttons).find((id) => buttons[id] === target) : null;
    dragDepth = 0;
    panel.classList.remove('is-dragging');
    clearHover();
    // Soltar varios sobre una ranura los reparte igualmente por orden
    accept(event.dataTransfer.files, event.dataTransfer.files.length > 1 ? null : slotId);
  });

  // Soltar fuera del panel no debe abrir el JSON en la pestaña
  ['dragover', 'drop'].forEach((type) =>
    window.addEventListener(type, (event) => {
      if (!panel.contains(event.target)) event.preventDefault();
    })
  );

  function setVisible(visible) {
    panel.classList.toggle('is-hidden', !visible);
    panel.setAttribute('aria-hidden', String(!visible));
    if (visible) updateScrollEnd(); // el tamaño pudo cambiar mientras estaba oculto
  }

  setStatus(readyStatus());

  return {
    show: () => setVisible(true),
    hide: () => setVisible(false)
  };
}
