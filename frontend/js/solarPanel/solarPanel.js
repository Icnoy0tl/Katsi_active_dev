import * as THREE from 'three';
import { SOLAR_PANEL } from '../config.js';
import { createOrbitalAnchor } from '../bodies/placement.js';
import { buildSolarPanelModel } from './model.js';
import { turnTowardsLight } from '../utils/spacecraft.js';

const SOLAR_TRACKING_RATE = 1.5; // rapidez con que el ala sigue la luz (1/s)

/**
 * Panel solar suelto en órbita baja terrestre, al lado del rover: el ala gira sobre el eje del
 * mástil para encarar la luz
 */
export function createSolarPanel({ renderer, anisotropy }) {
  const { root, pivot } = createOrbitalAnchor({ inclination: SOLAR_PANEL.orbitInclination, angle: SOLAR_PANEL.angle });

  const { root: model, array } = buildSolarPanelModel({ renderer, anisotropy });
  model.position.set(SOLAR_PANEL.distance, 0, 0);
  model.rotation.set(0.25, 0.9, -0.15); // mástil cruzado respecto a la línea de visión
  model.scale.setScalar(SOLAR_PANEL.scale);
  pivot.add(model);

  const local = new THREE.Vector3();
  /** Lleva el modelo a un punto del mundo (sin cambiar su órbita de referencia) */
  function placeAt(point) {
    root.updateMatrixWorld(true);
    model.position.copy(pivot.worldToLocal(local.copy(point)));
  }

  const parentQuaternionInverse = new THREE.Quaternion();
  const localLight = new THREE.Vector3();

  function update(delta, lightDirection) {
    array.parent.getWorldQuaternion(parentQuaternionInverse).invert();
    localLight.copy(lightDirection).applyQuaternion(parentQuaternionInverse);
    turnTowardsLight(array, localLight, 1 - Math.exp(-SOLAR_TRACKING_RATE * delta));
  }

  return { group: root, model, placeAt, update };
}
