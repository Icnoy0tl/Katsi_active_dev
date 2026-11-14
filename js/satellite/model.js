import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createSatelliteTextures } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Construye el modelo detallado del satélite (unidades locales; -Y apunta a la Tierra).
 * Devuelve la raíz, las alas solares (giran sobre X para seguir la luz) y las luces de navegación.
 */
export function buildSatelliteModel({ renderer, anisotropy }) {
  const textures = createSatelliteTextures(anisotropy);
  const materials = createMaterials(renderer, textures);
  const root = new THREE.Group();

  const add = (geometry, material, x = 0, y = 0, z = 0, parent = root) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  // Barra cilíndrica entre dos puntos
  const strut = (a, b, radius, material, parent = root) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 10), material);
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    parent.add(mesh);
    return mesh;
  };

  // --- Cuerpo principal (bus) ---
  const W = 1.2;
  const H = 1.5;
  const D = 1.2;
  const m = materials;
  // Orden de caras: +X, -X, +Y, -Y, +Z, -Z
  add(new THREE.BoxGeometry(W, H, D), [m.mli, m.mli, m.mli, m.mli, m.radiator, m.radiator]);

  // Estructura de aristas de aluminio
  const e = 0.05;
  const edgeX = new THREE.BoxGeometry(W + e, e, e);
  const edgeY = new THREE.BoxGeometry(e, H + e, e);
  const edgeZ = new THREE.BoxGeometry(e, e, D + e);
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      add(edgeX, m.frame, 0, (a * H) / 2, (b * D) / 2);
      add(edgeY, m.frame, (a * W) / 2, 0, (b * D) / 2);
      add(edgeZ, m.frame, (a * W) / 2, (b * H) / 2, 0);
    }
  }

  // --- Cubierta superior (anti-Tierra) ---
  const top = H / 2;
  add(new THREE.CylinderGeometry(0.12, 0.14, 0.06, 32), m.dark, 0, top + 0.03, 0);
  add(createBellGeometry(1), m.engine, 0, top + 0.06, 0);

  // Rastreadores estelares con parasol y lente
  const trackerBody = new THREE.CylinderGeometry(0.07, 0.07, 0.16, 24);
  const trackerLens = new THREE.CylinderGeometry(0.06, 0.06, 0.012, 24);
  const trackerBaffle = new THREE.CylinderGeometry(0.115, 0.075, 0.14, 24, 1, true);
  [[0.36, 0.36], [-0.36, 0.36]].forEach(([x, z]) => {
    const tracker = new THREE.Group();
    tracker.position.set(x, top, z);
    tracker.rotation.set(0.35, 0, -Math.sign(x) * 0.35);
    root.add(tracker);
    add(trackerBody, m.dark, 0, 0.08, 0, tracker);
    add(trackerLens, m.lens, 0, 0.165, 0, tracker);
    add(trackerBaffle, m.white, 0, 0.23, 0, tracker);
  });

  // Antena omnidireccional y parche GPS
  strut(V(0.38, top, -0.38), V(0.38, top + 0.5, -0.38), 0.012, m.frame);
  add(new THREE.SphereGeometry(0.03, 16, 16), m.white, 0.38, top + 0.5, -0.38);
  add(new THREE.BoxGeometry(0.24, 0.02, 0.24), m.white, -0.36, top + 0.01, -0.36);
  add(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 24), m.white, -0.36, top + 0.04, -0.36);

  // Propulsores de control de actitud en las cuatro aristas verticales
  const thrusterGeometry = createBellGeometry(0.32);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const thruster = add(thrusterGeometry, m.engine, sx * 0.63, 0.55, sz * 0.63);
      thruster.quaternion.setFromUnitVectors(UP, V(sx, 0.25, sz).normalize());
    }
  }

  // --- Cubierta inferior (cara a la Tierra): antena parabólica de alta ganancia ---
  const bottom = -H / 2;
  const dishRadius = 0.75;
  const focal = 0.42;
  const depth = (dishRadius * dishRadius) / (4 * focal);
  const dishVertexY = bottom - 0.2;
  add(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 16), m.frame, 0, bottom - 0.1, 0);

  const profile = [];
  for (let i = 0; i <= 28; i++) {
    const r = (dishRadius * i) / 28;
    profile.push(new THREE.Vector2(Math.max(r, 0.001), (r * r) / (4 * focal)));
  }
  const dish = add(new THREE.LatheGeometry(profile, 64), m.white, 0, dishVertexY, 0);
  dish.rotation.x = Math.PI; // abre hacia la Tierra

  const rimY = dishVertexY - depth;
  const rim = add(new THREE.TorusGeometry(dishRadius, 0.016, 8, 72), m.frame, 0, rimY, 0);
  rim.rotation.x = Math.PI / 2;

  // Alimentador (bocina) en el foco sostenido por tres puntales
  const feedY = dishVertexY - focal;
  add(new THREE.CylinderGeometry(0.08, 0.035, 0.14, 24, 1, true), m.frame, 0, feedY + 0.02, 0);
  add(new THREE.BoxGeometry(0.09, 0.09, 0.09), m.dark, 0, feedY - 0.08, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    strut(V(Math.cos(a) * dishRadius * 0.96, rimY, Math.sin(a) * dishRadius * 0.96), V(0, feedY - 0.06, 0), 0.012, m.frame);
  }

  // Antenas de bocina piramidales
  const hornGeometry = new THREE.CylinderGeometry(0.03, 0.1, 0.18, 4, 1, true);
  [[0.44, -0.44], [-0.44, -0.44]].forEach(([x, z]) => {
    const horn = add(hornGeometry, m.frame, x, bottom - 0.09, z);
    horn.rotation.y = Math.PI / 4;
  });

  // --- Alas de paneles solares ---
  const panelW = 1.6;
  const panelH = 1.0;
  const panelGap = 0.06;
  const panelGeometry = new THREE.BoxGeometry(panelW, panelH, 0.035);
  const panelFaces = [m.frame, m.frame, m.frame, m.frame, m.solar, m.panelBack];
  const hingeGeometry = new THREE.CylinderGeometry(0.022, 0.022, 0.14, 10);
  const wings = [];

  for (const side of [1, -1]) {
    const wing = new THREE.Group();
    wing.position.set((side * W) / 2, 0.1, 0);
    root.add(wing);

    // Mecanismo de orientación (SADA) y botalón
    const drive = add(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 28), m.dark, side * 0.08, 0, 0, wing);
    drive.rotation.z = Math.PI / 2;
    strut(V(side * 0.16, 0, 0), V(side * 0.75, 0, 0), 0.03, m.frame, wing);
    strut(V(side * 0.75, 0, 0), V(side * 1.0, 0.45, 0), 0.02, m.frame, wing);
    strut(V(side * 0.75, 0, 0), V(side * 1.0, -0.45, 0), 0.02, m.frame, wing);

    for (let i = 0; i < 3; i++) {
      const cx = side * (1.0 + panelW / 2 + i * (panelW + panelGap));
      add(panelGeometry, panelFaces, cx, 0, 0, wing);
      if (i > 0) {
        const hx = side * (1.0 + i * (panelW + panelGap) - panelGap / 2);
        for (const hy of [-0.32, 0.32]) add(hingeGeometry, m.dark, hx, hy, 0, wing);
      }
    }

    wing.userData.tipX = side * (1.0 + 3 * panelW + 2 * panelGap + 0.05);
    wings.push(wing);
  }

  // --- Luces de navegación (verde a estribor, roja a babor, estroboscópica blanca) ---
  const navLights = [];
  const bulbGeometry = new THREE.SphereGeometry(0.035, 12, 12);
  const addNavLight = (color, parent, x, y, z, phase, period) => {
    const bulb = add(bulbGeometry, new THREE.MeshBasicMaterial({ color }), x, y, z, parent);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: textures.glowMap,
        color,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
      })
    );
    glow.scale.setScalar(0.55);
    bulb.add(glow);
    navLights.push({ glow, phase, period });
  };
  const [starboardWing, portWing] = wings;
  addNavLight(0x34d399, starboardWing, starboardWing.userData.tipX, 0.5, 0, 0, 1.6);
  addNavLight(0xf87171, portWing, portWing.userData.tipX, 0.5, 0, 0.8, 1.6);
  addNavLight(0xffffff, root, 0.38, top + 0.56, -0.38, 0.3, 1.1);

  return { root, wings, navLights };
}

/**
 * Materiales del satélite. Todos comparten un mapa de entorno para reflejos metálicos realistas
 * (solo afecta al satélite).
 */
function createMaterials(renderer, textures) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const standard = (params) => new THREE.MeshStandardMaterial({ envMap, ...params });

  return {
    mli: standard({ map: textures.mliMap, bumpMap: textures.mliBump, bumpScale: 1.5, metalness: 1, roughness: 0.32, envMapIntensity: 0.9 }),
    radiator: standard({ map: textures.radiatorMap, metalness: 0.85, roughness: 0.16, envMapIntensity: 1.0 }),
    frame: standard({ color: 0x9aa1ab, metalness: 0.85, roughness: 0.38, envMapIntensity: 0.7 }),
    dark: standard({ color: 0x2b2f36, metalness: 0.8, roughness: 0.42, envMapIntensity: 0.6 }),
    white: standard({ color: 0xf1f3f5, metalness: 0.05, roughness: 0.55, envMapIntensity: 0.5, side: THREE.DoubleSide }),
    solar: standard({ map: textures.solarMap, metalness: 0.55, roughness: 0.22, envMapIntensity: 1.1 }),
    panelBack: standard({ map: textures.panelBackMap, metalness: 0.2, roughness: 0.7, envMapIntensity: 0.4 }),
    lens: standard({ color: 0x05070c, metalness: 0.3, roughness: 0.05, envMapIntensity: 1.4 }),
    engine: standard({ color: 0x4a4038, metalness: 0.9, roughness: 0.3, envMapIntensity: 0.8, side: THREE.DoubleSide })
  };
}

/**
 * Tobera tipo campana (abre hacia +Y local)
 */
function createBellGeometry(scale) {
  const profile = [[0.06, 0], [0.075, 0.04], [0.1, 0.1], [0.15, 0.2], [0.21, 0.32]];
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r * scale, y * scale)), 32);
}
