import * as THREE from 'three';
import { createEnvMaterialFactory, createInstancedStruts, createPartBuilder, V } from '../utils/spacecraft.js';
import { createSolarPanelTextures } from './textures.js';

/**
 * Construye un panel solar suelto en unidades locales (~metros; origen ≈ centro del conjunto):
 * unidad de potencia con articulación de giro y, a lo largo de +X, un mástil de celosía con dos
 * mantas de celdas plegables a sus lados (±Y). Las celdas miran a +Z del grupo `array`, que gira
 * sobre su eje X para seguir la luz.
 */
export function buildSolarPanelModel({ renderer, anisotropy }) {
  const textures = createSolarPanelTextures(anisotropy);
  const m = createMaterials(renderer, textures);

  const root = new THREE.Group();
  const assembly = new THREE.Group();
  assembly.position.x = -5.6; // centra el conjunto (unidad de potencia + mástil de ~11 m)
  root.add(assembly);
  const { add, strut } = createPartBuilder(assembly);

  // --- Unidad de potencia (baterías y electrónica) con radiador ---
  add(new THREE.BoxGeometry(1.3, 1.1, 1.1), m.hub, 0, 0, 0);
  add(new THREE.BoxGeometry(0.04, 1.4, 1.5), m.radiator, -0.7, 0, 0);
  for (const y of [-0.45, 0, 0.45]) add(new THREE.BoxGeometry(0.06, 0.05, 1.5), m.metal, -0.72, y, 0);
  // Antena y puerto de acoplamiento
  strut(V(0.2, 0.55, 0.3), V(0.2, 1.2, 0.3), 0.025, m.metal);
  add(new THREE.SphereGeometry(0.05, 12, 10), m.white, 0.2, 1.22, 0.3);
  add(new THREE.CylinderGeometry(0.28, 0.32, 0.18, 32), m.metal, 0, -0.64, 0);
  add(new THREE.TorusGeometry(0.3, 0.035, 8, 32), m.dark, 0, -0.73, 0).rotation.x = Math.PI / 2;

  // Articulación de giro (gimbal) entre la unidad y el mástil
  const gimbal = add(new THREE.CylinderGeometry(0.42, 0.42, 0.35, 36), m.dark, 0.83, 0, 0);
  gimbal.rotation.z = Math.PI / 2;
  const gimbalRing = add(new THREE.TorusGeometry(0.43, 0.03, 8, 36), m.metal, 0.83, 0, 0);
  gimbalRing.rotation.y = Math.PI / 2;

  // --- Ala: gira sobre X ---
  const array = new THREE.Group();
  array.position.x = 1.0;
  assembly.add(array);

  // Mástil de celosía triangular (una sola malla instanciada: pocas llamadas de dibujo)
  const mastLength = 10;
  const bays = 8;
  const trussRadius = 0.2;
  const corner = (x, k) => {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
    return V(x, Math.cos(a) * trussRadius, Math.sin(a) * trussRadius);
  };
  const segments = [];
  for (let k = 0; k < 3; k++) segments.push([corner(0.15, k), corner(mastLength, k)]);
  for (let i = 0; i <= bays; i++) {
    const x = 0.15 + ((mastLength - 0.15) * i) / bays;
    for (let k = 0; k < 3; k++) {
      segments.push([corner(x, k), corner(x, (k + 1) % 3)]);
      if (i < bays) segments.push([corner(x, k), corner(x + (mastLength - 0.15) / bays, (k + 1) % 3)]);
    }
  }
  array.add(createInstancedStruts(segments, 0.025, m.metal));

  // Cajas de contención de las mantas en ambos extremos del mástil
  const blanketWidth = 4.2;
  const blanketInset = 0.35; // separación entre el mástil y la manta
  const span = 2 * (blanketWidth + blanketInset);
  const boxStart = 0.35;
  const boxEnd = mastLength - 0.15;
  for (const x of [boxStart, boxEnd]) add(new THREE.BoxGeometry(0.3, span + 0.2, 0.32), m.box, x, 0, 0, array);

  // Mantas: segmentos plegables con celdas por delante (+Z) y kapton detrás
  const panels = 6;
  const foldGap = 0.05;
  const panelLength = (boxEnd - boxStart - 0.3 - foldGap * (panels - 1)) / panels;
  const panelGeometry = new THREE.BoxGeometry(panelLength, blanketWidth, 0.02);
  const panelFaces = [m.frame, m.frame, m.frame, m.frame, m.cells, m.back];
  for (const side of [1, -1]) {
    const y = side * (blanketInset + blanketWidth / 2);
    for (let i = 0; i < panels; i++) {
      const x = boxStart + 0.15 + panelLength / 2 + i * (panelLength + foldGap);
      add(panelGeometry, panelFaces, x, y, 0, array);
    }
    // Cables tensores a lo largo del borde exterior y del interior
    for (const edge of [blanketInset, blanketInset + blanketWidth]) {
      strut(V(boxStart + 0.15, side * edge, 0), V(boxEnd - 0.15, side * edge, 0), 0.008, m.metal, array);
    }
  }

  return { root, array };
}

/** Materiales del panel (comparten el mapa de entorno de las naves) */
function createMaterials(renderer, textures) {
  const standard = createEnvMaterialFactory(renderer);
  return {
    cells: standard({ map: textures.cellsMap, metalness: 0.55, roughness: 0.22, envMapIntensity: 1.1 }),
    back: standard({ map: textures.backMap, metalness: 0.3, roughness: 0.6, envMapIntensity: 0.5 }),
    hub: standard({ map: textures.hubMap, metalness: 0.05, roughness: 0.7, envMapIntensity: 0.4 }),
    frame: standard({ color: 0x9aa1ab, metalness: 0.85, roughness: 0.38, envMapIntensity: 0.7 }),
    metal: standard({ color: 0xb4bac2, metalness: 0.85, roughness: 0.35, envMapIntensity: 0.8 }),
    box: standard({ color: 0x5b6068, metalness: 0.7, roughness: 0.45, envMapIntensity: 0.6 }),
    dark: standard({ color: 0x2b2f36, metalness: 0.8, roughness: 0.42, envMapIntensity: 0.6 }),
    white: standard({ color: 0xf1f3f5, metalness: 0.05, roughness: 0.55, envMapIntensity: 0.5 }),
    radiator: standard({ color: 0xdfe3e8, metalness: 0.6, roughness: 0.2, envMapIntensity: 1.0 })
  };
}
