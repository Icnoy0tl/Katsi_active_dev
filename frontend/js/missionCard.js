/*
 * Contenido de las tarjetas de misión y de análogo (mismo diseño que las opciones del menú
 * principal): icono | divisor | nombre y datos | elemento final (flecha o porcentaje)
 */

export const ARROW_ICON =
  '<svg class="menu-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="m14 6 6 6-6 6"/></svg>';

export const EARTH_ICON =
  '<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5S9.6 5.8 12 3.5Z"/></svg>';

/** Terreno (los del panel de misiones y los propios del usuario) */
export const PIN_ICON =
  '<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/></svg>';

export const RETRY_ICON =
  '<svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.2h-4.2"/></svg>';

export function missionCardContent({ icon, title, meta, trailing }) {
  return `
        <span class="menu-icon-box">${icon}</span>
        <span class="menu-divider"></span>
        <span class="menu-label">
          <span>${title}</span>
          <span class="mission-meta">${meta}</span>
        </span>
        ${trailing}`;
}
