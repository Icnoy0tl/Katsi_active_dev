import { setupScrollFade } from './utils/scrollFade.js';
import { escapeHtml, formatLatLon } from './utils/format.js';
import { ARROW_ICON, MISSION_ICONS, PIN_ICON, RETRY_ICON, missionCardContent } from './missionCard.js';
import { MISSION_FILTERS } from './config.js';

const $ = (id) => document.getElementById(id);

/** Tarjetas esqueleto mientras el backend calcula los terrenos de la misión */
const SKELETON_CARDS = 4;

/** Paso 1: una tarjeta por misión ('' = misión libre, todos los terrenos sin pedir nada al backend) */
const missionCard = ({ id, card, title, showcase }, index) => `<li class="menu-enter" style="--i: ${index + 2}">
    <button type="button" class="menu-tag menu-tag--mission" data-mission="${id}" data-showcase="${showcase ?? ''}">${missionCardContent({
      icon: MISSION_ICONS[id] ?? PIN_ICON,
      title: card,
      meta: title,
      trailing: ARROW_ICON
    })}</button>
  </li>`;

/** Paso 2: misión elegida sobre los terrenos; al pulsarla se vuelve a elegir misión */
const chosenMission = (filter) => {
  const { label } = MISSION_FILTERS.find((f) => f.id === filter);
  return `<button type="button" class="mission-filter-option" data-change aria-pressed="true" title="Choose another mission">‹ ${filter ? label : 'Free'} mission · change</button>`;
};

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
 * Panel lateral izquierdo en dos pasos, compartido por la Luna y Marte:
 * 1. Tarjetas de misión (MISSION_FILTERS); al pasar por una se muestra su objeto (`onPreview`).
 * 2. Terrenos (regiones) del cuerpo para la misión elegida. En la misión libre se listan todos
 *    los del JSON; con otra, el backend calcula cuáles sirven y en qué orden (`setRanking`), y
 *    cada tarjeta muestra la similitud de su mejor análogo terrestre. Encima, la misión elegida
 *    permite volver al paso 1.
 *
 * @param onSelect(region) se llama al pulsar un terreno
 * @param onFilterChange(filter) se llama al elegir misión (o al volver al paso 1, con ''): con una
 *        de misión, quien llama pide el ranking y lo pasa con `setRanking` (mientras, esqueletos)
 * @param onRetry() se llama al pulsar «reintentar» tras un fallo del backend
 * @param onPreview(showcase) objeto de la tarjeta de misión bajo el puntero o el foco
 *        ('body' | 'rover' | 'antenna' | 'solarPanel' | null; ver MISSION_FILTERS)
 * @param onChoosingChange(choosing) se llama al entrar (true) o salir (false) del paso 1 con el
 *        panel visible: mientras se elige misión solo se ven el objeto y el espacio
 * @returns { show(regions), hide(), reset(), setRanking(ranked), setRankingError(), filter }
 *          `regions`: del JSON ({ regionId, name, coordinates });
 *          `ranked`: [{ region, score, bestAnalog }] de mejor a peor
 */
export function setupMissionsPanel({ onSelect, onFilterChange, onRetry, onPreview, onChoosingChange }) {
  const panel = $('missions-panel');
  const backdrop = $('missions-backdrop');
  const list = $('missions-list');
  const count = $('missions-count');
  const heading = $('missions-heading');
  const filters = $('missions-filter');
  const status = $('missions-status');
  const updateScrollEnd = setupScrollFade(panel);

  let filter = null; // misión elegida; null = paso 1 (eligiendo misión)
  let regions = []; // todos los terrenos del cuerpo enfocado
  let ranked = null; // terrenos del filtro activo (null = cargando)
  let failed = false;
  let items = []; // lo que muestran las tarjetas, en orden

  let visible = false;
  let choosingShown = false; // último estado avisado con onChoosingChange
  const syncChoosing = () => {
    const choosing = visible && filter === null;
    if (choosing === choosingShown) return;
    choosingShown = choosing;
    onChoosingChange?.(choosing);
  };

  let previewed = null;
  const preview = (showcase) => {
    if (showcase === previewed) return;
    previewed = showcase;
    onPreview?.(showcase);
  };

  function render() {
    let html;
    let total = regions.length;
    items = [];
    const choosing = filter === null;
    heading.textContent = choosing ? 'Choose a mission' : 'Available terrains';
    filters.innerHTML = choosing ? '' : chosenMission(filter);
    filters.hidden = choosing;
    list.setAttribute('aria-label', choosing ? 'Missions: pick one to see its terrains' : 'Terrains: pick one to see its Earth analogs');
    if (choosing) {
      total = MISSION_FILTERS.length;
      html = MISSION_FILTERS.map(missionCard).join('');
    } else if (!filter) {
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
    syncChoosing();
  }

  /** Cambia de paso: misión elegida (paso 2) o `null` para volver a elegir (paso 1) */
  function setFilter(next) {
    filter = next;
    ranked = null;
    failed = false;
    preview(null);
    render();
    onFilterChange?.(filter ?? '');
  }

  filters.addEventListener('click', (event) => {
    if (event.target.closest('button[data-change]')) setFilter(null);
  });

  // Objeto de la misión bajo el puntero o con el foco; se recoge al salir de la lista
  const showcaseOf = (target) => {
    const card = target?.closest?.('button[data-mission]');
    return card ? card.dataset.showcase || null : undefined;
  };
  list.addEventListener('pointerover', (event) => {
    const showcase = showcaseOf(event.target);
    if (showcase !== undefined) preview(showcase);
  });
  list.addEventListener('pointerleave', () => preview(null));
  list.addEventListener('focusin', (event) => {
    const showcase = showcaseOf(event.target);
    if (showcase !== undefined) preview(showcase);
  });
  list.addEventListener('focusout', (event) => {
    if (!list.contains(event.relatedTarget)) preview(null);
  });

  list.addEventListener('click', (event) => {
    if (event.target.closest('button[data-retry]')) {
      failed = false;
      render();
      onRetry?.();
      return;
    }
    const mission = event.target.closest('button[data-mission]');
    if (mission) {
      setFilter(mission.dataset.mission);
      return;
    }
    const card = event.target.closest('button[data-index]');
    if (card) onSelect(items[Number(card.dataset.index)].region);
  });

  function setVisible(show) {
    visible = show;
    panel.classList.toggle('is-hidden', !visible);
    backdrop.classList.toggle('is-hidden', !visible);
    panel.setAttribute('aria-hidden', String(!visible));
    if (!visible) preview(null);
    syncChoosing();
  }

  return {
    /** Perfil de misión elegido ('' = misión libre o aún sin elegir) */
    get filter() {
      return filter ?? '';
    },
    /** Vuelve al paso 1 (elegir misión), p. ej. al llegar desde el menú principal */
    reset() {
      filter = null;
      ranked = null;
      failed = false;
      preview(null);
      render();
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
