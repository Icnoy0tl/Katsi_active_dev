/**
 * Panel con scroll sin barra visible (clase `.scroll-fade` en el HTML): el difuminado inferior
 * indica que hay más contenido y desaparece al llegar al final o si todo cabe sin scroll.
 *
 * @returns update() — llamarla tras cambiar el contenido del panel
 */
export function setupScrollFade(panel) {
  const update = () => panel.classList.toggle('is-scroll-end', isScrolledToEnd(panel));
  panel.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  return update;
}

/** true si no queda contenido por debajo (margen de 4 px por redondeos) */
export function isScrolledToEnd(element) {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
}
