import * as THREE from 'three';
import { createEnvMaterialFactory, createPartBuilder, V } from '../utils/spacecraft.js';
import { createRoverTextures } from './textures.js';

/** Medidas de las ruedas (m) */
const WHEEL_RADIUS = 0.13;
const WHEEL_WIDTH = 0.15;

/**
 * Construye un rover de exploración marciana de seis ruedas, en unidades locales (~metros;
 * +Y = arriba, +Z = hacia delante, origen en el suelo bajo el centro del rover).
 * Devuelve la raíz, las ruedas (cada una gira sobre su eje X local al avanzar) y el cabezal
 * del mástil (gira sobre Y para barrer el paisaje con las cámaras).
 */
export function buildRoverModel({ renderer, anisotropy }) {
  const textures = createRoverTextures(anisotropy);
  const m = createMaterials(renderer, textures);
  const root = new THREE.Group();
  const { add, strut } = createPartBuilder(root);

  // --- Ruedas y suspensión rocker-bogie ---
  const wheels = [];
  const tireGeometry = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 40);
  const rimGeometry = new THREE.TorusGeometry(WHEEL_RADIUS - 0.006, 0.009, 8, 40);
  const hubCapGeometry = new THREE.CylinderGeometry(0.035, 0.04, 0.03, 20);
  const steerGeometry = new THREE.CylinderGeometry(0.035, 0.035, 0.07, 16);
  const wheelX = 0.6;
  const wheelZ = { front: 0.58, middle: 0.02, rear: -0.52 };

  for (const side of [1, -1]) {
    const inner = side * (wheelX - WHEEL_WIDTH / 2 - 0.02); // x de los soportes, por dentro de la rueda

    for (const [position, z] of Object.entries(wheelZ)) {
      const wheel = new THREE.Group();
      wheel.position.set(side * wheelX, WHEEL_RADIUS, z);
      root.add(wheel);
      // Eje del cilindro sobre X: la tapa superior (+Y local) queda hacia fuera del rover
      const tire = add(tireGeometry, [m.tread, m.hub, m.wheelInner], 0, 0, 0, wheel);
      tire.rotation.z = -side * (Math.PI / 2);
      const rim = add(rimGeometry, m.metal, (side * WHEEL_WIDTH) / 2, 0, 0, wheel);
      rim.rotation.y = Math.PI / 2;
      const cap = add(hubCapGeometry, m.metal, (side * (WHEEL_WIDTH + 0.03)) / 2, 0, 0, wheel);
      cap.rotation.z = Math.PI / 2;
      wheels.push(wheel);

      // Soporte vertical desde la suspensión hasta el buje (+ actuador de dirección en las esquinas)
      const top = position === 'front' ? 0.36 : 0.3;
      strut(V(inner, top, z), V(inner, WHEEL_RADIUS, z), 0.018, m.metal);
      strut(V(inner, WHEEL_RADIUS, z), V(side * (wheelX - WHEEL_WIDTH / 2), WHEEL_RADIUS, z), 0.022, m.metal);
      if (position !== 'middle') add(steerGeometry, m.dark, inner, top + 0.02, z);
    }

    // Balancín (rocker): pivote en el cuerpo → rueda delantera y → pivote del bogie
    const pivot = V(side * 0.5, 0.5, 0.12);
    const bogiePivot = V(inner, 0.34, -0.25);
    add(new THREE.SphereGeometry(0.045, 16, 12), m.dark, pivot.x, pivot.y, pivot.z);
    strut(pivot, V(inner, 0.4, wheelZ.front), 0.026, m.metal);
    strut(pivot, bogiePivot, 0.026, m.metal);
    // Bogie: pivote → ruedas central y trasera
    add(new THREE.SphereGeometry(0.035, 14, 10), m.dark, bogiePivot.x, bogiePivot.y, bogiePivot.z);
    strut(bogiePivot, V(inner, 0.3, wheelZ.middle), 0.022, m.metal);
    strut(bogiePivot, V(inner, 0.3, wheelZ.rear), 0.022, m.metal);
  }
  // Diferencial que une los dos balancines por encima del cuerpo trasero
  strut(V(-0.5, 0.5, 0.12), V(0.5, 0.5, 0.12), 0.02, m.metal);

  // --- Cuerpo (caja electrónica caliente) ---
  const bodyW = 0.84;
  const bodyH = 0.5;
  const bodyD = 1.0;
  const bodyY = 0.36 + bodyH / 2;
  add(new THREE.BoxGeometry(bodyW, bodyH, bodyD), m.body, 0, bodyY, 0.03);
  add(new THREE.BoxGeometry(bodyW + 0.02, 0.05, bodyD + 0.02), m.dark, 0, 0.36, 0.03); // placa base
  // Cajas de equipos a los costados
  add(new THREE.BoxGeometry(0.05, 0.16, 0.34), m.metal, bodyW / 2 + 0.025, 0.5, 0.18);
  add(new THREE.BoxGeometry(0.05, 0.12, 0.26), m.metal, -bodyW / 2 - 0.025, 0.48, -0.2);

  // Cámaras de peligros (hazcams) delante y detrás: barra con dos lentes
  const lensGeometry = new THREE.CylinderGeometry(0.018, 0.018, 0.02, 16);
  for (const dir of [1, -1]) {
    const z = 0.03 + dir * (bodyD / 2 + 0.03);
    add(new THREE.BoxGeometry(0.3, 0.05, 0.05), m.dark, 0, 0.44, z);
    for (const x of [-0.1, 0.1]) {
      const lens = add(lensGeometry, m.lens, x, 0.44, z + dir * 0.03);
      lens.rotation.x = Math.PI / 2;
    }
  }

  // --- Cubierta solar con alas (UV en metros, ver solarMap.repeat) ---
  const deckY = bodyY + bodyH / 2 + 0.02;
  const outline = [
    [-0.5, 0.62], [0.5, 0.62], [0.64, 0.46], [1.16, 0.4], [1.22, 0.02], [1.06, -0.42],
    [0.62, -0.58], [0.46, -0.95], [-0.46, -0.95], [-0.62, -0.58], [-1.06, -0.42],
    [-1.22, 0.02], [-1.16, 0.4], [-0.64, 0.46]
  ];
  // La forma se dibuja en XY con y = -z para que, al tumbarla, quede en el plano XZ
  const deckShape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const deck = add(new THREE.ExtrudeGeometry(deckShape, { depth: 0.025, bevelEnabled: false }), [m.solar, m.metal], 0, deckY, 0);
  deck.rotation.x = -Math.PI / 2;
  // Marco de aluminio bajo la cubierta
  add(new THREE.BoxGeometry(2.3, 0.02, 0.03), m.metal, 0, deckY - 0.01, 0.02);
  add(new THREE.BoxGeometry(0.03, 0.02, 1.5), m.metal, 0, deckY - 0.01, -0.15);

  // --- Mástil de cámaras panorámicas (PMA) ---
  const deckTop = deckY + 0.025;
  const mastX = -0.24;
  const mastZ = 0.42;
  const mastTop = deckTop + 0.95;
  add(new THREE.CylinderGeometry(0.075, 0.09, 0.07, 24), m.metal, mastX, deckTop + 0.035, mastZ);
  add(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 24), m.white, mastX, deckTop + 0.14, mastZ); // articulación baja
  add(new THREE.CylinderGeometry(0.042, 0.042, mastTop - deckTop - 0.2, 24), m.white, mastX, (deckTop + 0.2 + mastTop) / 2, mastZ);
  add(new THREE.CylinderGeometry(0.052, 0.052, 0.05, 24), m.white, mastX, deckTop + 0.42, mastZ);
  // Cable cobrizo enrollado al mástil
  const cablePoints = [];
  for (let i = 0; i <= 40; i++) {
    const u = i / 40;
    const angle = u * Math.PI * 3;
    cablePoints.push(V(mastX + Math.cos(angle) * 0.05, deckTop + 0.22 + u * (mastTop - deckTop - 0.28), mastZ + Math.sin(angle) * 0.05));
  }
  add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cablePoints), 80, 0.007, 6), m.copper);

  // Cabezal: codo de elevación + barra de cámaras (gira para barrer el paisaje)
  const mastHead = new THREE.Group();
  mastHead.position.set(mastX, mastTop, mastZ);
  root.add(mastHead);
  const elbow = add(new THREE.CylinderGeometry(0.065, 0.065, 0.2, 24), m.white, 0.03, 0.02, 0, mastHead);
  elbow.rotation.z = Math.PI / 2;
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 20), m.metal, 0.14, 0.02, 0, mastHead);
  add(new THREE.BoxGeometry(0.12, 0.08, 0.1), m.white, 0, 0.1, 0, mastHead);
  add(new THREE.BoxGeometry(0.46, 0.035, 0.13), m.metal, 0, 0.155, 0, mastHead);
  const camLens = new THREE.CylinderGeometry(0.02, 0.022, 0.03, 16);
  // Cámaras panorámicas (exteriores) y de navegación (interiores)
  [[-0.17, 0.075], [0.17, 0.075], [-0.06, 0.06], [0.06, 0.06]].forEach(([x, size]) => {
    add(new THREE.BoxGeometry(size, size, 0.1), m.camera, x, 0.21, 0, mastHead);
    const lens = add(camLens, m.lens, x, 0.21, 0.065, mastHead);
    lens.rotation.x = Math.PI / 2;
  });
  add(new THREE.BoxGeometry(0.08, 0.05, 0.08), m.copper, 0.0, 0.21, -0.02, mastHead);

  // --- Antena de baja ganancia: varilla telescópica ---
  const lgaX = 0.3;
  const lgaZ = 0.1;
  add(new THREE.CylinderGeometry(0.03, 0.035, 0.08, 16), m.dark, lgaX, deckTop + 0.04, lgaZ);
  add(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 12), m.metal, lgaX, deckTop + 0.23, lgaZ);
  add(new THREE.CylinderGeometry(0.011, 0.011, 0.3, 10), m.metal, lgaX, deckTop + 0.52, lgaZ);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 12), m.metal, lgaX, deckTop + 0.4, lgaZ);
  add(new THREE.SphereGeometry(0.016, 12, 8), m.metal, lgaX, deckTop + 0.68, lgaZ);

  // --- Antena de alta ganancia: disco sobre cardán ---
  const hga = new THREE.Group();
  hga.position.set(0.5, deckTop, -0.18);
  root.add(hga);
  add(new THREE.BoxGeometry(0.12, 0.1, 0.12), m.white, 0, 0.05, 0, hga);
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 16), m.white, 0, 0.15, 0, hga);
  const dishMount = new THREE.Group();
  dishMount.position.set(0, 0.24, 0);
  dishMount.rotation.set(-1.0, 0.5, 0);
  hga.add(dishMount);
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 16), m.white, 0, 0.0, 0, dishMount);
  add(new THREE.CylinderGeometry(0.15, 0.15, 0.035, 40), [m.copper, m.dishFace, m.dark], 0, 0.06, 0, dishMount);

  // --- Brazo robótico (IDD) con torreta de instrumentos ---
  const shoulder = V(0.22, 0.6, 0.56);
  const elbowJoint = V(-0.02, 0.68, 0.9);
  const wrist = V(-0.3, 0.34, 1.0);
  add(new THREE.BoxGeometry(0.1, 0.1, 0.08), m.white, shoulder.x, shoulder.y, shoulder.z);
  strut(shoulder, elbowJoint, 0.024, m.metal);
  strut(elbowJoint, wrist, 0.022, m.metal);
  // Cinta de cable plano (verde pálido) a lo largo del antebrazo
  const ribbon = strut(V(0.18, 0.64, 0.6), V(-0.28, 0.42, 0.98), 0.012, m.ribbon);
  ribbon.scale.set(2.4, 1, 0.4);
  const elbowMesh = add(new THREE.CylinderGeometry(0.04, 0.04, 0.09, 16), m.white, elbowJoint.x, elbowJoint.y, elbowJoint.z);
  elbowMesh.rotation.z = Math.PI / 2;

  const turret = new THREE.Group();
  turret.position.copy(wrist);
  turret.rotation.set(0.2, 0, 0.35);
  root.add(turret);
  const turretHub = add(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 16), m.white, 0, 0, 0, turret);
  turretHub.rotation.z = Math.PI / 2;
  // Cuatro instrumentos alrededor del eje de la torreta
  const instruments = [
    [new THREE.CylinderGeometry(0.035, 0.035, 0.14, 16), m.metal],
    [new THREE.BoxGeometry(0.07, 0.12, 0.07), m.body],
    [new THREE.CylinderGeometry(0.03, 0.04, 0.12, 16), m.copper],
    [new THREE.CylinderGeometry(0.028, 0.028, 0.13, 16), m.dark]
  ];
  instruments.forEach(([geometry, material], i) => {
    const holder = new THREE.Group();
    holder.rotation.x = (i / instruments.length) * Math.PI * 2;
    turret.add(holder);
    add(geometry, material, 0, 0.1, 0, holder);
  });

  return { root, wheels, mastHead };
}

/** Materiales del rover (comparten el mapa de entorno de las naves para los reflejos metálicos) */
function createMaterials(renderer, textures) {
  const standard = createEnvMaterialFactory(renderer);
  return {
    body: standard({ map: textures.bodyMap, bumpMap: textures.bodyBump, bumpScale: 1.2, metalness: 0.85, roughness: 0.42, envMapIntensity: 0.8 }),
    solar: standard({ map: textures.solarMap, metalness: 0.5, roughness: 0.28, envMapIntensity: 1.0 }),
    metal: standard({ color: 0xb8b2a6, metalness: 0.85, roughness: 0.35, envMapIntensity: 0.8 }),
    white: standard({ color: 0xece4d6, metalness: 0.1, roughness: 0.5, envMapIntensity: 0.5 }),
    dark: standard({ color: 0x2e2a26, metalness: 0.7, roughness: 0.45, envMapIntensity: 0.6 }),
    camera: standard({ color: 0x8f8a82, metalness: 0.75, roughness: 0.4, envMapIntensity: 0.7 }),
    lens: standard({ color: 0x05070c, metalness: 0.3, roughness: 0.05, envMapIntensity: 1.4 }),
    copper: standard({ color: 0xb8692e, metalness: 0.9, roughness: 0.35, envMapIntensity: 0.9 }),
    dishFace: standard({ color: 0xa88a5a, metalness: 0.6, roughness: 0.3, envMapIntensity: 0.9 }),
    ribbon: standard({ color: 0x9fb48a, metalness: 0.2, roughness: 0.6, envMapIntensity: 0.4 }),
    tread: standard({ map: textures.treadMap, bumpMap: textures.treadBump, bumpScale: 2, metalness: 0.75, roughness: 0.5, envMapIntensity: 0.6 }),
    hub: standard({ map: textures.hubMap, metalness: 0.8, roughness: 0.4, envMapIntensity: 0.7 }),
    wheelInner: standard({ color: 0x4a443c, metalness: 0.7, roughness: 0.5, envMapIntensity: 0.5 })
  };
}
