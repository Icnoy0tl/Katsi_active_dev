import * as THREE from 'three';
import { createCanvas, createSeededRandom } from '../utils/canvas.js';
import { escapeHtml, formatLatLon } from '../utils/format.js';

const deg = THREE.MathUtils.degToRad;

/**
 * Convierte latitud/longitud (grados) a un punto sobre una SphereGeometry de Three.js
 * con textura equirectangular (u = 0 en longitud -180°, centro de la textura en 0°).
 */
function latLonToVector3(latitude, longitude, radius) {
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
  gap: 0.008, // separación mínima entre áreas vecinas (fracción del radio)
  maxSegment: 0.02, // longitud máxima de un lado tras recortar (el borde sigue la curvatura)
  fillOpacity: 0.58,
  // Color de cada área: tonos repartidos con el ángulo áureo (dos misiones seguidas nunca se parecen).
  // Saturación alta y luminosidad media: colores vivos que no se lavan sobre el gris de la Luna
  hueStep: 0.618034,
  fill: { saturation: 0.95, lightness: 0.55 },
  outline: { saturation: 1, lightness: 0.72 }
};

/** Materiales de relleno y borde con un tono propio para el área número `index` */
function createAreaMaterials(index) {
  const hue = (index * AREA.hueStep) % 1;
  const common = { transparent: true, depthWrite: false, side: THREE.DoubleSide };
  return {
    fill: new THREE.MeshBasicMaterial({
      ...common,
      color: new THREE.Color().setHSL(hue, AREA.fill.saturation, AREA.fill.lightness),
      opacity: AREA.fillOpacity
    }),
    border: new THREE.MeshBasicMaterial({
      ...common,
      color: new THREE.Color().setHSL(hue, AREA.outline.saturation, AREA.outline.lightness),
      opacity: 0.95
    })
  };
}

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
  const outlinePositions = [];
  const outlineIndices = [];
  outline.forEach((p) => {
    const inner = p.clone().multiplyScalar(Math.max(0, 1 - outlineWidth / p.length()));
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

/**
 * Recorta el contorno del área `i` para que no invada a ninguna vecina: cada par de áreas se
 * reparte el terreno por el círculo máximo que equidista de sus centros (un Voronoi esférico).
 * En el plano tangente (proyección gnomónica, la misma que usa `createAreaGeometries`) ese
 * círculo máximo es una recta, así que basta un recorte de polígono por semiplano.
 * El área sigue siendo estrellada respecto a su centro (intersección con conjuntos convexos
 * que lo contienen), así que el abanico del relleno sigue siendo válido.
 */
function clipToNeighbors(outline, frame, radius, neighbors) {
  let polygon = outline;
  const w = new THREE.Vector3();

  neighbors.forEach((other) => {
    // Lado propio: (R·n + x·e + y·u) · (n − m) ≥ margen
    w.subVectors(frame.normal, other);
    const a = frame.east.dot(w);
    const b = frame.north.dot(w);
    const c = radius * (1 - frame.normal.dot(other));
    const length = Math.hypot(a, b);
    if (length < 1e-12) return; // mismo punto: nada que repartir
    // Distancia del centro a la recta de reparto; el margen nunca deja fuera el propio centro
    const margin = Math.min(radius * AREA.gap, (c / length) * 0.4) * length;
    const side = (p) => c + a * p.x + b * p.y - margin;
    const farthest = Math.max(...polygon.map((p) => -side(p)));
    if (farthest <= 0) return; // la vecina está lejos: el contorno no llega a la recta

    const clipped = [];
    polygon.forEach((p, k) => {
      const q = polygon[(k + 1) % polygon.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) clipped.push(p);
      if (sp >= 0 !== sq >= 0) clipped.push(p.clone().lerp(q, sp / (sp - sq)));
    });
    polygon = clipped;
  });

  // Los cortes dejan lados largos y rectos: se subdividen para que no se hundan en el terreno
  const maxSegment = radius * AREA.maxSegment;
  const dense = [];
  polygon.forEach((p, k) => {
    const q = polygon[(k + 1) % polygon.length];
    const steps = Math.max(1, Math.ceil(p.distanceTo(q) / maxSegment));
    for (let s = 0; s < steps; s++) dense.push(p.clone().lerp(q, s / steps));
  });
  return dense;
}

/** Centroide (por superficie) de un polígono plano */
function polygonCentroid(polygon) {
  let area = 0;
  let x = 0;
  let y = 0;
  polygon.forEach((p, k) => {
    const q = polygon[(k + 1) % polygon.length];
    const cross = p.x * q.y - q.x * p.y;
    area += cross;
    x += (p.x + q.x) * cross;
    y += (p.y + q.y) * cross;
  });
  return Math.abs(area) < 1e-12 ? new THREE.Vector2() : new THREE.Vector2(x / (3 * area), y / (3 * area));
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
 * añaden como hijos, así giran con él), cada una con su propio color. El material del
 * distintivo se comparte; la geometría se genera una vez por región.
 */
export function createTerrainMarkers({ body, radius, regions }) {
  const group = new THREE.Group();
  group.name = 'terrain-areas';

  const badgeMaterial = new THREE.SpriteMaterial({ map: createBadgeTexture(), depthWrite: false });

  const hitTargets = [];
  const areas = new Map(); // regionId → { normal, outline, anchor, group, badge }
  const normals = regions.map(({ coordinates }) => latLonToVector3(coordinates.latitude, coordinates.longitude, 1));

  // Distintivos en el centro visible de cada área (si dos regiones casi coinciden, cada una
  // queda en su mitad) y de un tamaño que no los solape
  const anchors = [];

  regions.forEach((region, index) => {
    const normal = normals[index];
    const frame = surfaceFrame(normal);
    const neighbors = normals.filter((other) => other !== normal);
    const outline = clipToNeighbors(createOutline(hashString(region.regionId), radius * AREA.size), frame, radius, neighbors);
    const { fill, border } = createAreaGeometries(outline, frame, radius, radius * AREA.outlineWidth);

    const center = polygonCentroid(outline);
    const anchor = frame.normal
      .clone()
      .multiplyScalar(radius)
      .addScaledVector(frame.east, center.x)
      .addScaledVector(frame.north, center.y)
      .normalize();
    anchors.push(anchor);

    const materials = createAreaMaterials(index);
    const fillMesh = new THREE.Mesh(fill, materials.fill);
    fillMesh.userData.region = region;
    const borderMesh = new THREE.Mesh(border, materials.border);
    borderMesh.renderOrder = 1;

    const badge = new THREE.Sprite(badgeMaterial);
    badge.position.copy(anchor).multiplyScalar(radius * 1.02);
    badge.renderOrder = 2;
    badge.userData.region = region;

    const area = new THREE.Group();
    area.add(fillMesh, borderMesh, badge);
    group.add(area);
    hitTargets.push(fillMesh, badge);
    areas.set(region.regionId, { normal, outline, anchor, group: area, badge });
  });

  // Tamaño de cada distintivo: el normal, salvo que la vecina más próxima esté más cerca
  areas.forEach((entry) => {
    const nearest = Math.min(...anchors.filter((a) => a !== entry.anchor).map((a) => a.distanceTo(entry.anchor)));
    entry.badge.scale.setScalar(radius * Math.min(AREA.badgeSize, nearest * 0.9));
  });

  body.add(group);

  let allowed = null; // regionIds del filtro de misión (null = todas)
  let only = null; // área de la misión abierta (null = todas las permitidas)
  const applyVisibility = () =>
    areas.forEach((entry, id) => (entry.group.visible = only === null ? !allowed || allowed.has(id) : id === only));

  return {
    group,
    hitTargets,
    /** Muestra solo el área de `regionId` (o, con `null`, todas las que deja el filtro de misión) */
    showOnly(regionId) {
      only = regionId;
      applyVisibility();
    },
    /** Áreas que deja ver el filtro de misión (`null` = todas) */
    setAllowed(regionIds) {
      allowed = regionIds ? new Set(regionIds) : null;
      applyVisibility();
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
      return body.localToWorld(out.copy(entry.anchor).multiplyScalar(radius));
    },
    /** Quita las áreas del cuerpo y libera su memoria de GPU (al rehacerlas con otras regiones) */
    dispose() {
      group.removeFromParent();
      group.traverse((object) => {
        if (!object.isSprite) object.geometry?.dispose(); // la de los sprites la comparte three.js
        if (object.material && object.material !== badgeMaterial) object.material.dispose();
      });
      badgeMaterial.map.dispose();
      badgeMaterial.dispose();
    }
  };
}

/** Desplazamiento máximo del puntero (px) para considerar un clic y no un arrastre de cámara */
const CLICK_TOLERANCE = 5;

/**
 * Etiqueta flotante con el nombre y coordenadas del terreno bajo el cursor, y clic sobre un
 * área → `onSelect(region)`. `occluders` son los cuerpos que tapan las áreas de la cara oculta.
 * `markerSets`: lista de createTerrainMarkers, o función que la devuelve (si se rehacen).
 */
export function setupMarkerTooltip({ camera, domElement, markerSets, occluders, onSelect }) {
  const tooltip = document.createElement('div');
  tooltip.className = 'terrain-tooltip is-hidden';
  document.body.appendChild(tooltip);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let current = null;
  let pending = false;
  let lastEvent = null;

  /** Región bajo el puntero (solo cuenta el primer impacto: si es el cuerpo, el área está detrás) */
  function regionAt(event) {
    // El raycaster no respeta `visible`: las áreas ocultas (menú, otro cuerpo, otras misiones) no cuentan
    const sets = typeof markerSets === 'function' ? markerSets() : markerSets;
    const areaTargets = sets
      .filter((set) => set.group.visible)
      .flatMap((set) => set.hitTargets)
      .filter((target) => target.parent.visible);
    // Sin áreas a la vista no hay nada que encontrar: se evita el raycast contra las esferas
    // de los cuerpos (decenas de miles de triángulos) en cada movimiento del puntero
    if (!areaTargets.length) return null;
    const rect = domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects([...occluders, ...areaTargets], false)[0]?.object.userData.region ?? null;
  }

  function pick() {
    pending = false;
    const region = regionAt(lastEvent);

    if (region !== current) {
      current = region;
      domElement.style.cursor = region ? 'pointer' : '';
      if (region) {
        tooltip.innerHTML = `<strong>${escapeHtml(region.name)}</strong><span>${region.regionId} · ${formatLatLon(region.coordinates)}</span>`;
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
