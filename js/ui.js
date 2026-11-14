import { state } from './state.js';

const $ = (id) => document.getElementById(id);

// Estilos del botón de destino activo (Marte usa acento naranja)
const ACTIVE_FOCUS_CLASSES = {
  default: ['bg-sky-500/25', 'text-sky-200', 'border-sky-400/40'],
  mars: ['bg-orange-500/25', 'text-orange-200', 'border-orange-400/40']
};
const INACTIVE_FOCUS_CLASSES = ['text-slate-400', 'border-transparent'];

// Estilos de los interruptores (botón + punto de estado)
const TOGGLE_ON = ['border-sky-400/40', 'bg-sky-500/20', 'text-white'];
const TOGGLE_OFF = ['border-white/10', 'bg-white/5', 'text-slate-400'];
const DOT_ON = ['bg-sky-400', 'shadow-[0_0_8px_#38bdf8]'];
const DOT_OFF = ['bg-slate-600'];

/**
 * Conecta el panel de control con la escena.
 *
 * @param cameraNavigator  navegador de cámara (focus, currentFocus)
 * @param onToggleClouds(visible)     muestra u oculta las nubes
 * @param onToggleAtmosphere(visible) muestra u oculta las atmósferas
 */
export function setupControlPanel({ cameraNavigator, onToggleClouds, onToggleAtmosphere }) {
  setupPanelVisibility();
  setupFocusButtons(cameraNavigator);
  setupRotationControls();
  bindToggle('toggle-clouds-btn', 'clouds-status', onToggleClouds);
  bindToggle('toggle-atmosphere-btn', 'atmosphere-status', onToggleAtmosphere);
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
function setupFocusButtons(cameraNavigator) {
  const buttons = {
    earth: $('focus-earth-btn'),
    moon: $('focus-moon-btn'),
    mars: $('focus-mars-btn'),
    satellite: $('focus-satellite-btn')
  };
  const allActiveClasses = [...ACTIVE_FOCUS_CLASSES.default, ...ACTIVE_FOCUS_CLASSES.mars];

  const select = (name) => {
    Object.entries(buttons).forEach(([key, button]) => {
      button.classList.remove(...allActiveClasses, ...INACTIVE_FOCUS_CLASSES);
      if (key === name) {
        button.classList.add(...(ACTIVE_FOCUS_CLASSES[key] || ACTIVE_FOCUS_CLASSES.default));
      } else {
        button.classList.add(...INACTIVE_FOCUS_CLASSES);
      }
    });
    cameraNavigator.focus(name);
  };

  Object.entries(buttons).forEach(([name, button]) => button.addEventListener('click', () => select(name)));
  $('reset-camera-btn').addEventListener('click', () => select(cameraNavigator.currentFocus));
}

/** Pausar / reanudar la rotación y ajustar su velocidad */
function setupRotationControls() {
  const pauseIcon = $('pause-icon');
  const playIcon = $('play-icon');
  const label = $('rotation-btn-label');

  $('toggle-rotation-btn').addEventListener('click', () => {
    state.isRotating = !state.isRotating;
    pauseIcon.classList.toggle('hidden', !state.isRotating);
    playIcon.classList.toggle('hidden', state.isRotating);
    label.textContent = state.isRotating ? 'Pausar' : 'Reanudar';
  });

  const speedValue = $('speed-value');
  $('speed-slider').addEventListener('input', (event) => {
    state.rotationSpeed = parseFloat(event.target.value);
    speedValue.textContent = `${state.rotationSpeed.toFixed(1)}x`;
  });
}

/** Interruptor encendido/apagado (empieza encendido) */
function bindToggle(buttonId, dotId, onChange) {
  const button = $(buttonId);
  const dot = $(dotId);
  let isOn = true;

  button.addEventListener('click', () => {
    isOn = !isOn;
    button.classList.remove(...(isOn ? TOGGLE_OFF : TOGGLE_ON));
    button.classList.add(...(isOn ? TOGGLE_ON : TOGGLE_OFF));
    dot.classList.remove(...(isOn ? DOT_OFF : DOT_ON));
    dot.classList.add(...(isOn ? DOT_ON : DOT_OFF));
    onChange(isOn);
  });
}
