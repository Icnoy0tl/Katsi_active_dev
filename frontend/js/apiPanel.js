import { missionCardContent } from './missionCard.js';

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

const formatSize = (bytes) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);
const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Panel derecho de la vista API (satélite): arrastrar y soltar los dos JSON.
 * Se pueden soltar ambos de golpe sobre el panel (rellenan las ranuras libres en orden)
 * o uno sobre una ranura concreta; también se pueden elegir con el explorador al pulsarla.
 *
 * @param onChange(files) se llama al cargar o quitar un JSON — `files`: { [slotId]: { name, data } | null }
 * @returns { show(), hide(), files }
 */
export function setupApiPanel({ onChange = () => {} } = {}) {
  const panel = $('api-panel');
  const list = $('api-slots');
  const status = $('api-status');
  const input = $('api-file-input');
  const files = Object.fromEntries(SLOTS.map((slot) => [slot.id, null]));
  const buttons = {};
  let pickTarget = null; // ranura que abrió el explorador de archivos

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
    for (const [index, file] of incoming.slice(0, targets.length).entries()) {
      try {
        await load(file, targets[index]);
      } catch (err) {
        errors.push(err.message);
      }
    }
    if (incoming.length > targets.length) errors.push(`Only ${targets.length} file${targets.length > 1 ? 's' : ''} accepted`);
    const loaded = SLOTS.filter((slot) => files[slot.id]).length;
    setStatus(errors.length ? errors.join(' · ') : `${loaded} / ${SLOTS.length} files ready`, errors.length > 0);
    onChange({ ...files });
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
      setStatus(`${SLOTS.filter((s) => files[s.id]).length} / ${SLOTS.length} files ready`);
      onChange({ ...files });
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
  }

  setStatus(`0 / ${SLOTS.length} files ready`);

  return {
    show: () => setVisible(true),
    hide: () => setVisible(false),
    files
  };
}
