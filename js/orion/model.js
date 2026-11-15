import * as THREE from 'three';
import { getEnvironmentMap } from '../utils/environment.js';
import { createBellGeometry } from '../satellite/model.js';
import { createOrionTextures } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Las geometrías de revolución empiezan en π para que el centro de cada textura (u = 0.5)
// quede en +Z local: la cara frontal con las letras, el emblema y las ventanas
const FRONT_START = Math.PI;
const SEGMENTS = 96;

/**
 * Construye una cápsula tipo Orión en unidades locales (~metros; +Y = vértice de la cápsula,
 * +Z = cara frontal). Devuelve la raíz y las alas solares (cada `array` gira sobre su eje X
 * local, que apunta hacia fuera desde el módulo de servicio, para seguir la luz).
 */
export function buildOrionModel({ renderer, anisotropy }) {
  const textures = createOrionTextures(anisotropy);
  const m = createMaterials(renderer, textures);

  const root = new THREE.Group();
  // Casco desplazado para que el origen quede cerca del centro visual de la nave
  const hull = new THREE.Group();
  hull.position.y = 1.2;
  root.add(hull);

  const add = (geometry, material, x = 0, y = 0, z = 0, parent = hull) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  const strut = (a, b, radius, material, parent = hull) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 10), material);
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    parent.add(mesh);
    return mesh;
  };

  // --- Módulo de tripulación: cono truncado con flancos ligeramente abombados (y: 0 → 3) ---
  const crewHeight = 3.0;
  const coneProfile = [];
  for (let i = 0; i <= 20; i++) {
    const s = i / 20;
    coneProfile.push(new THREE.Vector2(2.5 - 1.55 * s + 0.1 * Math.sin(Math.PI * s), s * crewHeight));
  }
  add(new THREE.LatheGeometry(coneProfile, SEGMENTS, FRONT_START), m.crew);

  // Túnel de acoplamiento y anillo superior
  add(new THREE.CylinderGeometry(0.72, 0.82, 0.38, 48), m.metal, 0, crewHeight + 0.19, 0);
  add(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 48), m.dark, 0, crewHeight + 0.4, 0);
  const dockRing = add(new THREE.TorusGeometry(0.68, 0.045, 10, 48), m.metal, 0, crewHeight + 0.38, 0);
  dockRing.rotation.x = Math.PI / 2;

  // Borde del escudo térmico
  const shieldRim = add(new THREE.TorusGeometry(2.5, 0.06, 10, SEGMENTS), m.metal, 0, 0, 0);
  shieldRim.rotation.x = Math.PI / 2;

  // --- Adaptador: banda blanca con "NASA" (y: -1 → 0) ---
  const bandGeometry = new THREE.CylinderGeometry(2.55, 2.55, 1.0, SEGMENTS, 1, false, FRONT_START);
  add(bandGeometry, [m.band, m.white, m.white], 0, -0.5, 0);
  add(new THREE.CylinderGeometry(2.3, 2.1, 0.25, SEGMENTS), m.dark, 0, -1.125, 0);

  // --- Módulo de servicio (y: -1.25 → -4.05) ---
  const smTop = -1.25;
  const smHeight = 2.8;
  const smRadius = 2.05;
  const smBottom = smTop - smHeight;
  add(
    new THREE.CylinderGeometry(smRadius, smRadius, smHeight, SEGMENTS, 1, false, FRONT_START),
    [m.service, m.white, m.dark],
    0,
    smTop - smHeight / 2,
    0
  );

  // Módulos de propulsores de control (RCS) en los cuatro costados
  const podGeometry = new THREE.BoxGeometry(0.36, 0.52, 0.3);
  const rcsNozzle = createBellGeometry(0.45);
  for (let k = 0; k < 4; k++) {
    const az = (k * Math.PI) / 2;
    const pod = new THREE.Group();
    pod.rotation.y = az;
    hull.add(pod);
    add(podGeometry, m.white, smRadius + 0.12, smTop - 0.45, 0, pod);
    for (const dz of [-0.09, 0.09]) {
      const nozzle = add(rcsNozzle, m.engine, smRadius + 0.28, smTop - 0.45, dz, pod);
      nozzle.rotation.z = -Math.PI / 2; // abre hacia fuera
    }
  }

  // Asideros y antenas pequeñas en el adaptador
  [0.3, -0.3].forEach((x) => strut(V(x * 3, -0.15, 2.45), V(x * 3, -0.85, 2.45), 0.025, m.metal));

  // --- Parte inferior: carenado, motor principal y propulsores auxiliares ---
  add(new THREE.CylinderGeometry(smRadius, 1.15, 0.4, SEGMENTS), m.dark, 0, smBottom - 0.2, 0);
  add(new THREE.CylinderGeometry(0.5, 0.36, 0.3, 32), m.metal, 0, smBottom - 0.55, 0);
  const mainEngine = add(createBellGeometry(5.2), m.engine, 0, smBottom - 0.7, 0);
  mainEngine.rotation.x = Math.PI; // abre hacia abajo

  const auxNozzle = createBellGeometry(1.1);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const nozzle = add(auxNozzle, m.engine, Math.cos(a) * 1.45, smBottom - 0.4, Math.sin(a) * 1.45);
    nozzle.rotation.x = Math.PI;
  }

  // --- Cuatro alas solares en X ---
  const panelLength = 2.2;
  const panelWidth = 1.9;
  const panelGap = 0.08;
  const panelGeometry = new THREE.BoxGeometry(panelLength, panelWidth, 0.05);
  // Orden de caras: +X, -X, +Y, -Y, +Z (celdas), -Z (reverso)
  const panelFaces = [m.metal, m.metal, m.metal, m.metal, m.solar, m.solarBack];
  const hingeGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.2, 10);
  const driveGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 24);
  const wings = [];

  for (let k = 0; k < 4; k++) {
    const wing = new THREE.Group();
    wing.position.y = smBottom + 0.55;
    wing.rotation.y = Math.PI / 4 + (k * Math.PI) / 2; // +X local apunta hacia fuera
    hull.add(wing);

    const drive = add(driveGeometry, m.dark, smRadius + 0.1, 0, 0, wing);
    drive.rotation.z = Math.PI / 2;
    strut(V(smRadius + 0.2, 0, 0), V(smRadius + 0.75, 0, 0), 0.06, m.metal, wing);

    const array = new THREE.Group();
    array.position.x = smRadius + 0.75;
    array.rotation.x = -Math.PI / 2; // posición inicial plana; luego sigue la luz
    wing.add(array);

    for (let i = 0; i < 3; i++) {
      add(panelGeometry, panelFaces, 0.05 + panelLength / 2 + i * (panelLength + panelGap), 0, 0, array);
      if (i > 0) {
        const hx = 0.05 + i * (panelLength + panelGap) - panelGap / 2;
        for (const hy of [-0.6, 0.6]) {
          const hinge = add(hingeGeometry, m.dark, hx, hy, 0, array);
          hinge.rotation.x = Math.PI / 2;
        }
      }
    }

    wings.push({ wing, array });
  }

  return { root, wings };
}

/** Materiales de la cápsula; comparten el mapa de entorno con el satélite */
function createMaterials(renderer, textures) {
  const envMap = getEnvironmentMap(renderer);
  const standard = (params) => new THREE.MeshStandardMaterial({ envMap, ...params });

  return {
    crew: standard({ map: textures.crewMap, metalness: 0.7, roughness: 0.34, envMapIntensity: 0.9 }),
    band: standard({ map: textures.bandMap, metalness: 0.05, roughness: 0.5, envMapIntensity: 0.5 }),
    service: standard({ map: textures.serviceMap, metalness: 0.05, roughness: 0.55, envMapIntensity: 0.5 }),
    white: standard({ color: 0xeef1f4, metalness: 0.05, roughness: 0.55, envMapIntensity: 0.5 }),
    metal: standard({ color: 0x9aa1ab, metalness: 0.85, roughness: 0.38, envMapIntensity: 0.7 }),
    dark: standard({ color: 0x2b2f36, metalness: 0.8, roughness: 0.42, envMapIntensity: 0.6 }),
    engine: standard({ color: 0x3a3631, metalness: 0.9, roughness: 0.32, envMapIntensity: 0.8, side: THREE.DoubleSide }),
    solar: standard({ map: textures.solarMap, metalness: 0.5, roughness: 0.25, envMapIntensity: 1.0 }),
    solarBack: standard({ map: textures.solarBackMap, metalness: 0.2, roughness: 0.7, envMapIntensity: 0.4 })
  };
}
