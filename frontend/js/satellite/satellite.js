import * as THREE from 'three';
import { SATELLITE } from '../config.js';
import { createOrbitalAnchor } from '../bodies/placement.js';
import { buildSatelliteModel } from './model.js';
import { turnTowardsLight } from '../utils/spacecraft.js';

const SOLAR_TRACKING_RATE = 3.0; // rapidez con que las alas siguen la luz (1/s)
const FLASH_DURATION = 0.12; // segundos encendida en cada destello

/**
 * Satélite en un punto fijo de una órbita baja inclinada (51.6°), apuntando al nadir
 */
export function createSatellite({ renderer, anisotropy }) {
  const { root, pivot } = createOrbitalAnchor({ inclination: SATELLITE.orbitInclination, angle: SATELLITE.angle });

  const { root: model, wings, navLights } = buildSatelliteModel({ renderer, anisotropy });
  model.position.set(SATELLITE.distance, 0, 0);
  model.rotation.z = -Math.PI / 2; // -Y local (antena) apunta hacia la Tierra
  model.scale.setScalar(SATELLITE.scale);
  pivot.add(model);

  const worldQuaternionInverse = new THREE.Quaternion();
  const localLight = new THREE.Vector3();

  /** Orienta los paneles solares hacia la luz y hace parpadear las luces de navegación */
  function update(delta, elapsed, lightDirection) {
    model.getWorldQuaternion(worldQuaternionInverse).invert();
    localLight.copy(lightDirection).applyQuaternion(worldQuaternionInverse);

    const follow = 1 - Math.exp(-SOLAR_TRACKING_RATE * delta);
    wings.forEach((wing) => turnTowardsLight(wing, localLight, follow));

    navLights.forEach(({ glow, phase, period }) => {
      glow.material.opacity = (elapsed + phase) % period < FLASH_DURATION ? 1.0 : 0.12;
    });
  }

  return { group: root, model, update };
}
