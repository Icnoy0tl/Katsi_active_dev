import * as THREE from 'three';
import { HEADLIGHT } from './config.js';

/**
 * Iluminación: ambiente tenue + luz principal que acompaña a la cámara, de modo que la cara
 * visible de cada cuerpo siempre queda iluminada. Sin sombras: con la luz junto al observador
 * quedarían ocultas detrás de los cuerpos.
 */
export function createLighting(scene) {
  scene.add(new THREE.AmbientLight(0x1e293b, 0.36));
  scene.add(new THREE.HemisphereLight(0x38bdf8, 0x05070c, 0.18));

  const headlight = new THREE.DirectionalLight(0xfffbeb, 2.95);
  scene.add(headlight, headlight.target);

  // Dirección hacia la luz (mundo); se comparte como uniform con los shaders atmosféricos
  const direction = new THREE.Vector3();
  const directionUniform = { value: direction };

  /** Coloca la luz junto a la cámara, apuntando al objetivo de la vista */
  function update(camera, target) {
    direction.copy(HEADLIGHT.offset).applyQuaternion(camera.quaternion);
    headlight.target.position.copy(target);
    headlight.position.copy(target).addScaledVector(direction, HEADLIGHT.distance);
  }

  return { direction, directionUniform, update };
}
