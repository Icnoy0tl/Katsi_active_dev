import * as THREE from 'three';
import { ROVER } from '../config.js';
import { createOrbitalAnchor } from '../bodies/placement.js';
import { buildRoverModel } from './model.js';

/**
 * Rover flotando a la deriva en órbita baja terrestre, junto al panel solar: gira despacio sobre
 * sí mismo y el cabezal del mástil barre a los lados.
 */
export function createRover({ renderer, anisotropy }) {
  const { root, pivot } = createOrbitalAnchor({ inclination: ROVER.orbitInclination, angle: ROVER.angle });

  const { root: hull, mastHead } = buildRoverModel({ renderer, anisotropy });
  // El origen del modelo está en el suelo: se baja para que gire alrededor de su centro
  hull.position.y = -0.75;
  const model = new THREE.Group();
  model.add(hull);
  model.position.set(ROVER.distance, 0, 0);
  model.rotation.set(0.35, -0.6, 0.2); // pose inicial de tres cuartos
  model.scale.setScalar(ROVER.scale);
  pivot.add(model);

  let elapsed = 0;

  const local = new THREE.Vector3();
  /** Lleva el modelo a un punto del mundo (sin cambiar su órbita de referencia) */
  function placeAt(point) {
    root.updateMatrixWorld(true);
    model.position.copy(pivot.worldToLocal(local.copy(point)));
  }

  function update(delta) {
    elapsed += delta;
    model.rotation.x += ROVER.spin.x * delta;
    model.rotation.y += ROVER.spin.y * delta;
    mastHead.rotation.y = Math.sin(elapsed * ROVER.mastPanSpeed) * ROVER.mastPanAngle;
  }

  return { group: root, model, placeAt, update };
}
