import * as THREE from 'three';
import { MOON } from '../config.js';
import { createMoonProceduralTextures } from '../textures/procedural.js';
import { createOrbitalAnchor } from './placement.js';

/**
 * Luna en un punto fijo de su órbita (inclinada 5.14°) con eje inclinado 6.68°
 */
export function createMoon({ anisotropy }) {
  const { root, pivot } = createOrbitalAnchor({ inclination: MOON.orbitInclination, angle: MOON.angle });

  const textures = createMoonProceduralTextures(anisotropy);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(MOON.radius, 128, 128),
    new THREE.MeshStandardMaterial({
      map: textures.colorMap,
      bumpMap: textures.bumpMap,
      bumpScale: 0.025,
      roughness: 0.92,
      metalness: 0.02
    })
  );
  mesh.position.set(MOON.distance, 0, 0);
  // Orden ZYX: primero gira sobre su eje (Y) y luego se aplica la inclinación (Z),
  // así el eje queda fijo e inclinado en lugar de bambolearse
  mesh.rotation.order = 'ZYX';
  mesh.rotation.z = MOON.axialTilt;
  pivot.add(mesh);

  return { group: root, mesh };
}
