/*
 * Contenido de las tarjetas de misión y de análogo (mismo diseño que las opciones del menú
 * principal): icono | divisor | nombre y datos | elemento final (flecha o porcentaje)
 */

export const ARROW_ICON =
  '<svg class="menu-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="m14 6 6 6-6 6"/></svg>';

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
