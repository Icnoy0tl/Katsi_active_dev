import * as THREE from 'three';
import { MENU } from './config.js';

const UP = new THREE.Vector3(0, 1, 0);
const offset = new THREE.Vector3();
const tangent = new THREE.Vector3();
const cameraRight = new THREE.Vector3();

/**
 * Recorrido automático de fondo mientras el menú está abierto: en cada parada la cámara
 * gira muy despacio alrededor del cuerpo, siempre hacia su derecha, y pasado un tiempo
 * vuela a la siguiente parada (Orión → Luna → Marte → Orión …).
 *
 * @param focus(name, distanceScale)  enfoca un cuerpo con vuelo (mantiene sincronizado el panel)
 * @returns { reset, update(delta) }
 */
export function createMenuTour({ camera, controls, cameraNavigator, focus }) {
  const { stops, driftSpeed } = MENU.tour;
  let stopIndex = 0;
  let stopTime = 0;
  let driftSign = 0; // 0 = por calcular al llegar a la parada

  /** Sentido de giro que mueve la cámara hacia su derecha en pantalla */
  function rightwardSign() {
    offset.subVectors(camera.position, controls.target);
    tangent.crossVectors(UP, offset);
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    return tangent.dot(cameraRight) >= 0 ? 1 : -1;
  }

  /** Giro constante sobre el eje vertical alrededor del objetivo */
  function applyDrift(delta) {
    if (driftSign === 0) driftSign = rightwardSign();
    const angle = driftSign * driftSpeed * delta;
    offset.subVectors(camera.position, controls.target).applyAxisAngle(UP, angle);
    camera.position.copy(controls.target).add(offset);
  }

  function startDrift() {
    driftSign = 0;
  }

  /** Vuelve a la primera parada (Orión) */
  function reset() {
    stopIndex = 0;
    stopTime = 0;
    startDrift();
    if (cameraNavigator.currentFocus !== stops[0].body) focus(stops[0].body);
  }

  function update(delta) {
    if (cameraNavigator.isFlying) return;
    applyDrift(delta);

    stopTime += delta;
    if (stopTime >= stops[stopIndex].hold) {
      stopIndex = (stopIndex + 1) % stops.length;
      stopTime = 0;
      startDrift();
      focus(stops[stopIndex].body, stops[stopIndex].distanceScale);
    }
  }

  return { reset, update };
}
