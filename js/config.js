import * as THREE from 'three';

const deg = THREE.MathUtils.degToRad;

/**
 * Dimensiones y posiciones fijas de cada cuerpo (unidades de escena: radio terrestre = 2).
 * `flightSafeRadius` es la esfera que el vuelo de cámara nunca atraviesa (incluye atmósferas).
 */
export const EARTH = {
  radius: 2.0,
  cloudsRadius: 2.028,
  atmosphereRadius: 2.16,
  axialTilt: deg(23.44),
  flightSafeRadius: 2.5
};

const MOON_RADIUS = EARTH.radius * 0.273;
export const MOON = {
  radius: MOON_RADIUS,
  distance: 7.6,
  angle: 0.65,
  orbitInclination: deg(5.14),
  axialTilt: deg(6.68),
  flightSafeRadius: MOON_RADIUS * 1.5
};

const MARS_RADIUS = EARTH.radius * 0.532;
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
  flightSafeRadius: MARS_RADIUS * 1.4
};

export const SATELLITE = {
  distance: 2.95,
  angle: 1.1,
  orbitInclination: deg(51.6),
  scale: 0.034, // el modelo se construye en unidades locales (~12.5 de envergadura)
  flightSafeRadius: 0.3
};

/** Rotación sobre su propio eje (rad/s a velocidad 1x) */
export const ROTATION = {
  baseSpeed: 0.16,
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
 * `local`: versión 4K servida desde ./textures; `fallback`: CDN de menor resolución
 * (se usa si la local no está disponible, p. ej. sin servidor).
 */
const THREE_CDN = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r164/examples/textures/planets/';
const PLANETS_CDN = 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/';
const LOCAL = './textures/';

export const PHOTO_TEXTURES = {
  earthDay: { local: LOCAL + 'earth_day_4k.jpg', fallback: THREE_CDN + 'earth_atmos_2048.jpg' },
  earthSpecular: { local: LOCAL + 'earth_specular_2k.jpg', fallback: THREE_CDN + 'earth_specular_2048.jpg' },
  earthNormal: { local: LOCAL + 'earth_normal_2k.jpg', fallback: THREE_CDN + 'earth_normal_2048.jpg' },
  // Local: escala de grises usada como transparencia; respaldo: PNG a color con alfa propio
  earthClouds: { local: LOCAL + 'earth_clouds_4k.jpg', fallback: THREE_CDN + 'earth_clouds_1024.png' },
  moonColor: { local: LOCAL + 'moon_4k.jpg', fallback: PLANETS_CDN + 'moonmap1k.jpg' },
  moonBump: { local: LOCAL + 'moon_bump_2k.jpg', fallback: PLANETS_CDN + 'moonbump1k.jpg' },
  marsColor: { local: LOCAL + 'mars_4k.jpg', fallback: PLANETS_CDN + 'marsmap1k.jpg' },
  marsBump: { local: LOCAL + 'mars_bump_1k.jpg', fallback: PLANETS_CDN + 'marsbump1k.jpg' }
};
