import * as THREE from 'three';
import { ORION } from '../config.js';
import { createOrbitalAnchor } from '../bodies/placement.js';
import { buildOrionModel } from './model.js';

const SOLAR_TRACKING_RATE = 2.0; // rapidez con que las alas siguen la luz (1/s)

/**
 * Cápsula tipo Orión en un punto fijo de una órbita baja terrestre, con la Tierra de fondo
 * al enfocarla.
 */
export function createOrion({ renderer, anisotropy }) {
  const { root, pivot } = createOrbitalAnchor({ inclination: ORION.orbitInclination, angle: ORION.angle });

  const { root: model, wings } = buildOrionModel({ renderer, anisotropy });
  model.position.set(ORION.distance, 0, 0);
  model.scale.setScalar(ORION.scale);
  pivot.add(model);

  /** Orienta la cara frontal ("NASA") hacia un punto del mundo y aplica la pose inclinada */
  function faceTowards(point) {
    root.updateMatrixWorld(true);
    model.lookAt(point);
    model.rotateX(ORION.pose.pitch);
    model.rotateZ(ORION.pose.roll);
  }

  const wingQuaternionInverse = new THREE.Quaternion();
  const localLight = new THREE.Vector3();

  /** Gira cada ala solar sobre su eje para encarar la luz */
  function update(delta, lightDirection) {
    const follow = 1 - Math.exp(-SOLAR_TRACKING_RATE * delta);
    wings.forEach(({ wing, array }) => {
      wing.getWorldQuaternion(wingQuaternionInverse).invert();
      localLight.copy(lightDirection).applyQuaternion(wingQuaternionInverse);
      const targetAngle = Math.atan2(-localLight.y, localLight.z);
      const diff = targetAngle - array.rotation.x;
      array.rotation.x += Math.atan2(Math.sin(diff), Math.cos(diff)) * follow;
    });
  }

  return { group: root, model, faceTowards, update };
}
