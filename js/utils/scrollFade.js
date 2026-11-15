/**
 * Panel con scroll sin barra visible (clase `.scroll-fade` en el HTML): el difuminado inferior
 * indica que hay más contenido y desaparece al llegar al final o si todo cabe sin scroll.
 *
 * @returns update() — llamarla tras cambiar el contenido del panel
 */
export function setupScrollFade(panel) {
  const update = () => {
    const atEnd = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4;
    panel.classList.toggle('is-scroll-end', atEnd);
  };
  panel.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  return update;
}
