const $ = (id) => document.getElementById(id);

// Mismos trazos que los iconos del menú principal
const PIN_ICON =
  '<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/></svg>';
const ARROW_ICON =
  '<svg class="menu-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="m14 6 6 6-6 6"/></svg>';

const formatCoord = (value, pos, neg) => `${Math.abs(value).toFixed(2)}° ${value >= 0 ? pos : neg}`;

/**
 * Panel lateral izquierdo con las misiones (regiones) disponibles de un cuerpo.
 * Un solo panel compartido: al mostrarlo con otras regiones se reconstruye la lista.
 *
 * @param onSelect(region) se llama al pulsar una misión
 * @returns { show(regions), hide() } — `regions`: del JSON ({ regionId, name, coordinates })
 */
export function setupMissionsPanel({ onSelect }) {
  const panel = $('missions-panel');
  const backdrop = $('missions-backdrop');
  const list = $('missions-list');
  const count = $('missions-count');
  let shownRegions = null;

  function render(regions) {
    count.textContent = String(regions.length);
    const fragment = document.createDocumentFragment();
    regions.forEach((region, index) => {
      const { latitude, longitude } = region.coordinates;
      const item = document.createElement('li');
      item.className = 'menu-enter';
      item.style.setProperty('--i', String(index + 2)); // después del título y la línea de acento
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'menu-tag menu-tag--mission';
      button.innerHTML = `
        <span class="menu-icon-box">${PIN_ICON}</span>
        <span class="menu-divider"></span>
        <span class="menu-label">
          <span>${region.name}</span>
          <span class="mission-meta">${region.regionId} · ${formatCoord(latitude, 'N', 'S')}, ${formatCoord(longitude, 'E', 'O')}</span>
        </span>
        ${ARROW_ICON}`;
      button.addEventListener('click', () => onSelect(region));
      item.appendChild(button);
      fragment.appendChild(item);
    });
    list.replaceChildren(fragment);
    panel.scrollTop = 0;
  }

  function setVisible(visible) {
    panel.classList.toggle('is-hidden', !visible);
    backdrop.classList.toggle('is-hidden', !visible);
    panel.setAttribute('aria-hidden', String(!visible));
  }

  return {
    show(regions) {
      if (regions !== shownRegions) {
        shownRegions = regions;
        render(regions);
      }
      setVisible(true);
    },
    hide() {
      setVisible(false);
    }
  };
}
