import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EARTH, MARS, MOON, ROTATION, SATELLITE } from './config.js';
import { state } from './state.js';
import { createLighting } from './lighting.js';
import { createStarfield } from './bodies/starfield.js';
import { createEarth } from './bodies/earth.js';
import { createMoon } from './bodies/moon.js';
import { createMars } from './bodies/mars.js';
import { createSatellite } from './satellite/satellite.js';
import { createCameraNavigator } from './camera.js';
import { loadPhotoTextures } from './textures/photo.js';
import { setupControlPanel } from './ui.js';

// --- Renderizador, escena, cámara y controles ---
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.getElementById('canvas-container').appendChild(renderer.domElement);
const anisotropy = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070c);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.rotateSpeed = 0.65;
controls.zoomSpeed = 0.85;
controls.enablePan = false;

// --- Contenido de la escena ---
const lighting = createLighting(scene);
const lightDirectionUniform = lighting.directionUniform;

const starfield = createStarfield();
const earth = createEarth({ anisotropy, lightDirectionUniform });
const moon = createMoon({ anisotropy });
const mars = createMars({ anisotropy, lightDirectionUniform });
const satellite = createSatellite({ renderer, anisotropy });
scene.add(starfield, earth.group, moon.group, mars.group, satellite.group);

// --- Navegación (arranca directamente en la Tierra, sin vista general) ---
const cameraNavigator = createCameraNavigator({
  camera,
  controls,
  bodies: { earth: earth.group, moon: moon.mesh, mars: mars.anchor, satellite: satellite.model },
  obstacles: [
    { object: earth.surface, safeRadius: EARTH.flightSafeRadius },
    { object: moon.mesh, safeRadius: MOON.flightSafeRadius },
    { object: mars.mesh, safeRadius: MARS.flightSafeRadius },
    { object: satellite.model, safeRadius: SATELLITE.flightSafeRadius }
  ]
});
cameraNavigator.focus('earth', true);

setupControlPanel({
  cameraNavigator,
  onToggleClouds: (visible) => {
    earth.clouds.visible = visible;
  },
  onToggleAtmosphere: (visible) => {
    earth.atmosphere.visible = visible;
    mars.atmosphere.visible = visible;
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

loadPhotoTextures({ anisotropy, earth, moon, mars });

// --- Bucle principal ---
const clock = new THREE.Clock();
const spinningBodies = [earth.surface, moon.mesh, mars.mesh];

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();

  // Solo rotación sobre su propio eje, a la misma velocidad para todos (los cuerpos no se trasladan)
  if (state.isRotating) {
    const spin = ROTATION.baseSpeed * state.rotationSpeed * delta;
    spinningBodies.forEach((body) => {
      body.rotation.y += spin;
    });
    earth.clouds.rotation.y += spin * ROTATION.cloudsFactor;
  }

  cameraNavigator.update(delta);
  starfield.rotation.y += ROTATION.starfieldSpeed * delta;

  controls.update();
  lighting.update(camera, controls.target);
  satellite.update(delta, clock.elapsedTime, lighting.direction);

  renderer.render(scene, camera);
});
