import * as THREE from 'three';

/**
 * Punto fijo sobre una órbita circular inclinada alrededor de la Tierra.
 * Devuelve el grupo raíz (para añadir a la escena) y el pivote donde se cuelga el cuerpo
 * a `distance` unidades sobre su eje X local.
 */
export function createOrbitalAnchor({ inclination, angle }) {
  const root = new THREE.Group();
  root.rotation.z = inclination;

  const pivot = new THREE.Group();
  pivot.rotation.y = angle;
  root.add(pivot);

  return { root, pivot };
}
