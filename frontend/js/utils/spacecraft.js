import * as THREE from 'three';
import { getEnvironmentMap } from './environment.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Atajo para puntos de los modelos */
export const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Ayudantes para montar los modelos de las naves pieza a pieza; `defaultParent` es el grupo
 * donde se cuelgan las piezas si no se indica otro.
 */
export function createPartBuilder(defaultParent) {
  /** Malla en una posición local */
  const add = (geometry, material, x = 0, y = 0, z = 0, parent = defaultParent) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  /** Barra cilíndrica entre dos puntos */
  const strut = (a, b, radius, material, parent = defaultParent) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 10), material);
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    parent.add(mesh);
    return mesh;
  };

  return { add, strut };
}

/**
 * Fábrica de materiales PBR que comparten el mapa de entorno (reflejos metálicos de las naves)
 */
export function createEnvMaterialFactory(renderer) {
  const envMap = getEnvironmentMap(renderer);
  return (params) => new THREE.MeshStandardMaterial({ envMap, ...params });
}

/**
 * Tobera tipo campana (abre hacia +Y local)
 */
export function createBellGeometry(scale) {
  const profile = [[0.06, 0], [0.075, 0.04], [0.1, 0.1], [0.15, 0.2], [0.21, 0.32]];
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r * scale, y * scale)), 32);
}

/**
 * Gira un ala solar sobre su eje X local para que la normal de las celdas (+Z) se acerque a la
 * luz (`localLight`, en coordenadas locales del ala), por el camino angular más corto.
 * `follow` (0–1) es la fracción del giro restante que se recorre en este fotograma.
 */
export function turnTowardsLight(array, localLight, follow) {
  const diff = Math.atan2(-localLight.y, localLight.z) - array.rotation.x;
  array.rotation.x += Math.atan2(Math.sin(diff), Math.cos(diff)) * follow;
}
