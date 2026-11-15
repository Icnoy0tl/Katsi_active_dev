import * as THREE from 'three';
import { createEnvMaterialFactory, createInstancedStruts, createPartBuilder, V } from '../utils/spacecraft.js';
import { createAntennaTextures } from './textures.js';

const DISH_RADIUS = 5;
const FOCAL = 2.2; // distancia focal del paraboloide
const VERTEX = 0.6; // el vértice del reflector queda algo por delante del eje de elevación
const DISH_DEPTH = (DISH_RADIUS * DISH_RADIUS) / (4 * FOCAL);
const ELEVATION_AXIS_Y = 6.5;

/** Altura del paraboloide (en el eje del reflector) a una distancia `r` del centro */
const dishY = (r) => VERTEX + (r * r) / (4 * FOCAL);

/**
 * Construye una antena de espacio profundo en unidades locales (~metros; +Y = arriba, origen en
 * la base). Devuelve la raíz, la alidada (gira en azimut sobre Y) y el grupo de elevación (gira
 * sobre X; su +Y local es el eje del reflector).
 */
export function buildAntennaModel({ renderer, anisotropy }) {
  const textures = createAntennaTextures(anisotropy);
  const m = createMaterials(renderer, textures);

  const root = new THREE.Group();
  const { add } = createPartBuilder(root);

  // --- Base: pedestal y vía circular de azimut ---
  add(new THREE.CylinderGeometry(4.6, 4.8, 0.5, 64), m.concrete, 0, 0.25, 0);
  add(new THREE.TorusGeometry(4.2, 0.12, 8, 64), m.metal, 0, 0.55, 0).rotation.x = Math.PI / 2;

  // --- Alidada: torres de celosía, sala de equipos y plataforma (gira en azimut) ---
  const alidade = new THREE.Group();
  alidade.position.y = 0.6;
  root.add(alidade);
  const al = createPartBuilder(alidade);

  const top = ELEVATION_AXIS_Y - alidade.position.y;
  const spread = 3.0; // media separación de las patas en Z, a ras de la base
  const towers = [];
  const legZ = (y, sign) => sign * spread * (1 - y / top);
  for (const side of [1, -1]) {
    const xs = [side * 3.4, side * 2.4]; // cara exterior e interior de la torre
    for (const x of xs) {
      for (const s of [1, -1]) towers.push([V(x, 0, s * spread), V(x, top, 0)]);
      // Travesaños horizontales y diagonales en X de cada tramo
      const levels = [0, 1.8, 3.6, 5.0];
      levels.forEach((y, i) => {
        towers.push([V(x, y, legZ(y, 1)), V(x, y, legZ(y, -1))]);
        const next = levels[i + 1];
        if (next !== undefined) {
          towers.push([V(x, y, legZ(y, 1)), V(x, next, legZ(next, -1))]);
          towers.push([V(x, y, legZ(y, -1)), V(x, next, legZ(next, 1))]);
        }
      });
    }
    // Uniones entre las dos caras de la torre
    [0, 1.8, 3.6, 5.0].forEach((y) => {
      for (const s of [1, -1]) towers.push([V(xs[0], y, legZ(y, s)), V(xs[1], y, legZ(y, s))]);
    });
    for (const s of [1, -1]) towers.push([V(xs[0], 0, s * spread), V(xs[1], 1.8, legZ(1.8, s))]);
  }
  // Bastidor inferior entre torres y barandillas de la plataforma
  for (const s of [1, -1]) {
    towers.push([V(-3.4, 0, s * spread), V(3.4, 0, s * spread)]);
    towers.push([V(-3.4, 0, 0), V(3.4, 0, 0)]);
    towers.push([V(-2.4, 2.75, s * 1.55), V(2.4, 2.75, s * 1.55)]);
  }
  for (let x = -2.4; x <= 2.41; x += 0.8) {
    for (const s of [1, -1]) towers.push([V(x, 1.9, s * 1.55), V(x, 2.75, s * 1.55)]);
  }
  alidade.add(createInstancedStruts(towers, 0.07, m.structure));

  al.add(new THREE.CylinderGeometry(1.3, 1.4, 3.2, 40), m.structure, 0, 1.6, 0); // sala de equipos
  al.add(new THREE.CylinderGeometry(1.45, 1.45, 0.12, 40), m.metal, 0, 3.25, 0);
  al.add(new THREE.BoxGeometry(5.0, 0.12, 3.1), m.grating, 0, 1.85, 0); // plataforma
  al.add(new THREE.BoxGeometry(1.6, 1.0, 1.0), m.structure, 3.9, 1.0, 0); // caseta lateral

  // Cojinetes y eje de elevación
  for (const side of [1, -1]) al.add(new THREE.BoxGeometry(1.3, 0.9, 0.9), m.structure, side * 2.9, top, 0);
  const axle = al.add(new THREE.CylinderGeometry(0.3, 0.3, 6.6, 24), m.metal, 0, top, 0);
  axle.rotation.z = Math.PI / 2;

  // --- Reflector (grupo de elevación; su +Y local es el eje del reflector) ---
  const elevation = new THREE.Group();
  elevation.position.y = top;
  alidade.add(elevation);
  const el = createPartBuilder(elevation);

  // Superficie parabólica con un hueco central para el cono de espejos
  const profile = [];
  for (let i = 0; i <= 40; i++) {
    const r = 0.95 + ((DISH_RADIUS - 0.95) * i) / 40;
    profile.push(new THREE.Vector2(r, dishY(r)));
  }
  el.add(new THREE.LatheGeometry(profile, 96), m.dish);
  el.add(new THREE.TorusGeometry(DISH_RADIUS, 0.07, 8, 96), m.structure, 0, VERTEX + DISH_DEPTH, 0).rotation.x = Math.PI / 2;

  // Estructura de respaldo: núcleo cónico, costillas radiales, aros y diagonales
  el.add(new THREE.CylinderGeometry(1.5, 0.8, 1.0, 32), m.structure, 0, 0.2, 0);
  const backing = [];
  const ribs = 24;
  const ringRadii = [2.4, 3.8];
  const ribPoint = (a, r, drop) => V(Math.cos(a) * r, dishY(r) - drop, Math.sin(a) * r);
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2;
    const b = ((i + 1) / ribs) * Math.PI * 2;
    backing.push([ribPoint(a, 1.3, 0.55), ribPoint(a, DISH_RADIUS, 0.08)]);
    ringRadii.forEach((r) => backing.push([ribPoint(a, r, 0.3), ribPoint(b, r, 0.3)]));
    backing.push([ribPoint(a, 1.3, 0.55), ribPoint(b, ringRadii[0], 0.3)]);
    backing.push([ribPoint(a, ringRadii[0], 0.3), ribPoint(b, ringRadii[1], 0.3)]);
  }

  // Cuadrípode: cuatro patas de celosía desde el reflector hasta el receptor
  const apexY = VERTEX + 4.9;
  const apex = V(0, apexY - 0.25, 0);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    backing.push(...trussSegments(ribPoint(a, 4.1, -0.05), apex, 0.16, 7));
  }
  elevation.add(createInstancedStruts(backing, 0.045, m.structure));

  // Cono central de espejos hexagonales
  el.add(new THREE.CylinderGeometry(0.55, 1.0, 1.1, 32), [m.hex, m.dark, m.dark], 0, VERTEX + 0.55, 0);
  el.add(new THREE.TorusGeometry(0.98, 0.05, 8, 40), m.metal, 0, VERTEX + 0.02, 0).rotation.x = Math.PI / 2;

  // Receptor: subreflector, carcasa dorada y antenas auxiliares
  el.add(new THREE.CylinderGeometry(0.95, 0.75, 0.16, 40), m.metal, 0, apexY - 0.35, 0);
  el.add(new THREE.CylinderGeometry(0.55, 0.6, 0.9, 24), [m.gold, m.metal, m.metal], 0, apexY + 0.2, 0);
  el.add(new THREE.BoxGeometry(1.0, 0.25, 1.0), m.dark, 0, apexY + 0.72, 0);
  const spikes = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    spikes.push([V(Math.cos(a) * 0.35, apexY + 0.8, Math.sin(a) * 0.35), V(Math.cos(a) * 0.5, apexY + 1.7, Math.sin(a) * 0.5)]);
  }
  elevation.add(createInstancedStruts(spikes, 0.025, m.metal));

  return { root, alidade, elevation };
}

/**
 * Barras de una viga de celosía triangular entre `a` y `b`: tres largueros a `width` del eje,
 * anillos y diagonales en zigzag en cada uno de los `bays` tramos
 */
function trussSegments(a, b, width, bays) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const helper = Math.abs(dir.clone().normalize().y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(dir, helper).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  const offsets = [0, 1, 2].map((k) => {
    const t = (k / 3) * Math.PI * 2;
    return u.clone().multiplyScalar(Math.cos(t) * width).addScaledVector(v, Math.sin(t) * width);
  });
  const at = (i, k) => a.clone().addScaledVector(dir, i / bays).add(offsets[k % 3]);
  const segments = [];
  for (let k = 0; k < 3; k++) segments.push([at(0, k), at(bays, k)]);
  for (let i = 0; i < bays; i++) {
    for (let k = 0; k < 3; k++) {
      segments.push([at(i, k), at(i, k + 1)]);
      segments.push([at(i, k), at(i + 1, k + 1)]);
    }
  }
  return segments;
}

/** Materiales de la antena (comparten el mapa de entorno de las naves) */
function createMaterials(renderer, textures) {
  const standard = createEnvMaterialFactory(renderer);
  return {
    dish: standard({ map: textures.dishMap, metalness: 0.35, roughness: 0.45, envMapIntensity: 0.6, side: THREE.DoubleSide }),
    hex: standard({ map: textures.hexMap, metalness: 0.9, roughness: 0.15, envMapIntensity: 1.3 }),
    structure: standard({ color: 0xe6e1d9, metalness: 0.35, roughness: 0.5, envMapIntensity: 0.6 }),
    metal: standard({ color: 0xb4b9c0, metalness: 0.85, roughness: 0.35, envMapIntensity: 0.8 }),
    dark: standard({ color: 0x3a3e45, metalness: 0.7, roughness: 0.45, envMapIntensity: 0.6 }),
    grating: standard({ color: 0x8a8f96, metalness: 0.8, roughness: 0.5, envMapIntensity: 0.6 }),
    concrete: standard({ color: 0xc9bfb3, metalness: 0.05, roughness: 0.85, envMapIntensity: 0.3 }),
    gold: standard({ color: 0xd9a426, metalness: 0.9, roughness: 0.3, envMapIntensity: 1.0 })
  };
}
