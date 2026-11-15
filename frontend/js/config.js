import * as THREE from 'three';

const deg = THREE.MathUtils.degToRad;

/**
 * Dimensiones y posiciones fijas de cada cuerpo (unidades de escena: radio terrestre = 2).
 * `flightSafeRadius` es la esfera que el vuelo de cámara nunca atraviesa (incluye atmósferas).
 */
export const EARTH = {
  radius: 2.0,
  realRadiusKm: 6371, // para la escala de los hologramas
  cloudsRadius: 2.028,
  atmosphereRadius: 2.16,
  axialTilt: deg(23.44),
  flightSafeRadius: 2.5
};

const MOON_RADIUS = EARTH.radius * 0.273;
const MARS_RADIUS = EARTH.radius * 0.532;

/**
 * Vista de una misión: cuerpo más pequeño (cámara a `distance` del centro), desplazado a la
 * izquierda y hacia arriba (`viewShift` [x, y], fracciones del ancho/alto) para dejar sitio
 * a los hologramas y a la Tierra debajo. `faceCamera` gira el área hacia la cámara
 * (0 = de perfil en el borde derecho, mayor = más de frente).
 * `earth`: Tierra en miniatura (no a escala) bajo el cuerpo; `drop` es la separación vertical
 * entre centros como fracción de `distance` (así se mantiene la composición).
 * `soloViewShift`: desplazamiento mientras no se ha entrado en un análogo (sin Tierra debajo,
 * el cuerpo queda centrado en vertical). `soloDistanceScale` < 1 acerca entonces la cámara para
 * que se vea más grande; al entrar en un análogo vuelve a `distance`.
 *
 * Las distancias están pensadas para la Luna; `scale` las ajusta al radio de otro cuerpo para
 * que ocupe lo mismo en pantalla.
 */
const missionView = (scale = 1) => ({
  distance: 4.6 * scale,
  viewShift: [0.03, 0.2],
  soloViewShift: [0.03, 0],
  soloDistanceScale: 0.75,
  faceCamera: 0.55,
  earth: { radius: 0.62 * scale, drop: 0.37 }
});

export const MOON = {
  radius: MOON_RADIUS,
  realRadiusKm: 1737.4, // para convertir km de superficie a unidades de escena
  distance: 7.6,
  angle: 0.65,
  orbitInclination: deg(5.14),
  axialTilt: deg(6.68),
  flightSafeRadius: MOON_RADIUS * 1.5,
  missionView: missionView()
};

export const MARS = {
  radius: MARS_RADIUS,
  atmosphereRadius: MARS_RADIUS * 1.055,
  distanceX: 16.5,
  distanceZ: 15.6,
  // Detrás de la Luna (misma dirección desde la Tierra): vuelos Luna → Marte sin giros bruscos
  angle: 0.9,
  orbitInclination: deg(1.85),
  orbitTiltX: deg(-1.4),
  axialTilt: deg(25.19),
  flightSafeRadius: MARS_RADIUS * 1.4,
  realRadiusKm: 3389.5,
  missionView: missionView(MARS_RADIUS / MOON_RADIUS)
};

export const SATELLITE = {
  distance: 3.2,
  angle: -0.9,
  orbitInclination: deg(28.5),
  scale: 0.034, // el modelo se construye en unidades locales (~12.5 de envergadura)
  flightSafeRadius: 0.3
};

/**
 * Cápsula tipo Orión en órbita baja terrestre (inclinación 51.6°, la de la ISS).
 * `pose` inclina la nave respecto a la cámara (rad).
 */
export const ORION = {
  distance: 2.95,
  angle: 1.1,
  orbitInclination: deg(51.6),
  scale: 0.017, // el modelo se construye en ~metros (~19 de envergadura)
  pose: { pitch: -0.12, roll: -0.18 },
  flightSafeRadius: 0.22
};

/**
 * Rover, panel solar y antena flotando juntos en la misma órbita baja terrestre: solo los separa
 * `angle` (≈ 0.4 unidades de escena entre cada uno), para poder usarlos juntos más adelante.
 */
const SPACE_PAIR = { distance: 3.1, angle: -2.2, orbitInclination: deg(20) };

/**
 * Rover de seis ruedas a la deriva (el modelo se construye en ~metros, ~2.4 de envergadura).
 * Gira despacio sobre sí mismo (`spin`, rad/s por eje) y el cabezal del mástil barre a los lados.
 */
export const ROVER = {
  distance: SPACE_PAIR.distance,
  angle: SPACE_PAIR.angle,
  orbitInclination: SPACE_PAIR.orbitInclination,
  scale: 0.07,
  spin: { x: 0.012, y: 0.025 },
  mastPanSpeed: 0.35, // rad/s del barrido del cabezal
  mastPanAngle: 0.6, // amplitud del barrido (rad)
  flightSafeRadius: 0.16
};

/**
 * Antena de espacio profundo (misión de percepción), al otro lado del rover: reflector de ~10 m
 * que barre muy despacio (`scanSpeed`, rad/s) alrededor de `elevation`
 */
export const ANTENNA = {
  distance: SPACE_PAIR.distance,
  angle: SPACE_PAIR.angle + 0.13,
  orbitInclination: SPACE_PAIR.orbitInclination,
  scale: 0.026,
  elevation: deg(40),
  scanSpeed: 0.08,
  azimuthSweep: 0.5,
  elevationSweep: 0.12,
  flightSafeRadius: 0.22
};

/**
 * Panel solar suelto: mástil de celosía con dos mantas de celdas (~10 × 9 m) que siguen la luz
 */
export const SOLAR_PANEL = {
  distance: SPACE_PAIR.distance,
  angle: SPACE_PAIR.angle - 0.13,
  orbitInclination: SPACE_PAIR.orbitInclination,
  scale: 0.03,
  flightSafeRadius: 0.2
};

/**
 * Campo de visión vertical (grados). En la vista de misión se estrecha y la cámara se aleja en
 * la misma proporción: los cuerpos ocupan lo mismo en pantalla, pero los que quedan lejos del
 * centro (Tierra en miniatura abajo a la izquierda) ya no se ven ovalados por la perspectiva.
 */
export const CAMERA = {
  fov: 45,
  missionFov: 22,
  fovSpeed: 3.5, // rapidez de la transición entre ambos
  missionZoomSpeed: 3.5 // rapidez del acercamiento al entrar o salir de un análogo
};

/** Factor de distancia que mantiene el tamaño en pantalla al pasar de `CAMERA.fov` a `fov` */
export const distanceForFov = (fov) =>
  Math.tan(deg(CAMERA.fov) / 2) / Math.tan(deg(fov) / 2);

/**
 * Menú principal: la vista se desplaza horizontalmente (fracción del ancho) para dejar
 * Orión a la derecha y el menú a la izquierda. En pantallas estrechas no se desplaza.
 */
export const MENU = {
  viewShift: 0.22,
  missionsViewShift: 0.08, // lista de misiones (Luna/Marte): separa el cuerpo de las tarjetas
  minWidthForShift: 700, // px
  shiftSpeed: 4, // velocidad de la transición del desplazamiento
  /**
   * Recorrido automático de fondo: en cada parada la cámara gira muy despacio, siempre
   * hacia la derecha, durante `hold` segundos y luego vuela a la siguiente.
   * `distanceScale` < 1 acerca la cámara respecto a la vista normal del cuerpo.
   */
  tour: {
    stops: [
      { body: 'orion', hold: 5 },
      { body: 'moon', hold: 5, distanceScale: 0.8 },
      { body: 'mars', hold: 5, distanceScale: 0.8 },
      { body: 'rover', hold: 5 },
      { body: 'antenna', hold: 5 },
      { body: 'solarPanel', hold: 5 }
    ],
    driftSpeed: 0.012 // rad/s (≈ 0.7°/s) de giro alrededor del cuerpo
  }
};

/** Rotación sobre su propio eje (rad/s a velocidad 1x) */
export const ROTATION = {
  baseSpeed: 0.08, // rad/s
  cloudsFactor: 1.35, // las nubes avanzan algo más rápido que la superficie
  starfieldSpeed: 0.0018
};

/**
 * Luz que acompaña a la cámara: llega desde el punto de vista, ligeramente desplazada
 * hacia arriba-izquierda para conservar volumen y relieve en los planetas
 */
export const HEADLIGHT = {
  offset: new THREE.Vector3(-0.35, 0.3, 1).normalize(),
  distance: 40
};

/** Vuelo de cámara entre cuerpos */
export const FLIGHT = {
  minDuration: 0.8, // segundos (trayectos cortos)
  maxDuration: 1.6, // segundos (trayectos largos, p. ej. Tierra → Marte)
  durationPerUnit: 0.035,
  arcPerUnit: 0.08,
  maxArc: 1.5
};

/**
 * Texturas fotográficas (NASA Blue Marble / LRO-Clementine / Viking).
 * `local`: versión 4K servida desde frontend/textures; `fallback`: CDN de menor resolución
 * (se usa si la local no está disponible, p. ej. sin servidor).
 */
const THREE_CDN = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r164/examples/textures/planets/';
const PLANETS_CDN = 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/';
// Relativa a este módulo, así no depende de dónde esté index.html
const LOCAL = new URL('../textures/', import.meta.url).href;

export const PHOTO_TEXTURES = {
  earthDay: { local: LOCAL + 'earth_day_4k.webp', fallback: THREE_CDN + 'earth_atmos_2048.jpg' },
  earthSpecular: { local: LOCAL + 'earth_specular_2k.webp', fallback: THREE_CDN + 'earth_specular_2048.jpg' },
  earthNormal: { local: LOCAL + 'earth_normal_2k.webp', fallback: THREE_CDN + 'earth_normal_2048.jpg' },
  // Local: escala de grises usada como transparencia; respaldo: PNG a color con alfa propio
  earthClouds: { local: LOCAL + 'earth_clouds_4k.webp', fallback: THREE_CDN + 'earth_clouds_1024.png' },
  moonColor: { local: LOCAL + 'moon_4k.webp', fallback: PLANETS_CDN + 'moonmap1k.jpg' },
  moonBump: { local: LOCAL + 'moon_bump_2k.webp', fallback: PLANETS_CDN + 'moonbump1k.jpg' },
  marsColor: { local: LOCAL + 'mars_4k.webp', fallback: PLANETS_CDN + 'marsmap1k.jpg' },
  marsBump: { local: LOCAL + 'mars_bump_1k.webp', fallback: PLANETS_CDN + 'marsbump1k.jpg' }
};

/**
 * Backend de análogos (`GET /api/analog`, en backend/main.go): es la única fuente de los análogos,
 * el front no los calcula. En local apunta al servidor de Go en el puerto 8080; en producción, a
 * `/api/analog` del mismo dominio (cambiar `url` si el backend se publica en otro).
 * Si la petición falla o tarda más de `timeoutMs`, el panel ofrece reintentar.
 */
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const API_BASE = IS_LOCAL ? 'http://localhost:8080' : '';
export const ANALOGS_API = {
  url: `${API_BASE}/api/analog`,
  timeoutMs: 8000
};

/** Terrenos de la Luna o Marte ordenados para una misión (`GET /api/regions`, en backend/regions.go) */
export const REGIONS_API = {
  url: `${API_BASE}/api/regions`,
  timeoutMs: 8000
};

/** Análogos de los datos propios del usuario (`POST /api/analog/custom`, en backend/custom.go) */
export const CUSTOM_ANALOGS_API = {
  url: `${API_BASE}/api/analog/custom`,
  timeoutMs: 12000
};

/**
 * Misiones del panel de terrenos: `id` es el `filter` de `GET /api/regions` y de `GET /api/analog`
 * (perfiles de backend/knn/mission.go); '' = misión libre: todos los terrenos y todas las variables
 * pesan igual. Primero se elige la misión con una tarjeta (`card`, en este orden) y luego se ven
 * sus terrenos. `showcase` es lo que se ve al pasar por su tarjeta: 'body' = el planeta enfocado,
 * 'rover' | 'antenna' | 'solarPanel' = ese objeto solo sobre el espacio; null = nada.
 */
export const MISSION_FILTERS = [
  { id: '', label: 'All', card: 'Free mission', title: 'All terrains: every variable weighs the same', showcase: 'body' },
  { id: 'mobility', label: 'Mobility', card: 'Mobility mission', title: 'Slope, rocks and soil mechanics: traversing the terrain', showcase: 'rover' },
  { id: 'perception', label: 'Perception', card: 'Perception mission', title: 'Line of sight, texture, shadows and illumination: navigation', showcase: 'antenna' },
  { id: 'environmental_survival', label: 'Survival', card: 'Survival mission', title: 'Thermal cycle, energy, pressure and wind: environmental survival', showcase: 'solarPanel' },
];

/**
 * Al pasar por una tarjeta de misión la cámara vuela hasta su objeto; `objectDistanceScale` escala
 * la distancia de su vista normal (> 1 = más lejos: se ve el objeto con el planeta de fondo).
 * Para que el viaje sea corto, al elegir misión el rover, la antena y el panel pasan a orbitar el
 * planeta elegido, como el satélite y Orión con la Tierra: en una órbita circular a `orbitRadius`
 * radios de su centro, casi de frente a la cámara (inclinada `orbitTilt` hacia ella) y repartidos
 * en `orbitAngles` (rad; 0 = a la derecha del planeta en pantalla, π/2 = arriba, -π/2 = abajo),
 * del lado contrario a la lista de tarjetas. `objectScale` encoge los objetos según el planeta
 * (en la Tierra miden 1) y la vista se acerca en la misma proporción. Al volver al menú
 * regresan a su órbita terrestre.
 */
export const MISSION_PREVIEW = {
  objectDistanceScale: 1.7,
  orbitRadius: 1.75,
  orbitTilt: deg(25),
  orbitAngles: { rover: deg(38), solarPanel: deg(0), antenna: deg(-38) },
  objectScale: { moon: 0.55, mars: 0.8 }
};
