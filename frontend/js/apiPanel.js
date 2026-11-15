import { ARROW_ICON, EARTH_ICON, PIN_ICON, RETRY_ICON, missionCardContent } from './missionCard.js';
import { fetchCustomAnalogs } from './analogs.js';
import { BODIES, customRegions, guessBody } from './customRegions.js';
import { escapeHtml, formatLatLon } from './utils/format.js';
import { setupScrollFade } from './utils/scrollFade.js';

const $ = (id) => document.getElementById(id);

const FILE_ICON =
  '<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5Z"/><path d="M14 3v4.5h4.5M10 12.5l-2 2 2 2M14 12.5l2 2-2 2"/></svg>';
const UPLOAD_ICON =
  '<svg class="menu-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 20h16"/></svg>';
const TRASH_ICON =
  '<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10.5 10.5v5.5M13.5 10.5v5.5"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
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

const BODY_LABELS = { moon: 'Moon', mars: 'Mars' };
const CLEAR_CONFIRM_MS = 4000; // «Remove my implementations» pide un segundo clic dentro de este plazo

const formatSize = (bytes) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);
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

/** Fallo: el mensaje del backend (datos rechazados) o reintentar si no respondió */
function errorCard(error) {
  const canRetry = !error.fromBackend;
  const tag = canRetry ? 'button type="button" data-retry' : 'div';
  return `<li class="menu-enter" style="--i: 0">
      <${tag} class="menu-tag menu-tag--mission api-result${canRetry ? '' : ' is-error'}">${missionCardContent({
        icon: canRetry ? RETRY_ICON : FILE_ICON,
        title: canRetry ? 'Earth analogs unavailable' : 'Data rejected',
        meta: canRetry ? 'Free server may be waking up · Retry' : escapeHtml(error.message),
        trailing: ''
      })}</${tag.split(' ')[0]}>
    </li>`;
}

/**
 * Botón para mostrar los análogos: apagado mientras el backend verifica los datos y activo
 * cuando los aceptó (los resultados ya están calculados, al pulsarlo aparecen al instante)
 */
function revealCard(ready) {
  const meta = ready
    ? `Data verified · ${ready.analogs} analog${ready.analogs === 1 ? '' : 's'}${ready.regions > 1 ? ` in ${ready.regions} regions` : ''}`
    : 'Verifying data…';
  return `<li class="menu-enter" style="--i: 0">
      <button type="button" class="menu-tag menu-tag--mission api-result api-reveal${ready ? '' : ' is-pending'}"
        data-reveal${ready ? '' : ' disabled aria-disabled="true"'}>${missionCardContent({
          icon: EARTH_ICON,
          title: 'Show Earth analogs',
          meta,
          trailing: ARROW_ICON
        })}</button>
    </li>`;
}

/**
 * Acciones de una región analizada: añadirla al sistema (al cuerpo que indiquen sus datos, o a
 * elegir si no lo dicen) o, si ya está guardada con esta misión, ir a verla
 */
function saveActions(result, index, missionName, planet) {
  const { selectedRegion } = result;
  const saved = customRegions.get(selectedRegion.regionId);
  if (saved && saved.mission === missionName) {
    return `<span class="api-saved-tag">${CHECK_ICON}Added to ${BODY_LABELS[saved.body]}</span>
      <button type="button" class="api-action" data-open="${escapeHtml(selectedRegion.regionId)}">View it</button>`;
  }
  const body = guessBody(selectedRegion, planet);
  return (body ? [body] : BODIES)
    .map(
      (b) =>
        `<button type="button" class="api-action" data-save="${index}" data-body="${b}">${saved ? 'Update on' : 'Add to'} ${BODY_LABELS[b]}</button>`
    )
    .join('');
}

/** Bloque de una región del usuario: nombre, cobertura de sus datos, sus análogos y guardarla */
function regionResult(result, index, multiple) {
  const { selectedRegion, matches = [], dataCoverage, extrapolation } = result;
  const notes = [`Data covers ${percent(dataCoverage)}% of the mission weight`];
  if (extrapolation?.dominant) notes.push('mostly outside the range of any Earth site');
  const heading = multiple
    ? `<h3 class="api-region menu-enter" style="--i: 0">${escapeHtml(selectedRegion.name)}</h3>`
    : '';
  return `${heading}
    <p class="api-note menu-enter${dataCoverage < 0.5 || extrapolation?.dominant ? ' is-warning' : ''}" style="--i: 0">${notes.join(' · ')}</p>
    <ul class="menu-options">${matches.map(analogCard).join('')}</ul>
    <div class="api-save-row menu-enter" style="--i: ${matches.length}" data-save-row="${index}"></div>`;
}

/** Terreno guardado en «My implementations»: pulsarlo lleva a él; la X lo quita del sistema */
function savedCard({ body, region, mission }, i) {
  const id = escapeHtml(region.regionId);
  return `<li class="menu-enter api-slot" style="--i: ${i}">
      <button type="button" class="menu-tag menu-tag--mission api-saved-item" data-open="${id}" aria-label="Go to ${escapeHtml(region.name)} on ${BODY_LABELS[body]}">${missionCardContent({
        icon: PIN_ICON,
        title: escapeHtml(region.name),
        meta: `${BODY_LABELS[body]} · ${id} · ${escapeHtml(mission)}`,
        trailing: ''
      })}</button>
      <button type="button" class="api-remove" data-remove="${id}" aria-label="Remove ${escapeHtml(region.name)} from the system">${REMOVE_ICON}</button>
    </li>`;
}

function clearCard(count, confirming, i) {
  const plural = count === 1 ? '' : 's';
  return `<li class="menu-enter" style="--i: ${i}">
      <button type="button" class="menu-tag menu-tag--mission api-clear${confirming ? ' is-confirming' : ''}" data-clear>${missionCardContent({
        icon: TRASH_ICON,
        title: 'Remove my implementations',
        meta: confirming ? 'Click again to remove them all' : `${count} terrain${plural} saved in this browser`,
        trailing: ''
      })}</button>
    </li>`;
}

/**
 * Panel derecho de la vista API (satélite): arrastrar y soltar los dos JSON y ver los análogos
 * terrestres que calcula el backend. Se pueden soltar ambos de golpe sobre el panel (rellenan
 * las ranuras libres en orden) o uno sobre una ranura concreta; también se pueden elegir con el
 * explorador al pulsarla. Con los dos cargados se verifican solos en el backend y, si los acepta,
 * aparece un botón que muestra las tarjetas; cambiar o quitar un archivo vuelve a empezar.
 *
 * Cada región analizada se puede añadir al sistema (customRegions.js: Luna o Marte, guardada en
 * este navegador). La sección «My implementations» lista las guardadas, lleva a ellas y permite
 * quitarlas una a una o todas («Remove my implementations», con confirmación).
 *
 * @param onOpenSaved(regionId) se llama al pulsar un terreno guardado (o «View it»)
 * @returns { show(), hide() }
 */
export function setupApiPanel({ onOpenSaved } = {}) {
  const panel = $('api-panel');
  const list = $('api-slots');
  const status = $('api-status');
  const input = $('api-file-input');
  const results = $('api-results');
  const savedSection = $('api-saved');
  const savedList = $('api-saved-list');
  const files = Object.fromEntries(SLOTS.map((slot) => [slot.id, null]));
  const buttons = {};
  let pickTarget = null; // ranura que abrió el explorador de archivos
  let request = 0; // petición más reciente (las anteriores se descartan)
  let shown = null; // análogos a la vista (los de `ready` tras pulsar «Show Earth analogs»)
  let ready = null; // análogos verificados a la espera de que se pulse «Show Earth analogs»
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
      ? `<h2 class="missions-title menu-enter" style="--i: 0" tabindex="-1">${title}</h2>
         <div class="menu-accent missions-accent" aria-hidden="true"></div>${html}`
      : '';
    updateScrollEnd();
  }

  /**
   * Envía los dos JSON al backend, que los verifica y calcula los análogos. Si los acepta, se
   * guardan y se ofrece el botón para mostrarlos; si no, se enseña el motivo (o reintentar).
   */
  async function analyze() {
    const id = ++request;
    ready = null;
    shown = null;
    if (loadedCount() < SLOTS.length) {
      showResults('');
      return;
    }
    results.setAttribute('aria-busy', 'true');
    showResults(`<ul class="menu-options">${revealCard(null)}</ul>`);
    try {
      const { mission, results: regions = [] } = await fetchCustomAnalogs(files.characteristics.data, files.mission.data);
      if (id !== request) return;
      const multiple = regions.length > 1;
      ready = {
        html: regions.map((result, index) => regionResult(result, index, multiple)).join(''),
        title: `Earth analogs · <b>${escapeHtml(mission?.mission ?? 'custom')}</b>`,
        results: regions,
        missionName: mission?.mission ?? 'custom',
        planet: files.characteristics.data?.planet,
        regions: regions.length,
        analogs: regions.reduce((sum, result) => sum + (result.matches?.length ?? 0), 0)
      };
      showResults(`<ul class="menu-options">${revealCard(ready)}</ul>`);
    } catch (error) {
      if (id !== request) return;
      showResults(`<ul class="menu-options">${errorCard(error)}</ul>`);
    } finally {
      if (id === request) results.removeAttribute('aria-busy');
    }
  }

  /** Sustituye el botón por las tarjetas ya calculadas (con su entrada escalonada) */
  function reveal() {
    if (!ready) return;
    showResults(ready.html, ready.title);
    shown = ready;
    syncSaveRows();
    results.querySelector('h2')?.focus({ preventScroll: true });
  }

  /** Botones de guardar de cada región, según lo que ya esté en el sistema */
  function syncSaveRows() {
    if (!shown) return;
    results.querySelectorAll('[data-save-row]').forEach((row) => {
      const index = Number(row.dataset.saveRow);
      row.innerHTML = saveActions(shown.results[index], index, shown.missionName, shown.planet);
    });
  }

  function saveRegion(index, body) {
    const { selectedRegion, matches = [] } = shown.results[index];
    customRegions.save({ body, region: selectedRegion, mission: shown.missionName, matches });
    setStatus(`${selectedRegion.name} added to ${BODY_LABELS[body]}`);
  }

  results.addEventListener('click', (event) => {
    const target = event.target.closest('[data-retry], [data-reveal], [data-save], [data-open]');
    if (!target) return;
    if ('retry' in target.dataset) analyze();
    else if ('reveal' in target.dataset) reveal();
    else if ('save' in target.dataset) saveRegion(Number(target.dataset.save), target.dataset.body);
    else onOpenSaved?.(target.dataset.open);
  });

  // «My implementations»: terrenos guardados en este navegador
  let confirmTimer = 0;
  function renderSaved(confirming = false) {
    const entries = customRegions.all();
    clearTimeout(confirmTimer);
    savedSection.hidden = !entries.length;
    savedList.innerHTML = entries.length
      ? entries.map(savedCard).join('') + clearCard(entries.length, confirming, entries.length)
      : '';
    if (confirming) confirmTimer = setTimeout(() => renderSaved(false), CLEAR_CONFIRM_MS);
    updateScrollEnd();
  }

  savedList.addEventListener('click', (event) => {
    const target = event.target.closest('[data-open], [data-remove], [data-clear]');
    if (!target) return;
    if ('open' in target.dataset) onOpenSaved?.(target.dataset.open);
    else if ('remove' in target.dataset) {
      const entry = customRegions.get(target.dataset.remove);
      customRegions.remove(target.dataset.remove);
      if (entry) setStatus(`${entry.region.name} removed from the system`);
    } else if (!target.classList.contains('is-confirming')) {
      renderSaved(true); // primer clic: pide confirmación
      savedList.querySelector('[data-clear]')?.focus();
    } else {
      customRegions.clear();
      setStatus('Your terrains were removed from the system');
    }
  });

  customRegions.subscribe(() => {
    renderSaved();
    syncSaveRows();
  });
  renderSaved();

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
