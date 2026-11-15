import * as THREE from 'three';
import { MARS } from '../config.js';
import { createMarsProceduralTextures } from '../textures/procedural.js';
import { createAtmosphere, MARS_ATMOSPHERE_SHADER } from './atmosphere.js';

/**
 * Marte en un punto fijo de su órbita exterior, con eje inclinado 25.19° y tenue atmósfera rojiza
 */
export function createMars({ anisotropy, lightDirectionUniform }) {
  const group = new THREE.Group();
  group.rotation.z = MARS.orbitInclination;
  group.rotation.x = MARS.orbitTiltX;

  // Ancla con la inclinación axial; es el punto que enfoca la cámara
  const anchor = new THREE.Group();
  anchor.rotation.z = MARS.axialTilt;
  anchor.position.set(Math.cos(MARS.angle) * MARS.distanceX, 0, Math.sin(MARS.angle) * MARS.distanceZ);
  group.add(anchor);

  const textures = createMarsProceduralTextures(anisotropy);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(MARS.radius, 128, 128),
    new THREE.MeshStandardMaterial({
      map: textures.colorMap,
      bumpMap: textures.bumpMap,
      bumpScale: 0.032,
      roughness: 0.88,
      metalness: 0.03
    })
  );

  const atmosphere = createAtmosphere({
    radius: MARS.atmosphereRadius,
    segments: 64,
    fragmentShader: MARS_ATMOSPHERE_SHADER,
    colors: { glowColor: 0xf97316, dustColor: 0xfdba74 },
    lightDirectionUniform
  });

  anchor.add(mesh, atmosphere);
  return { group, anchor, mesh, atmosphere };
}
