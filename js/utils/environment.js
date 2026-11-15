import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const cache = new WeakMap();

/**
 * Mapa de entorno para reflejos metálicos de las naves. Se genera una sola vez por renderizador
 * y se comparte entre todos los modelos (generar un PMREM es costoso).
 */
export function getEnvironmentMap(renderer) {
  if (!cache.has(renderer)) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    cache.set(renderer, pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
    pmrem.dispose();
  }
  return cache.get(renderer);
}
