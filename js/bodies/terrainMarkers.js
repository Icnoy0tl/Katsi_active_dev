import * as THREE from 'three';
import { createCanvas, createSeededRandom } from '../utils/canvas.js';

const deg = THREE.MathUtils.degToRad;

/**
 * Convierte latitud/longitud (grados) a un punto sobre una SphereGeometry de Three.js
 * con textura equirectangular (u = 0 en longitud -180°, centro de la textura en 0°).
 */
export function latLonToVector3(latitude, longitude, radius) {
  const phi = deg(longitude + 180); // ángulo azimutal de SphereGeometry
  const theta = deg(90 - latitude); // ángulo polar desde el polo norte
  return new THREE.Vector3(
    -radius * Math.cos(phi) * Math.sin(theta),
    radius * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

/** Apariencia de las áreas de terreno (tamaños relativos al radio del cuerpo) */
const AREA = {
  size: 0.1, // radio medio del área (fracción del radio del cuerpo)
  vertices: 13, // vértices del contorno (pocos → bordes rectos, como un polígono trazado a mano)
  edgeSubdivisions: 4, // subdivisiones por lado para que el borde siga la curvatura
  rings: 4, // anillos interiores del relleno (misma razón)
  outlineWidth: 0.006,
  lift: 1.0025, // separación sobre la superficie (evita parpadeo con el terreno)
  badgeSize: 0.075,
  fillColor: 0xd9cb98,
  fillOpacity: 0.5,
  outlineColor: 0xf6eab0
};

/** Semilla numérica estable a partir del ID de la región */
function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/**
 * Contorno irregular en el plano tangente (x, y) en unidades de escena: radio variable con
 * pocas ondas superpuestas y un estiramiento en una dirección aleatoria. Determinista por región.
 */
function createOutline(seed, size) {
  const random = createSeededRandom(seed);
  const waves = [2, 3, 5].map((k) => ({ k, amp: 0.08 + random() * 0.14, phase: random() * Math.PI * 2 }));
  const stretch = 1.25 + random() * 0.35;
  const rotation = random() * Math.PI;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const points = [];
  for (let i = 0; i < AREA.vertices; i++) {
    const angle = (i / AREA.vertices) * Math.PI * 2;
    let r = 1 + (random() - 0.5) * 0.18;
    waves.forEach(({ k, amp, phase }) => (r += amp * Math.sin(k * angle + phase)));
    const x = Math.cos(angle) * r * size * stretch;
    const y = Math.sin(angle) * r * size;
    points.push(new THREE.Vector2(x * cos - y * sin, x * sin + y * cos));
  }

  // Lados subdivididos (línea recta en el plano; luego se proyecta sobre la esfera)
  const dense = [];
  points.forEach((point, i) => {
    const next = points[(i + 1) % points.length];
    for (let s = 0; s < AREA.edgeSubdivisions; s++) dense.push(point.clone().lerp(next, s / AREA.edgeSubdivisions));
  });
  return dense;
}

/**
 * Proyecta puntos del plano tangente sobre la esfera y construye el relleno (abanico
 * subdividido en anillos) y el borde (cinta de ancho constante hacia el interior).
 * El contorno es estrellado respecto al centro, así que el abanico nunca se cruza.
 */
function createAreaGeometries(outline, frame, radius, outlineWidth) {
  const surfaceRadius = radius * AREA.lift;
  const project = (x, y, out = new THREE.Vector3()) =>
    out
      .copy(frame.normal)
      .multiplyScalar(radius)
      .addScaledVector(frame.east, x)
      .addScaledVector(frame.north, y)
      .setLength(surfaceRadius);

  const count = outline.length;
  const fillPositions = [];
  const fillIndices = [];
  const v = new THREE.Vector3();

  project(0, 0, v);
  fillPositions.push(v.x, v.y, v.z);
  for (let ring = 1; ring <= AREA.rings; ring++) {
    const t = ring / AREA.rings;
    outline.forEach((p) => {
      project(p.x * t, p.y * t, v);
      fillPositions.push(v.x, v.y, v.z);
    });
  }
  const at = (ring, i) => 1 + (ring - 1) * count + (i % count);
  for (let i = 0; i < count; i++) fillIndices.push(0, at(1, i), at(1, i + 1));
  for (let ring = 1; ring < AREA.rings; ring++) {
    for (let i = 0; i < count; i++) {
      const a = at(ring, i);
      const b = at(ring, i + 1);
      const c = at(ring + 1, i);
      const d = at(ring + 1, i + 1);
      fillIndices.push(a, c, b, b, c, d);
    }
  }

  const fill = new THREE.BufferGeometry();
  fill.setAttribute('position', new THREE.Float32BufferAttribute(fillPositions, 3));
  fill.setIndex(fillIndices);
  fill.computeBoundingSphere();

  // Borde: cada vértice se desplaza hacia el centro una distancia fija
  const width = outlineWidth;
  const outlinePositions = [];
  const outlineIndices = [];
  outline.forEach((p) => {
    const inner = p.clone().multiplyScalar(Math.max(0, 1 - width / p.length()));
    project(p.x, p.y, v);
    outlinePositions.push(v.x, v.y, v.z);
    project(inner.x, inner.y, v);
    outlinePositions.push(v.x, v.y, v.z);
  });
  for (let i = 0; i < count; i++) {
    const a = i * 2;
    const b = ((i + 1) % count) * 2;
    outlineIndices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const border = new THREE.BufferGeometry();
  border.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));
  border.setIndex(outlineIndices);

  return { fill, border };
}

/** Base local de la superficie en un punto: normal hacia fuera, este y norte */
function surfaceFrame(normal) {
  const east = new THREE.Vector3(0, 1, 0).cross(normal);
  if (east.lengthSq() < 1e-10) east.set(1, 0, 0); // justo en un polo
  east.normalize();
  const north = new THREE.Vector3().crossVectors(normal, east);
  return { normal, east, north };
}

/** Distintivo blanco circular con un módulo de aterrizaje (siempre de cara a la cámara) */
function createBadgeTexture() {
  const size = 128;
  const { canvas, ctx } = createCanvas(size, size);
  const c = size / 2;

  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(c, c, 50, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // Módulo de aterrizaje: cuerpo, antena y patas
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c - 15, c - 6);
  ctx.lineTo(c, c - 20);
  ctx.lineTo(c + 15, c - 6);
  ctx.lineTo(c + 15, c + 8);
  ctx.lineTo(c - 15, c + 8);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(c, c - 20);
  ctx.lineTo(c, c - 29);
  ctx.moveTo(c - 12, c + 8);
  ctx.lineTo(c - 23, c + 25);
  ctx.moveTo(c + 12, c + 8);
  ctx.lineTo(c + 23, c + 25);
  ctx.moveTo(c - 29, c + 25);
  ctx.lineTo(c - 17, c + 25);
  ctx.moveTo(c + 17, c + 25);
  ctx.lineTo(c + 29, c + 25);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Dibuja un área de terreno irregular por cada región sobre la superficie de `body` (se
 * añaden como hijos, así giran con él). Los materiales y la textura del distintivo se
 * comparten; la geometría se genera una vez por región.
 */
export function createTerrainMarkers({ body, radius, regions }) {
  const group = new THREE.Group();
  group.name = 'terrain-areas';

  const fillMaterial = new THREE.MeshBasicMaterial({
    color: AREA.fillColor,
    transparent: true,
    opacity: AREA.fillOpacity,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const borderMaterial = new THREE.MeshBasicMaterial({
    color: AREA.outlineColor,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const badgeMaterial = new THREE.SpriteMaterial({ map: createBadgeTexture(), depthWrite: false });

  const hitTargets = [];
  const areas = new Map(); // regionId → { normal, outline, group }

  regions.forEach((region) => {
    const { latitude, longitude } = region.coordinates;
    const normal = latLonToVector3(latitude, longitude, 1);
    const outline = createOutline(hashString(region.regionId), radius * AREA.size);
    const { fill, border } = createAreaGeometries(outline, surfaceFrame(normal), radius, radius * AREA.outlineWidth);

    const fillMesh = new THREE.Mesh(fill, fillMaterial);
    fillMesh.userData.region = region;
    const borderMesh = new THREE.Mesh(border, borderMaterial);
    borderMesh.renderOrder = 1;

    const badge = new THREE.Sprite(badgeMaterial);
    badge.position.copy(normal).multiplyScalar(radius * 1.02);
    badge.scale.setScalar(radius * AREA.badgeSize);
    badge.renderOrder = 2;
    badge.userData.region = region;

    const area = new THREE.Group();
    area.add(fillMesh, borderMesh, badge);
    group.add(area);
    hitTargets.push(fillMesh, badge);
    areas.set(region.regionId, { normal, outline, group: area });
  });

  body.add(group);

  return {
    group,
    hitTargets,
    /** Muestra solo el área de `regionId` (o todas con `null`) */
    showOnly(regionId) {
      areas.forEach((entry, id) => (entry.group.visible = regionId === null || id === regionId));
    },
    /** Base local del área (normal, este y norte) en coordenadas del cuerpo */
    localFrame(regionId) {
      const entry = areas.get(regionId);
      return entry ? surfaceFrame(entry.normal) : null;
    },
    /**
     * Contorno del área en el plano tangente (x = este, y = norte), en fracciones del radio
     * del cuerpo: multiplicado por el radio real da km
     */
    outline(regionId) {
      return areas.get(regionId)?.outline.map((p) => p.clone().divideScalar(radius)) ?? null;
    },
    /** Centro del área sobre la superficie, en coordenadas de mundo */
    worldPosition(regionId, out = new THREE.Vector3()) {
      const entry = areas.get(regionId);
      if (!entry) return null;
      return body.localToWorld(out.copy(entry.normal).multiplyScalar(radius));
    }
  };
}

/** Desplazamiento máximo del puntero (px) para considerar un clic y no un arrastre de cámara */
const CLICK_TOLERANCE = 5;

/**
 * Etiqueta flotante con el nombre y coordenadas del terreno bajo el cursor, y clic sobre un
 * área → `onSelect(region)`. `occluders` son los cuerpos que tapan las áreas de la cara oculta.
 */
export function setupMarkerTooltip({ camera, domElement, markerSets, occluders, onSelect }) {
  const tooltip = document.createElement('div');
  tooltip.className = 'terrain-tooltip is-hidden';
  document.body.appendChild(tooltip);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const targets = [...occluders, ...markerSets.flatMap((set) => set.hitTargets)];
  let current = null;
  let pending = false;
  let lastEvent = null;

  const format = (value, pos, neg) => `${Math.abs(value).toFixed(2)}° ${value >= 0 ? pos : neg}`;

  /** Región bajo el puntero (solo cuenta el primer impacto: si es el cuerpo, el área está detrás) */
  function regionAt(event) {
    const rect = domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(targets, false)[0]?.object.userData.region ?? null;
  }

  function pick() {
    pending = false;
    const region = regionAt(lastEvent);

    if (region !== current) {
      current = region;
      domElement.style.cursor = region ? 'pointer' : '';
      if (region) {
        const { latitude, longitude } = region.coordinates;
        tooltip.innerHTML = `<strong>${region.name}</strong><span>${region.regionId} · ${format(latitude, 'N', 'S')}, ${format(longitude, 'E', 'O')}</span>`;
      }
      tooltip.classList.toggle('is-hidden', !region);
    }
    if (region) tooltip.style.transform = `translate(${lastEvent.clientX + 14}px, ${lastEvent.clientY + 14}px)`;
  }

  // Un raycast por frame como máximo, aunque lleguen muchos eventos de puntero
  domElement.addEventListener('pointermove', (event) => {
    lastEvent = event;
    if (!pending) {
      pending = true;
      requestAnimationFrame(pick);
    }
  });
  domElement.addEventListener('pointerleave', () => {
    current = null;
    tooltip.classList.add('is-hidden');
  });

  // Clic: se calcula al soltar (también funciona en pantallas táctiles, donde no hay hover);
  // si el puntero se movió es un arrastre de cámara y se ignora
  let downX = 0;
  let downY = 0;
  domElement.addEventListener('pointerdown', (event) => {
    downX = event.clientX;
    downY = event.clientY;
  });
  domElement.addEventListener('pointerup', (event) => {
    if (!onSelect || Math.hypot(event.clientX - downX, event.clientY - downY) > CLICK_TOLERANCE) return;
    const region = regionAt(event);
    if (region) onSelect(region);
  });
}

/** Carga las regiones de un JSON `{ regions: [...] }` */
export async function loadRegions(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const { regions } = await response.json();
  return regions;
}
