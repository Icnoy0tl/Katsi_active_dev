const $ = (id) => document.getElementById(id);

/**
 * Menú principal superpuesto a la escena (Orión de fondo, desplazada a la derecha).
 * Cada opción del HTML lleva `data-action`; se resuelve con el mapa `actions`.
 *
 * @param actions  { [accion]: () => void } — acción de cada opción del menú
 * @param onToggle(isOpen)  se llama al abrir/cerrar el menú
 * @returns { open, close, isOpen }
 */
export function setupMainMenu({ actions, onToggle }) {
  const menu = $('main-menu');
  const sceneUi = document.querySelectorAll('[data-scene-ui]');
  let isOpen = false;

  const setOpen = (open) => {
    isOpen = open;
    menu.classList.toggle('is-hidden', !open);
    menu.setAttribute('aria-hidden', String(!open));
    sceneUi.forEach((el) => el.classList.toggle('is-hidden', open));
    onToggle(open);
  };

  menu.querySelectorAll('[data-action]').forEach((option) => {
    option.addEventListener('click', () => actions[option.dataset.action]?.());
  });

  $('open-menu-btn').addEventListener('click', () => setOpen(true));
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !isOpen) setOpen(true);
  });

  setOpen(true);

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    get isOpen() {
      return isOpen;
    }
  };
}
