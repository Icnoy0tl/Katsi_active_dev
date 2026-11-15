import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EARTH, MARS, MENU, MOON, ORION, ROTATION, SATELLITE } from './config.js';
import { state } from './state.js';
import { createLighting } from './lighting.js';
import { createStarfield } from './bodies/starfield.js';
import { createEarth } from './bodies/earth.js';
import { createMoon } from './bodies/moon.js';
import { createMars } from './bodies/mars.js';
import { createSatellite } from './satellite/satellite.js';
import { createOrion } from './orion/orion.js';
import { createCameraNavigator } from './camera.js';
import { loadPhotoTextures } from './textures/photo.js';
import { setupControlPanel } from './ui.js';
import { setupMainMenu } from './menu.js';
import { createMenuTour } from './menuTour.js';
import { setupMissionsPanel } from './missions.js';
import { setupMissionInfo } from './missionInfo.js';
import { createHologram } from './hologram.js';
import { findClosestAnalog } from './analogs.js';
import { createEarthMiniature } from './bodies/earthMiniature.js';
import { createTerrainMarkers, loadRegions, setupMarkerTooltip } from './bodies/terrainMarkers.js';

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
const orion = createOrion({ renderer, anisotropy });
scene.add(starfield, earth.group, moon.group, mars.group, satellite.group, orion.group);

// --- Navegación (arranca directamente en la Tierra, sin vista general) ---
const cameraNavigator = createCameraNavigator({
  camera,
  controls,
  bodies: { earth: earth.group, moon: moon.mesh, mars: mars.anchor, satellite: satellite.model, orion: orion.model },
  obstacles: [
    { object: earth.surface, safeRadius: EARTH.flightSafeRadius },
    { object: moon.mesh, safeRadius: MOON.flightSafeRadius },
    { object: mars.mesh, safeRadius: MARS.flightSafeRadius },
    { object: satellite.model, safeRadius: SATELLITE.flightSafeRadius },
    { object: orion.model, safeRadius: ORION.flightSafeRadius }
  ]
});
// La cara frontal de Orión ("NASA") mira hacia donde se coloca la cámara al enfocarla
orion.faceTowards(cameraNavigator.viewPosition('orion'));
cameraNavigator.focus('orion', true);

/**
 * Cuerpos con misiones (regiones de backend/data): al enfocarlos aparece su panel de misiones.
 * `regions` y `markers` se rellenan al cargar los JSON.
 */
const missionBodies = {
  moon: { group: moon.group, mesh: moon.mesh, config: MOON, kicker: 'Terreno lunar', regions: null, markers: null },
  mars: { group: mars.group, mesh: mars.mesh, config: MARS, kicker: 'Terreno marciano', regions: null, markers: null }
};
const regionBody = new Map(); // regionId → nombre del cuerpo ('moon' | 'mars')

// Panel de misiones: visible solo mientras se enfoca un cuerpo con misiones ya cargadas
const missionsPanel = setupMissionsPanel({ onSelect: (region) => goToMission(region) });
function updateMissionsPanel(name) {
  const regions = missionBodies[name]?.regions;
  if (regions) missionsPanel.show(regions);
  else missionsPanel.hide();
}

const missionVignette = document.getElementById('mission-vignette');
const hologramsContainer = document.getElementById('holograms');
const bodyHologram = createHologram({ container: hologramsContainer, id: 'holo-body' });
const earthHologram = createHologram({ container: hologramsContainer, id: 'holo-earth' });
const missionInfo = setupMissionInfo();

// En la vista de misión, "Volver al menú" se sustituye por "Volver a misiones"
const openMenuButton = document.getElementById('open-menu-btn');
const backToMissionsButton = document.getElementById('back-to-missions-btn');
backToMissionsButton.addEventListener('click', () => controlPanel.focus(missionBodyName));
function setMissionButtons(inMission) {
  openMenuButton.classList.toggle('is-replaced', inMission);
  backToMissionsButton.classList.toggle('is-hidden', !inMission);
}
let missionBodyName = null; // cuerpo de la misión abierta ('moon' | 'mars')
let selectedRegionId = null; // misión mostrada en el holograma
let analogRegionId = null; // su análogo terrestre

// Tierra en miniatura bajo el cuerpo durante la vista de misión (su tamaño depende del cuerpo)
const earthMini = createEarthMiniature({ earth, radius: MOON.missionView.earth.radius });
scene.add(earthMini.group);

// Cuerpos de la escena: en la vista de misión solo queda visible el de la misión
const sceneBodies = [earth.group, moon.group, mars.group, satellite.group, orion.group];

/**
 * Vista de misión = tablero de análisis fijo: sin girar ni hacer zoom y sin el resto de
 * cuerpos (la Tierra real podía asomar detrás de la miniatura)
 */
function setAnalysisMode(active, keepVisible = null) {
  sceneBodies.forEach((body) => (body.visible = !active || body === keepVisible));
  setMissionButtons(active);
  controls.enabled = !active && !mainMenu.isOpen;
}

/** Sale de la vista de misión (cualquier cambio de enfoque la cierra) */
function closeMission() {
  if (!selectedRegionId) return;
  setAnalysisMode(false);
  missionBodyName = null;
  selectedRegionId = null;
  analogRegionId = null;
  missionInfo.hide();
  bodyHologram.hide();
  earthHologram.hide();
  earthMini.group.visible = false;
  missionVignette.classList.remove('is-visible');
  if (!mainMenu.isOpen) setViewShiftTarget(0, 0);
}

const controlPanel = setupControlPanel({
  cameraNavigator,
  onFocus: (name) => {
    closeMission();
    updateMissionsPanel(name);
  },
  onToggleClouds: (visible) => {
    earth.clouds.visible = visible;
  },
  onToggleAtmosphere: (visible) => {
    earth.atmosphere.visible = visible;
    mars.atmosphere.visible = visible;
  }
});

// --- Menú principal: Orión de fondo, vista desplazada a la derecha ---
// Desplazamiento de la vista (fracciones del ancho/alto): x > 0 mueve la escena a la derecha, y > 0 hacia arriba
const viewShift = { x: 0, y: 0, targetX: 0, targetY: 0 };
const setViewShiftTarget = (x, y) => {
  viewShift.targetX = x;
  viewShift.targetY = y;
};
const menuTour = createMenuTour({ camera, controls, cameraNavigator, focus: controlPanel.focus });

function applyViewShift() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (Math.abs(viewShift.x) < 1e-4 && Math.abs(viewShift.y) < 1e-4) {
    camera.clearViewOffset();
  } else {
    camera.setViewOffset(width, height, -viewShift.x * width, viewShift.y * height, width, height);
  }
}

const menuTarget = () => (window.innerWidth >= MENU.minWidthForShift ? MENU.viewShift : 0);

const leaveMenuTo = (name) => () => {
  mainMenu.close();
  controlPanel.focus(name);
};

const mainMenu = setupMainMenu({
  actions: {
    moon: leaveMenuTo('moon'),
    mars: leaveMenuTo('mars'),
    docs: () => {
      // TODO: pantalla de documentación
    },
    test: leaveMenuTo('earth')
  },
  onToggle: (isOpen) => {
    // En el menú la escena es solo fondo: sin arrastre ni zoom
    controls.enabled = !isOpen;
    setViewShiftTarget(isOpen ? menuTarget() : 0, 0);
    if (isOpen) menuTour.reset();
  }
});
viewShift.x = viewShift.targetX; // sin transición en la carga inicial
applyViewShift();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  if (mainMenu.isOpen) viewShift.targetX = menuTarget();
  applyViewShift(); // también actualiza la proyección
  camera.updateProjectionMatrix();
});

loadPhotoTextures({ anisotropy, earth, moon, mars });

// --- Áreas de terreno de cada misión (coordenadas lat/lon de cada región) ---
const bodyCenter = new THREE.Vector3();
const missionArea = new THREE.Vector3();
const analogArea = new THREE.Vector3();
const missionViewDir = new THREE.Vector3();
const areaNormal = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Dirección desde la que mirar el cuerpo para que el área quede en su borde derecho, algo girada
 * hacia la cámara: así el haz sale hacia el holograma. Cerca de los polos (sin "derecha" útil)
 * se conserva el lado desde el que ya se mira.
 */
function missionViewDirection(mission, areaPosition) {
  mission.mesh.getWorldPosition(bodyCenter);
  areaNormal.subVectors(areaPosition, bodyCenter).normalize();
  missionViewDir.crossVectors(areaNormal, UP);
  if (missionViewDir.lengthSq() < 0.04) {
    missionViewDir.subVectors(camera.position, bodyCenter).setY(0);
  }
  return missionViewDir.normalize().addScaledVector(areaNormal, mission.config.missionView.faceCamera).normalize();
}

let earthRegions = null;
let earthMarkers = null;
let analogFrame = null; // base local del área del análogo en la miniatura

/**
 * Misma acción desde una tarjeta del panel o al hacer clic en un área del cuerpo:
 * información a la izquierda, cuerpo más pequeño y holograma del terreno a su derecha,
 * con la Tierra en miniatura y su análogo debajo
 */
function goToMission(region) {
  const name = regionBody.get(region.regionId);
  const mission = missionBodies[name];
  if (!mission) return;
  const view = mission.config.missionView;

  // Se pausa la rotación para que el área no se escape del haz
  controlPanel.setRotating(false);
  controlPanel.focus(name); // cierra la misión anterior; la nueva se abre después
  missionsPanel.hide();

  missionBodyName = name;
  selectedRegionId = region.regionId;
  const analog = findClosestAnalog(region, earthRegions);
  missionInfo.show(region, analog);
  bodyHologram.show(region, mission.markers.outline(region.regionId), mission.config.realRadiusKm, {
    kicker: mission.kicker,
    tag: region.regionId
  });

  // Análogo terrestre: solo su área en la miniatura, con su propio holograma
  if (analog) {
    analogRegionId = analog.region.regionId;
    analogFrame = earthMarkers.localFrame(analogRegionId);
    earthMarkers.showOnly(analogRegionId);
    earthMini.setRadius(view.earth.radius);
    earthMini.group.visible = true;
    earthHologram.show(analog.region, earthMarkers.outline(analogRegionId), EARTH.realRadiusKm, {
      kicker: `Análogo terrestre · ${analogRegionId}`,
      tag: `${Math.round(analog.similarity * 100)}\u00a0%` // espacio sin salto: "59 %" no se parte
    });
  }

  missionVignette.classList.add('is-visible');
  setViewShiftTarget(...view.viewShift);
  setAnalysisMode(true, mission.group);

  mission.markers.worldPosition(region.regionId, missionArea);
  cameraNavigator.focusFrom(name, missionViewDirection(mission, missionArea), view.distance);
}

Promise.all(['moon', 'mars', 'earth'].map((name) => loadRegions(`./backend/data/${name}.json`)))
  .then(([moonRegions, marsRegions, terrestrialRegions]) => {
    earthRegions = terrestrialRegions;
    earthMarkers = createTerrainMarkers({ body: earthMini.surface, radius: earthMini.areaRadius, regions: earthRegions });

    Object.entries({ moon: moonRegions, mars: marsRegions }).forEach(([name, regions]) => {
      const mission = missionBodies[name];
      mission.regions = regions;
      mission.markers = createTerrainMarkers({ body: mission.mesh, radius: mission.config.radius, regions });
      regions.forEach((region) => regionBody.set(region.regionId, name));
    });

    setupMarkerTooltip({
      camera,
      domElement: renderer.domElement,
      markerSets: [missionBodies.moon.markers, missionBodies.mars.markers],
      occluders: [moon.mesh, mars.mesh],
      onSelect: goToMission
    });
    updateMissionsPanel(cameraNavigator.currentFocus);
  })
  .catch((err) => console.warn('No se pudieron cargar los terrenos de backend/data.', err));

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

  // Transición suave del desplazamiento de vista (menú y vista de misión)
  if (viewShift.x !== viewShift.targetX || viewShift.y !== viewShift.targetY) {
    const ease = Math.min(1, MENU.shiftSpeed * delta);
    const stepX = viewShift.targetX - viewShift.x;
    const stepY = viewShift.targetY - viewShift.y;
    viewShift.x = Math.abs(stepX) < 1e-4 ? viewShift.targetX : viewShift.x + stepX * ease;
    viewShift.y = Math.abs(stepY) < 1e-4 ? viewShift.targetY : viewShift.y + stepY * ease;
    applyViewShift();
  }

  cameraNavigator.update(delta);
  if (mainMenu.isOpen) menuTour.update(delta);
  starfield.rotation.y += ROTATION.starfieldSpeed * delta;

  controls.update();
  lighting.update(camera, controls.target);
  satellite.update(delta, clock.elapsedTime, lighting.direction);
  orion.update(delta, lighting.direction);
  if (selectedRegionId) {
    const mission = missionBodies[missionBodyName];
    const view = mission.config.missionView;
    camera.updateMatrixWorld(); // OrbitControls ya movió la cámara en este fotograma
    mission.mesh.getWorldPosition(bodyCenter);
    mission.markers.worldPosition(selectedRegionId, missionArea);
    bodyHologram.update(camera, bodyCenter, mission.config.radius, missionArea);

    if (analogRegionId) {
      // Separación cuerpo → Tierra proporcional a la distancia de la vista (mantiene la composición)
      earthMini.place(camera, bodyCenter, view.earth.drop * view.distance, analogFrame, view.faceCamera);
      earthMarkers.worldPosition(analogRegionId, analogArea);
      earthHologram.update(camera, earthMini.group.position, earthMini.radius, analogArea);
    }
  }

  renderer.render(scene, camera);
});
