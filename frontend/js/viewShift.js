import { MENU } from './config.js';
import { approach } from './utils/smoothing.js';

const EPSILON = 1e-4;

/**
 * Desplazamiento de la vista en pantalla (fracciones del ancho/alto): x > 0 mueve la escena a la
 * derecha, y > 0 hacia arriba. Deja sitio al menú, a la lista de misiones y a los hologramas sin
 * mover la cámara. Las transiciones son suaves (`MENU.shiftSpeed`).
 */
export function createViewShift(camera) {
  const shift = { x: 0, y: 0, targetX: 0, targetY: 0 };

  function apply() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (Math.abs(shift.x) < EPSILON && Math.abs(shift.y) < EPSILON) {
      camera.clearViewOffset();
    } else {
      camera.setViewOffset(width, height, -shift.x * width, shift.y * height, width, height);
    }
  }

  return {
    /** Aplica el desplazamiento actual (también actualiza la proyección de la cámara) */
    apply,
    setTarget(x, y) {
      shift.targetX = x;
      shift.targetY = y;
    },
    setTargetX(x) {
      shift.targetX = x;
    },
    /** Salta al destino sin transición */
    snap() {
      shift.x = shift.targetX;
      shift.y = shift.targetY;
      apply();
    },
    update(delta) {
      if (shift.x === shift.targetX && shift.y === shift.targetY) return;
      shift.x = approach(shift.x, shift.targetX, MENU.shiftSpeed, delta, EPSILON);
      shift.y = approach(shift.y, shift.targetY, MENU.shiftSpeed, delta, EPSILON);
      apply();
    }
  };
}

/** Desplazamientos horizontales solo en pantallas anchas; en las estrechas, la vista centrada */
export const shiftIfWide = (value) => (window.innerWidth >= MENU.minWidthForShift ? value : 0);
