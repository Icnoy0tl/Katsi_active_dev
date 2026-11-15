import * as THREE from 'three';

/** Composición en pantalla (px): separación cuerpo → holograma y margen con el borde */
const LAYOUT = { gapMin: 70, gapFraction: 0.06, margin: 16 };

/**
 * Recuadro del dibujo (unidades SVG; la forma ocupa [-1, 1]). Desplazado hacia abajo para dejar
 * más hueco inferior, donde van la escala y el nombre (HTML, tamaño fijo en px).
 */
const VIEW = { x: -1.45, y: -1.35, size: 2.9 };

const projected = new THREE.Vector3();
const edgePoint = new THREE.Vector3();
const toCamera = new THREE.Vector3();
const areaNormal = new THREE.Vector3();

/**
 * Transformación del análogo hacia el terreno de la misión: muestras angulares del contorno y
 * tiempos (ms). El inicio espera a que termine la animación de apertura (0.35 s + 0.7 s en CSS).
 */
const MORPH = { samples: 96, delay: 1050, duration: 1400 };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Radio del contorno (estrellado respecto al centro) en `samples` ángulos fijos: así dos contornos
 * cualesquiera se interpolan punto a punto sin cruces. Rayo desde el origen contra cada lado.
 */
function polarProfile(points, samples) {
  const radii = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const angle = (i / samples) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let best = 0;
    for (let j = 0; j < points.length; j++) {
      const a = points[j];
      const b = points[(j + 1) % points.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-12) continue;
      const t = (a.x * ey - a.y * ex) / denom; // distancia sobre el rayo
      const u = (a.x * dy - a.y * dx) / denom; // posición sobre el lado [0, 1]
      if (t > best && u >= 0 && u <= 1) best = t;
    }
    radii[i] = best;
  }
  return radii;
}

/** Puntos SVG de un perfil polar mezclado: (1 − mix)·from + mix·to (y de SVG invertida) */
function profileToPoints(from, to, mix) {
  let out = '';
  for (let i = 0; i < from.length; i++) {
    const angle = (i / from.length) * Math.PI * 2;
    const r = from[i] + (to[i] - from[i]) * mix;
    out += `${(Math.cos(angle) * r).toFixed(3)},${(-Math.sin(angle) * r).toFixed(3)} `;
  }
  return out;
}

/** Contorno normalizado al recuadro [-1, 1] por su mayor coordenada */
function normalizeOutline(outline) {
  const extent = Math.max(...outline.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  return { extent, points: outline.map((p) => ({ x: p.x / extent, y: p.y / extent })) };
}

/** Longitud "redonda" para la barra de escala (≈ 40 % del ancho del dibujo) */
function niceLength(maxKm) {
  const target = maxKm * 0.4;
  const pow = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map((m) => m * pow).filter((v) => v <= target).pop() ?? pow;
}

/** Haz (SVG a pantalla completa, coordenadas en px) y tarjeta del holograma */
function buildDom(container, id) {
  const beam = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  beam.setAttribute('class', 'hologram-beam is-hidden');
  beam.setAttribute('aria-hidden', 'true');
  beam.innerHTML = `
    <defs>
      <linearGradient id="${id}-beam-gradient" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#67e8f9" stop-opacity="0.55" />
        <stop offset="1" stop-color="#67e8f9" stop-opacity="0.07" />
      </linearGradient>
    </defs>
    <polygon class="hologram-beam-shape" fill="url(#${id}-beam-gradient)" />
    <polyline class="hologram-beam-edges" />`;

  const card = document.createElement('div');
  card.className = 'hologram is-hidden';
  card.setAttribute('aria-hidden', 'true');
  card.innerHTML = `
    <div class="holo-inner">
      <svg class="holo-svg" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.size} ${VIEW.size}">
        <defs>
          <pattern id="${id}-grid" width="0.26" height="0.26" patternUnits="userSpaceOnUse">
            <path d="M0.26 0H0V0.26" fill="none" stroke="rgba(103, 232, 249, 0.16)" stroke-width="0.006" />
          </pattern>
        </defs>
        <rect x="${VIEW.x}" y="${VIEW.y}" width="${VIEW.size}" height="${VIEW.size}" fill="url(#${id}-grid)" />
        <polygon class="holo-target" />
        <polygon class="holo-shape" />
        <circle r="0.2" class="holo-badge-ring" />
        <circle r="0.12" class="holo-badge" />
      </svg>
      <div class="holo-scan"></div>
      <p class="holo-header"><span class="holo-kicker"></span><span class="holo-tag"></span></p>
      <p class="holo-scale"><span class="holo-scale-label"></span><span class="holo-scale-bar"></span></p>
      <p class="holo-name"></p>
    </div>`;

  container.append(beam, card);
  return {
    beam,
    card,
    beamShape: beam.querySelector('.hologram-beam-shape'),
    beamEdges: beam.querySelector('.hologram-beam-edges'),
    shape: card.querySelector('.holo-shape'),
    target: card.querySelector('.holo-target'),
    scaleBar: card.querySelector('.holo-scale-bar'),
    scaleLabel: card.querySelector('.holo-scale-label'),
    kicker: card.querySelector('.holo-kicker'),
    tag: card.querySelector('.holo-tag'),
    name: card.querySelector('.holo-name')
  };
}

/**
 * Holograma de un terreno: tarjeta a la derecha de su cuerpo con la forma del área y un haz
 * de luz que sale del área sobre el cuerpo. Todo es HTML/SVG superpuesto (sin coste en WebGL);
 * cada fotograma solo se reproyectan 3 puntos y se actualizan 3 atributos.
 *
 * @param container  elemento donde se insertan el haz y la tarjeta
 * @param id         prefijo único para los ids internos del SVG (degradado y cuadrícula)
 * @returns { show(region, outline, realRadiusKm, labels, morph?), hide(), update(camera, bodyCenter, bodyRadius, areaPosition) }
 */
export function createHologram({ container, id }) {
  const dom = buildDom(container, id);

  let visible = false;
  let size = 0; // lado de la tarjeta (px), se mide al mostrar y al cambiar el tamaño de ventana
  const measure = () => (size = dom.card.offsetWidth);
  let morphFrame = 0;
  const stopMorph = () => cancelAnimationFrame(morphFrame);

  /**
   * Anima la forma del análogo desde su contorno propio hasta `similarity` del camino hacia el
   * contorno de la misión (el fantasma discontinuo). Solo dura `MORPH.duration`: después no
   * queda ningún trabajo por fotograma.
   */
  function startMorph(from, to, similarity) {
    const finalMix = THREE.MathUtils.clamp(similarity, 0, 1);
    if (reducedMotion.matches) {
      dom.shape.setAttribute('points', profileToPoints(from, to, finalMix));
      return;
    }
    dom.shape.setAttribute('points', profileToPoints(from, to, 0));
    // Si la tarjeta ya estaba abierta (cambio de análogo) no hay animación de apertura que esperar
    const start = performance.now() + (visible ? 0 : MORPH.delay);
    const step = (now) => {
      const t = THREE.MathUtils.clamp((now - start) / MORPH.duration, 0, 1);
      if (now >= start) {
        const eased = 1 - (1 - t) ** 3; // ease-out cúbico
        dom.shape.setAttribute('points', profileToPoints(from, to, finalMix * eased));
      }
      if (t < 1) morphFrame = requestAnimationFrame(step);
    };
    morphFrame = requestAnimationFrame(step);
  }
  window.addEventListener('resize', () => visible && measure());

  /** Proyecta un punto de mundo a píxeles de pantalla (en `projected`) */
  function toScreen(point, camera) {
    projected.copy(point).project(camera);
    projected.x = (projected.x * 0.5 + 0.5) * window.innerWidth;
    projected.y = (-projected.y * 0.5 + 0.5) * window.innerHeight;
    return projected;
  }

  return {
    /**
     * @param outline       contorno en el plano tangente (fracciones del radio del cuerpo)
     * @param realRadiusKm  radio real del cuerpo, para la barra de escala
     * @param labels        { kicker, tag }: textos superiores izquierdo y derecho
     * @param morph         opcional { target, similarity }: contorno del terreno comparado y
     *                      similitud (0–1). La forma se adapta hacia `target` en esa proporción
     *                      (100 % = misma forma) y `target` se dibuja como fantasma discontinuo.
     */
    show(region, outline, realRadiusKm, { kicker, tag }, morph = null) {
      stopMorph();
      // Contorno normalizado al recuadro [-1, 1] (x = este, y = norte → y de SVG invertida)
      const { extent, points } = normalizeOutline(outline);
      if (morph?.target) {
        const own = polarProfile(points, MORPH.samples);
        const goal = polarProfile(normalizeOutline(morph.target).points, MORPH.samples);
        dom.target.setAttribute('points', profileToPoints(goal, goal, 0));
        dom.target.style.display = '';
        startMorph(own, goal, morph.similarity);
      } else {
        dom.target.style.display = 'none';
        dom.shape.setAttribute('points', points.map((p) => `${p.x.toFixed(3)},${(-p.y).toFixed(3)}`).join(' '));
      }

      // Escala: 1 unidad del dibujo = extent · radio real (km)
      const kmPerUnit = extent * realRadiusKm;
      const barKm = niceLength(kmPerUnit * 2);
      dom.scaleBar.style.width = `${((barKm / kmPerUnit / VIEW.size) * 100).toFixed(2)}%`;
      dom.scaleLabel.textContent = `${barKm} km`;

      dom.kicker.textContent = kicker;
      dom.tag.textContent = tag;
      dom.name.textContent = region.name;

      visible = true;
      dom.card.classList.remove('is-hidden');
      dom.beam.classList.remove('is-hidden');
      measure();
    },

    hide() {
      stopMorph();
      visible = false;
      dom.card.classList.add('is-hidden');
      dom.beam.classList.add('is-hidden');
    },

    /**
     * Coloca la tarjeta a la derecha del cuerpo (centrada en vertical con él) y tiende el haz
     * desde el área. `camera.matrixWorld` debe estar al día en este fotograma.
     */
    update(camera, bodyCenter, bodyRadius, areaPosition) {
      if (!visible) return;
      const width = window.innerWidth;
      const height = window.innerHeight;

      // Radio aparente: proyecta un punto del borde según el eje derecho de la cámara
      edgePoint.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(bodyRadius).add(bodyCenter);
      const edgeX = toScreen(edgePoint, camera).x;
      const { x: cx, y: cy } = toScreen(bodyCenter, camera);
      const radiusPx = Math.abs(edgeX - cx);

      const gap = Math.max(LAYOUT.gapMin, width * LAYOUT.gapFraction);
      const left = Math.min(cx + radiusPx + gap, width - size - LAYOUT.margin);
      const top = THREE.MathUtils.clamp(cy - size / 2, LAYOUT.margin, height - size - LAYOUT.margin);
      dom.card.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;

      // El haz solo sale del área si está en la cara visible
      areaNormal.subVectors(areaPosition, bodyCenter);
      toCamera.subVectors(camera.position, bodyCenter);
      dom.beam.classList.toggle('is-occluded', areaNormal.dot(toCamera) < bodyRadius * bodyRadius);

      const { x: ox, y: oy } = toScreen(areaPosition, camera);
      const origin = `${ox.toFixed(1)},${oy.toFixed(1)}`;
      const upper = `${left.toFixed(1)},${(top + size * 0.12).toFixed(1)}`;
      const lower = `${left.toFixed(1)},${(top + size * 0.88).toFixed(1)}`;
      dom.beamShape.setAttribute('points', `${origin} ${upper} ${lower}`);
      dom.beamEdges.setAttribute('points', `${upper} ${origin} ${lower}`); // solo los dos lados del cono
    }
  };
}
