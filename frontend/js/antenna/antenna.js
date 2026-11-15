import * as THREE from 'three';
import { ANTENNA } from '../config.js';
import { createOrbitalAnchor } from '../bodies/placement.js';
import { buildAntennaModel } from './model.js';

/**
 * Antena de espacio profundo (objeto de la misión de percepción) flotando junto al rover y al
 * panel solar: barre el cielo muy despacio en azimut y elevación.
 */
export function createAntenna({ renderer, anisotropy }) {
  const { root, pivot } = createOrbitalAnchor({ inclination: ANTENNA.orbitInclination, angle: ANTENNA.angle });

  const { root: hull, alidade, elevation } = buildAntennaModel({ renderer, anisotropy });
  hull.position.y = -6; // el origen del modelo está en la base: se centra en el conjunto
  const model = new THREE.Group();
  model.add(hull);
  model.position.set(ANTENNA.distance, 0, 0);
  model.rotation.set(0.2, -0.5, 0.1); // pose inicial: reflector de tres cuartos
  model.scale.setScalar(ANTENNA.scale);
  pivot.add(model);

  const local = new THREE.Vector3();
  /** Lleva el modelo a un punto del mundo (sin cambiar su órbita de referencia) */
  function placeAt(point) {
    root.updateMatrixWorld(true);
    model.position.copy(pivot.worldToLocal(local.copy(point)));
  }

  let elapsed = 0;
  function update(delta) {
    elapsed += delta;
    alidade.rotation.y = Math.sin(elapsed * ANTENNA.scanSpeed) * ANTENNA.azimuthSweep;
    elevation.rotation.x = Math.PI / 2 - ANTENNA.elevation + Math.sin(elapsed * ANTENNA.scanSpeed * 1.3) * ANTENNA.elevationSweep;
  }
  update(0);

  return { group: root, model, placeAt, update };
}
