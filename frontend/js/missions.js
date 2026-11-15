import { setupScrollFade } from './utils/scrollFade.js';
import { escapeHtml, formatLatLon } from './utils/format.js';
import { ARROW_ICON, PIN_ICON, RETRY_ICON, missionCardContent } from './missionCard.js';
import { MISSION_FILTERS } from './config.js';

const $ = (id) => document.getElementById(id);

/** Tarjetas esqueleto mientras el backend calcula los terrenos de la misión */
const SKELETON_CARDS = 4;

/** Selector del perfil de misión (uno activo); '' = todos los terrenos, sin pedir nada al backend */
const filterBar = () =>
  MISSION_FILTERS.map(
    ({ id, label, title }) =>
      `<button type="button" class="mission-filter-option" data-filter="${id}" title="${title}" aria-pressed="false">${label}</button>`
  ).join('');

/** Anillo con la similitud del mejor análogo terrestre del terreno para la misión */
const scoreRing = (score) => {
  const percent = Math.round(score * 100);
  return `<span class="menu-score" style="--score: ${percent}" aria-label="Best Earth analog: ${percent}% similarity"><b>${percent}%</b></span>`;
};

function regionCard({ region, score, bestAnalog }, index) {
  const ranked = score !== undefined;
  return `<li class="menu-enter" style="--i: ${index + 3}">
      <button type="button" class="menu-tag menu-tag--mission" data-index="${index}">${missionCardContent({
        icon: PIN_ICON,
        title: escapeHtml(region.name),
        meta: ranked
          ? `${region.regionId} · Earth: ${bestAnalog.name}`
          : `${region.regionId} · ${formatLatLon(region.coordinates)}`,
        trailing: ranked ? scoreRing(score) : ARROW_ICON
      })}</button>
    </li>`;
}

const skeletonCard = (index) => `<li class="menu-enter" style="--i: ${index + 3}">
    <div class="menu-tag menu-tag--mission is-pending is-skeleton" aria-hidden="true">${missionCardContent({
      icon: PIN_ICON,
      title: '<span class="skeleton-bar"></span>',
      meta: '<span class="skeleton-bar skeleton-bar--short"></span>',
      trailing: '<span class="menu-score" style="--score: 0"></span>'
    })}</div>
  </li>`;

const messageCard = ({ title, meta, retry }) => `<li class="menu-enter" style="--i: 3">
    <${retry ? 'button type="button" data-retry' : 'div'} class="menu-tag menu-tag--mission${retry ? '' : ' is-pending'}">${missionCardContent({
      icon: retry ? RETRY_ICON : PIN_ICON,
      title,
      meta,
      trailing: ''
    })}</${retry ? 'button' : 'div'}>
  </li>`;

/**
 * Panel lateral izquierdo con los terrenos (regiones) de un cuerpo y, encima, el filtro de
 * misión. Sin filtro se listan todos los terrenos del JSON; con un filtro, el backend calcula
 * cuáles sirven para esa misión y en qué orden (`setRanking`), y cada tarjeta muestra la
 * similitud de su mejor análogo terrestre. Un solo panel compartido por la Luna y Marte.
 *
 * @param onSelect(region) se llama al pulsar un terreno
 * @param onFilterChange(filter) se llama al elegir otro filtro: con uno de misión, quien llama pide
 *        el ranking y lo pasa con `setRanking` (mientras tanto se muestran esqueletos)
 * @param onRetry() se llama al pulsar «reintentar» tras un fallo del backend
 * @returns { show(regions), hide(), setRanking(ranked), setRankingError(), filter }
 *          `regions`: del JSON ({ regionId, name, coordinates });
 *          `ranked`: [{ region, score, bestAnalog }] de mejor a peor
 */
export function setupMissionsPanel({ onSelect, onFilterChange, onRetry }) {
  const panel = $('missions-panel');
  const backdrop = $('missions-backdrop');
  const list = $('missions-list');
  const count = $('missions-count');
  const filters = $('missions-filter');
  const status = $('missions-status');
  const updateScrollEnd = setupScrollFade(panel);

  let filter = MISSION_FILTERS[0].id;
  let regions = []; // todos los terrenos del cuerpo enfocado
  let ranked = null; // terrenos del filtro activo (null = cargando)
  let failed = false;
  let items = []; // lo que muestran las tarjetas, en orden

  filters.innerHTML = filterBar();
  const syncFilterButtons = () =>
    filters.querySelectorAll('button[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
  syncFilterButtons();

  function render() {
    let html;
    let total = regions.length;
    items = [];
    if (!filter) {
      items = regions.map((region) => ({ region }));
      html = items.map(regionCard).join('');
    } else if (failed) {
      html = messageCard({ title: 'Mission ranking unavailable', meta: 'The analogs service did not respond · Retry', retry: true });
      status.textContent = 'Mission ranking unavailable.';
    } else if (!ranked) {
      html = Array.from({ length: SKELETON_CARDS }, (_, i) => skeletonCard(i)).join('');
      status.textContent = 'Ranking terrains for the mission…';
    } else if (!ranked.length) {
      total = 0;
      html = messageCard({ title: 'No suitable terrain', meta: 'No terrain has enough data for this mission' });
    } else {
      items = ranked;
      total = ranked.length;
      html = items.map(regionCard).join('');
    }
    if (!filter || (ranked && !failed)) status.textContent = '';
    count.textContent = String(total);
    list.innerHTML = html;
    list.setAttribute('aria-busy', String(Boolean(filter) && !ranked && !failed));
    panel.scrollTop = 0;
    updateScrollEnd();
  }

  filters.addEventListener('click', (event) => {
    const option = event.target.closest('button[data-filter]');
    if (!option || option.dataset.filter === filter) return;
    filter = option.dataset.filter;
    ranked = null;
    failed = false;
    syncFilterButtons();
    render();
    onFilterChange?.(filter);
  });

  list.addEventListener('click', (event) => {
    if (event.target.closest('button[data-retry]')) {
      failed = false;
      render();
      onRetry?.();
      return;
    }
    const card = event.target.closest('button[data-index]');
    if (card) onSelect(items[Number(card.dataset.index)].region);
  });

  function setVisible(visible) {
    panel.classList.toggle('is-hidden', !visible);
    backdrop.classList.toggle('is-hidden', !visible);
    panel.setAttribute('aria-hidden', String(!visible));
  }

  return {
    /** Perfil de misión elegido ('' = sin filtro) */
    get filter() {
      return filter;
    },
    /** Muestra el panel con los terrenos de un cuerpo; con un filtro activo, en espera del ranking */
    show(bodyRegions) {
      if (bodyRegions !== regions) {
        regions = bodyRegions;
        ranked = null;
        failed = false;
        render();
      }
      setVisible(true);
      updateScrollEnd(); // el tamaño del panel puede haber cambiado mientras estaba oculto
    },
    hide() {
      setVisible(false);
    },
    /** Terrenos del filtro activo, de mejor a peor (los esqueletos dejan paso a las tarjetas) */
    setRanking(rankedRegions) {
      ranked = rankedRegions;
      failed = false;
      render();
    },
    /** El backend no respondió: tarjeta para reintentar */
    setRankingError() {
      ranked = null;
      failed = true;
      render();
    }
  };
}
