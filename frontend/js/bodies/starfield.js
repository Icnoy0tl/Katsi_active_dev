import * as THREE from 'three';

const STAR_COUNT = 4500;
const STAR_PALETTE = [0xffffff, 0xcbd5e1, 0xbae6fd, 0xfef3c7, 0xfed7aa].map((hex) => new THREE.Color(hex));

/**
 * Campo de estrellas en una corteza esférica lejana, con variación de brillo y tono estelar
 */
export function createStarfield() {
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);

  for (let i = 0; i < STAR_COUNT; i++) {
    const radius = 130 + Math.random() * 240;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = radius * Math.cos(phi);

    const baseColor = STAR_PALETTE[Math.floor(Math.random() * STAR_PALETTE.length)];
    const brightness = 0.45 + Math.random() * 0.55;
    colors[i * 3] = baseColor.r * brightness;
    colors[i * 3 + 1] = baseColor.g * brightness;
    colors[i * 3 + 2] = baseColor.b * brightness;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.72,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.92
    })
  );
}
