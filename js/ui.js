import { state } from './state.js';

const $ = (id) => document.getElementById(id);

// Estado resaltado de los botones .hud-btn (el acento de Marte lo define .hud-btn--mars)
const ACTIVE_CLASS = 'is-active';

/**
 * Conecta el panel de control con la escena.
 *
 * @param cameraNavigator  navegador de cámara (focus, currentFocus)
 * @param onToggleClouds(visible)     muestra u oculta las nubes
 * @param onToggleAtmosphere(visible) muestra u oculta las atmósferas
 * @param onFocus(name)               se llama cada vez que se enfoca un cuerpo
 * @returns { focus(name), setRotating(on) } — enfoca un cuerpo manteniendo sincronizados los
 *          botones "Ir a"; pausa o reanuda la rotación manteniendo sincronizado su botón
 */
export function setupControlPanel({ cameraNavigator, onToggleClouds, onToggleAtmosphere, onFocus }) {
  setupPanelVisibility();
  const focus = setupFocusButtons(cameraNavigator, onFocus);
  const setRotating = setupRotationControls();
  bindToggle('toggle-clouds-btn', onToggleClouds);
  bindToggle('toggle-atmosphere-btn', onToggleAtmosphere);
  return { focus, setRotating };
}

/** Mostrar / ocultar el panel */
function setupPanelVisibility() {
  const panel = $('control-panel');
  let isOpen = true;
  $('toggle-panel-btn').addEventListener('click', () => {
    isOpen = !isOpen;
    panel.classList.toggle('opacity-0', !isOpen);
    panel.classList.toggle('pointer-events-none', !isOpen);
    panel.classList.toggle('translate-y-4', !isOpen);
  });
}

/** Botones "Ir a" y "Centrar vista" */
function setupFocusButtons(cameraNavigator, onFocus) {
  const buttons = {
    earth: $('focus-earth-btn'),
    moon: $('focus-moon-btn'),
    mars: $('focus-mars-btn'),
    satellite: $('focus-satellite-btn'),
    orion: $('focus-orion-btn')
  };

  const select = (name, distanceScale) => {
    Object.entries(buttons).forEach(([key, button]) => {
      button.classList.toggle(ACTIVE_CLASS, key === name);
    });
    cameraNavigator.focus(name, false, distanceScale);
    onFocus?.(name);
  };

  Object.entries(buttons).forEach(([name, button]) => button.addEventListener('click', () => select(name)));
  $('reset-camera-btn').addEventListener('click', () => select(cameraNavigator.currentFocus));
  return select;
}

/** Pausar / reanudar la rotación y ajustar su velocidad */
function setupRotationControls() {
  const pauseIcon = $('pause-icon');
  const playIcon = $('play-icon');
  const label = $('rotation-btn-label');

  const setRotating = (on) => {
    state.isRotating = on;
    pauseIcon.classList.toggle('hidden', !on);
    playIcon.classList.toggle('hidden', on);
    label.textContent = on ? 'Pausar' : 'Reanudar';
  };
  $('toggle-rotation-btn').addEventListener('click', () => setRotating(!state.isRotating));

  const speedValue = $('speed-value');
  $('speed-slider').addEventListener('input', (event) => {
    state.rotationSpeed = parseFloat(event.target.value);
    speedValue.textContent = `${state.rotationSpeed.toFixed(1)}x`;
  });
  return setRotating;
}

/** Interruptor encendido/apagado (empieza encendido) */
function bindToggle(buttonId, onChange) {
  const button = $(buttonId);
  let isOn = true;

  button.addEventListener('click', () => {
    isOn = !isOn;
    button.classList.toggle(ACTIVE_CLASS, isOn);
    button.setAttribute('aria-pressed', String(isOn));
    onChange(isOn);
  });
}
