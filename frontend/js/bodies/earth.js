import * as THREE from 'three';
import { EARTH } from '../config.js';
import { createEarthProceduralTextures } from '../textures/procedural.js';
import { createAtmosphere, EARTH_ATMOSPHERE_SHADER } from './atmosphere.js';

/**
 * Tierra con inclinación axial de 23.44°: superficie, capa de nubes y halo atmosférico
 */
export function createEarth({ anisotropy, lightDirectionUniform }) {
  const group = new THREE.Group();
  group.rotation.z = EARTH.axialTilt;

  const textures = createEarthProceduralTextures(anisotropy);

  // Superficie con reflejo especular oceánico y relieve continental
  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH.radius, 160, 160),
    new THREE.MeshPhongMaterial({
      map: textures.colorMap,
      specularMap: textures.specularMap,
      specular: new THREE.Color(0x60a5fa),
      shininess: 28,
      bumpMap: textures.bumpMap,
      bumpScale: 0.025
    })
  );

  // Capa independiente de nubes semitransparentes
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH.cloudsRadius, 160, 160),
    new THREE.MeshStandardMaterial({
      map: textures.cloudsMap,
      alphaMap: textures.cloudsMap,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      roughness: 0.9
    })
  );

  const atmosphere = createAtmosphere({
    radius: EARTH.atmosphereRadius,
    segments: 72,
    fragmentShader: EARTH_ATMOSPHERE_SHADER,
    colors: { dayColor: 0x38bdf8, twilightColor: 0x1d4ed8 },
    lightDirectionUniform
  });

  group.add(surface, clouds, atmosphere);
  return { group, surface, clouds, atmosphere };
}
