import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA, EARTH, MARS, MENU, MOON, ORION, ROTATION, ANTENNA, MISSION_PREVIEW, ROVER, SATELLITE, SOLAR_PANEL, distanceForFov } from './config.js';
import { createLighting } from './lighting.js';
import { createStarfield } from './bodies/starfield.js';
import { createEarth } from './bodies/earth.js';
import { createMoon } from './bodies/moon.js';
import { createMars } from './bodies/mars.js';
import { createSatellite } from './satellite/satellite.js';
import { createOrion } from './orion/orion.js';
import { createRover } from './rover/rover.js';
import { createSolarPanel } from './solarPanel/solarPanel.js';
import { createAntenna } from './antenna/antenna.js';
import { createCameraNavigator } from './camera.js';
import { loadPhotoTextures } from './textures/photo.js';
import { setupMainMenu } from './menu.js';
import { createMenuTour } from './menuTour.js';
import { setupApiPanel } from './apiPanel.js';
import { setupMissionsPanel } from './missions.js';
import { setupMissionInfo } from './missionInfo.js';
import { createHologram } from './hologram.js';
import { fetchClosestAnalogs, fetchMissionRegions, fetchSavedRegionAnalogs, rankSavedRegions } from './analogs.js';
import { customRegions } from './customRegions.js';
import { createEarthMiniature } from './bodies/earthMiniature.js';
import { createTerrainMarkers, loadRegions, setupMarkerTooltip } from './bodies/terrainMarkers.js';
import { createViewShift, shiftIfWide } from './viewShift.js';
import { approach } from './utils/smoothing.js';

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

const camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 1000);
let targetFov = CAMERA.fov; // se estrecha en la vista de misión (ver CAMERA.missionFov)

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.rotateSpeed = 0.65;
controls.zoomSpeed = 0.85;
controls.enablePan = false;

// --- Contenido de la escena ---
const lighting = createLighting(scene);
const lightDirectionUniform = lighting.directionUniform; // compartido por las atmósferas

const starfield = createStarfield();
const earth = createEarth({ anisotropy, lightDirectionUniform });
const moon = createMoon({ anisotropy });
const mars = createMars({ anisotropy, lightDirectionUniform });
const satellite = createSatellite({ renderer, anisotropy });
const orion = createOrion({ renderer, anisotropy });
// Rover y panel solar flotan juntos en la misma órbita (ver SPACE_PAIR en config.js)
const rover = createRover({ renderer, anisotropy });
const solarPanel = createSolarPanel({ renderer, anisotropy });
const antenna = createAntenna({ renderer, anisotropy });
scene.add(starfield, earth.group, moon.group, mars.group, satellite.group, orion.group, rover.group, solarPanel.group, antenna.group);

// --- Navegación (arranca directamente en la Tierra, sin vista general) ---
const cameraNavigator = createCameraNavigator({
  camera,
  controls,
  bodies: { earth: earth.group, moon: moon.mesh, mars: mars.anchor, satellite: satellite.model, orion: orion.model, rover: rover.model, solarPanel: solarPanel.model, antenna: antenna.model },
  obstacles: [
    { object: earth.surface, safeRadius: EARTH.flightSafeRadius },
    { object: moon.mesh, safeRadius: MOON.flightSafeRadius },
    { object: mars.mesh, safeRadius: MARS.flightSafeRadius },
    { object: satellite.model, safeRadius: SATELLITE.flightSafeRadius },
    { object: orion.model, safeRadius: ORION.flightSafeRadius },
    { object: rover.model, safeRadius: ROVER.flightSafeRadius },
    { object: solarPanel.model, safeRadius: SOLAR_PANEL.flightSafeRadius },
    { object: antenna.model, safeRadius: ANTENNA.flightSafeRadius }
  ]
});
// La cara frontal de Orión ("NASA") mira hacia donde se coloca la cámara al enfocarla
orion.faceTowards(cameraNavigator.viewPosition('orion'));
cameraNavigator.focus('orion', true);

/**
 * Cuerpos con misiones (regiones de backend/data + las propias del usuario): al enfocarlos aparece
 * su panel de misiones. `builtin`, `regions` y `markers` se rellenan al cargar los JSON.
 */
const missionBodies = {
  moon: { group: moon.group, mesh: moon.mesh, config: MOON, kicker: 'Lunar terrain', builtin: null, regions: null, markers: null },
  mars: { group: mars.group, mesh: mars.mesh, config: MARS, kicker: 'Martian terrain', builtin: null, regions: null, markers: null }
};
const regionBody = new Map(); // regionId → nombre del cuerpo ('moon' | 'mars')
const savedByRegion = new Map(); // regionId en el sistema → entrada de customRegions (terrenos propios)

/**
 * Terrenos de cada cuerpo: los de backend/data y, detrás, los que el usuario añadió desde la vista
 * API. Se rehacen las áreas del cuerpo cada vez que cambian. Si un terreno propio repite el id de
 * uno del sistema, se muestra con el sufijo -USER para no pisarlo.
 */
function applyBodyRegions() {
  if (!missionBodies.moon.builtin) return; // aún cargando los JSON
  regionBody.clear();
  savedByRegion.clear();
  Object.entries(missionBodies).forEach(([name, mission]) => {
    const taken = new Set(mission.builtin.map((region) => region.regionId));
    const own = customRegions
      .all()
      .filter((entry) => entry.body === name)
      .map((entry) => {
        const { regionId } = entry.region;
        const region = taken.has(regionId) ? { ...entry.region, regionId: `${regionId}-USER` } : entry.region;
        taken.add(region.regionId);
        savedByRegion.set(region.regionId, entry);
        return region;
      });
    mission.regions = [...mission.builtin, ...own];
    mission.markers?.dispose();
    mission.markers = createTerrainMarkers({ body: mission.mesh, radius: mission.config.radius, regions: mission.regions });
    mission.regions.forEach((region) => regionBody.set(region.regionId, name));
  });
}

/** Id con el que se muestra en el sistema un terreno guardado (ver applyBodyRegions) */
const systemRegionId = (savedId) =>
  [...savedByRegion].find(([, entry]) => entry.region.regionId === savedId)?.[0] ?? null;

// Vista API (satélite): panel derecho para soltar los JSON; desde él se va a un terreno guardado
const apiPanel = setupApiPanel({
  onOpenSaved: (savedId) => {
    const regionId = systemRegionId(savedId);
    const region = missionBodies[regionBody.get(regionId)]?.regions.find((r) => r.regionId === regionId);
    if (region) goToMission(region);
  }
});

const missionsPanel = setupMissionsPanel({
  onSelect: (region) => goToMission(region),
  onFilterChange: () => requestRanking(cameraNavigator.currentFocus),
  onRetry: () => requestRanking(cameraNavigator.currentFocus),
  onPreview: (name) => previewMission(name),
  onChoosingChange: (choosing) => setChoosingMission(choosing)
});

let rankingRequest = 0; // petición de terrenos por misión más reciente (las anteriores se descartan)

/**
 * Filtro de misión del panel de terrenos: sin filtro se ven todos; con uno, el backend calcula
 * qué terrenos del cuerpo sirven para la misión y en qué orden, y en el cuerpo solo quedan sus áreas
 */
function requestRanking(name) {
  const mission = missionBodies[name];
  if (!mission?.regions) return;
  const request = ++rankingRequest;
  const filter = missionsPanel.filter;
  if (!filter) {
    Object.values(missionBodies).forEach((body) => body.markers?.setAllowed(null));
    return;
  }
  // Los terrenos propios no los conoce GET /api/regions: se puntúan aparte y se mezclan
  const own = mission.regions.filter((region) => savedByRegion.has(region.regionId));
  Promise.all([fetchMissionRegions(name, filter, mission.builtin), rankSavedRegions(own, filter)])
    .then(([builtin, saved]) => [...builtin, ...saved].sort((a, b) => b.score - a.score))
    .then((ranked) => {
      if (request !== rankingRequest) return;
      missionsPanel.setRanking(ranked);
      mission.markers.setAllowed(ranked.map(({ region }) => region.regionId));
    })
    .catch((err) => {
      if (request !== rankingRequest) return;
      console.error('Mission ranking unavailable.', err);
      missionsPanel.setRankingError();
      mission.markers.setAllowed(null);
    });
}

function updateMissionsPanel(name) {
  if (name === 'satellite') apiPanel.show();
  else apiPanel.hide();
  const regions = missionBodies[name]?.regions;
  if (regions) {
    missionsPanel.show(regions);
    requestRanking(name); // sin misión (o la libre) solo vuelve a mostrar todas las áreas
  } else missionsPanel.hide();
  // Con la lista de misiones visible, el cuerpo se desplaza a la derecha para no pegarse a ella
  if (!mainMenu.isOpen && !selectedRegionId) viewShift.setTarget(regions ? shiftIfWide(MENU.missionsViewShift) : 0, 0);
}

/** Áreas de terreno: solo en las misiones del cuerpo enfocado, nunca durante el menú */
function updateTerrainAreas(focus, menuOpen) {
  Object.entries(missionBodies).forEach(([name, mission]) => {
    if (mission.markers) mission.markers.group.visible = !menuOpen && focus === name;
  });
}

const missionVignette = document.getElementById('mission-vignette');
const hologramsContainer = document.getElementById('holograms');
const bodyHologram = createHologram({ container: hologramsContainer, id: 'holo-body' });
const earthHologram = createHologram({ container: hologramsContainer, id: 'holo-earth' });
const missionInfo = setupMissionInfo({
  onAnalogChange: (analog) => {
    showAnalog(analog);
    setBackLabel(analog ? 'Back to analogs' : 'Back to missions');
  },
  onRetry: () => requestAnalogs()
});

// En la vista de misión, "Volver al menú" se sustituye por "Volver a misiones"; dentro de un
// análogo, por "Volver a análogos" (regresa a la lista de análogos de la misión)
const openMenuButton = document.getElementById('open-menu-btn');
const backToMissionsButton = document.getElementById('back-to-missions-btn');
const backToMissionsLabel = document.getElementById('back-to-missions-label');
function setBackLabel(text) {
  backToMissionsLabel.textContent = text;
  backToMissionsButton.setAttribute('aria-label', text);
}
backToMissionsButton.addEventListener('click', () => {
  if (missionInfo.inAnalog) missionInfo.backToList();
  else focusBody(missionBodyName);
});
function setMissionButtons(inMission) {
  openMenuButton.classList.toggle('is-replaced', inMission);
  backToMissionsButton.classList.toggle('is-hidden', !inMission);
}
let missionBodyName = null; // cuerpo de la misión abierta ('moon' | 'mars')
let selectedRegionId = null; // misión mostrada en el holograma
let analogRegionId = null; // análogo terrestre elegido entre los más parecidos
let analogsRequest = 0; // petición de análogos más reciente (las anteriores se descartan)
let isRotating = true; // los cuerpos giran salvo con una misión abierta

// Tierra en miniatura bajo el cuerpo durante la vista de misión (su tamaño depende del cuerpo)
const earthMini = createEarthMiniature({ earth, radius: MOON.missionView.earth.radius });
scene.add(earthMini.group);

// Cuerpos de la escena: en la vista de misión solo queda visible el de la misión
const sceneBodies = [earth.group, moon.group, mars.group, satellite.group, orion.group, rover.group, solarPanel.group, antenna.group];

/**
 * Vista de misión = tablero de análisis fijo: sin girar ni hacer zoom y sin el resto de
 * cuerpos (la Tierra real podía asomar detrás de la miniatura)
 */
function setAnalysisMode(active, keepVisible = null) {
  sceneBodies.forEach((body) => (body.visible = !active || body === keepVisible));
  setMissionButtons(active);
  controls.enabled = !active && !mainMenu.isOpen;
}

/**
 * Elección del tipo de misión (paso 1 del panel): solo se ve lo que muestra la tarjeta bajo el
 * puntero, sobre el espacio. Al pasar a los terrenos vuelven a verse todos los cuerpos y, si la
 * cámara se quedó en un objeto de misión, vuela de vuelta al planeta.
 */
const missionObjects = { rover: rover.group, solarPanel: solarPanel.group, antenna: antenna.group };
let choosingBody = null; // planeta cuyas misiones se eligen ('moon' | 'mars'); null = fuera del paso 1
let previewed = null; // lo último mostrado por una tarjeta

function setChoosingMission(choosing) {
  if (selectedRegionId) return; // la vista de misión gestiona su propia visibilidad
  previewed = null;
  if (choosing) {
    choosingBody = cameraNavigator.currentFocus;
    sceneBodies.forEach((body) => (body.visible = false));
    placeMissionObjectsNear(missionBodies[choosingBody]);
    return;
  }
  sceneBodies.forEach((body) => (body.visible = true));
  // Solo si el cambio es dentro del panel: al ir al menú u a otro cuerpo el enfoque ya cambió
  if (missionObjects[cameraNavigator.currentFocus]) cameraNavigator.focus(choosingBody);
  choosingBody = null;
}

/**
 * Lleva el rover, el panel y la antena (juntos) justo encima del planeta, fuera de su encuadre: el viaje de
 * la cámara entre el planeta y ellos es corto. Ahí se quedan hasta la siguiente elección.
 */
const pairCenter = new THREE.Vector3();
const pairOutward = new THREE.Vector3();
function placeMissionObjectsNear(mission) {
  mission.mesh.getWorldPosition(pairCenter);
  pairOutward.copy(pairCenter).setY(0).normalize(); // alejándose de la Tierra: horizontal en pantalla
  pairCenter.y += mission.config.radius * MISSION_PREVIEW.lift;
  rover.placeAt(pairCenter);
  solarPanel.placeAt(pairCenter.addScaledVector(pairOutward, MISSION_PREVIEW.pairGap));
  antenna.placeAt(pairCenter.addScaledVector(pairOutward, -2 * MISSION_PREVIEW.pairGap));
}

/**
 * Tarjeta de misión bajo el puntero: la cámara viaja (como entre planetas) hasta lo que muestra:
 * 'body' (misión libre) = el planeta elegido; 'rover' | 'antenna' | 'solarPanel' = ese objeto.
 * Al salir de la lista (`null`) se queda donde está.
 */
function previewMission(name) {
  if (!choosingBody || !name || name === previewed) return;
  previewed = name;
  const isBody = name === 'body';
  const target = isBody ? missionBodies[choosingBody].group : missionObjects[name];
  sceneBodies.forEach((body) => (body.visible = body === target));
  cameraNavigator.focus(isBody ? choosingBody : name, false, isBody ? 1 : MISSION_PREVIEW.objectDistanceScale);
}

/** Sale de la vista de misión (cualquier cambio de enfoque la cierra) */
function closeMission() {
  if (!selectedRegionId) return;
  setAnalysisMode(false);
  isRotating = true;
  missionBodies[missionBodyName].markers.showOnly(null);
  missionBodyName = null;
  selectedRegionId = null;
  analogRegionId = null;
  missionInfo.hide();
  setBackLabel('Back to missions');
  bodyHologram.hide();
  earthHologram.hide();
  earthMini.group.visible = false;
  missionVignette.classList.remove('is-visible');
  targetFov = CAMERA.fov;
  if (!mainMenu.isOpen) viewShift.setTarget(0, 0);
}

/** Vuela hasta un cuerpo y actualiza la lista de misiones y las áreas de terreno */
function focusBody(name, distanceScale) {
  cameraNavigator.focus(name, false, distanceScale);
  closeMission();
  updateMissionsPanel(name);
  updateTerrainAreas(name, mainMenu.isOpen);
}

// --- Menú principal: Orión de fondo, vista desplazada a la derecha ---
const viewShift = createViewShift(camera);
const menuTour = createMenuTour({ camera, controls, cameraNavigator, focus: focusBody });

const leaveMenuTo = (name) => () => {
  mainMenu.close();
  missionsPanel.reset(); // desde el menú, primero se elige la misión y después el terreno
  focusBody(name);
};

const mainMenu = setupMainMenu({
  actions: {
    moon: leaveMenuTo('moon'),
    mars: leaveMenuTo('mars'),
    api: leaveMenuTo('satellite') // vista del satélite con el panel para soltar los JSON
  },
  onToggle: (isOpen) => {
    // En el menú la escena es solo fondo: sin arrastre ni zoom
    controls.enabled = !isOpen;
    viewShift.setTarget(isOpen ? shiftIfWide(MENU.viewShift) : 0, 0);
    if (isOpen) menuTour.reset();
    updateTerrainAreas(cameraNavigator.currentFocus, isOpen);
  }
});
viewShift.snap(); // sin transición en la carga inicial

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  if (mainMenu.isOpen) viewShift.setTargetX(shiftIfWide(MENU.viewShift));
  else if (!selectedRegionId && missionBodies[cameraNavigator.currentFocus]?.regions) viewShift.setTargetX(shiftIfWide(MENU.missionsViewShift));
  viewShift.apply(); // también actualiza la proyección
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

/** Aparición de la Tierra en miniatura al entrar en un análogo (0 → 1, crece desde el centro) */
const EARTH_APPEAR_SPEED = 3; // 1/s (≈ 0.33 s)
let earthAppear = 0;

/**
 * Cambio de análogo con la Tierra ya a la vista: el globo gira sobre su eje (interpolando
 * longitud y latitud del punto que queda en su borde derecho) hasta llevar el nuevo área allí.
 * El haz del holograma sigue a ese punto, así que el área nueva «llega» bajo él.
 */
const EARTH_SWITCH_SECONDS = 1.1;
const earthSwitch = { t: 1, fromLon: 0, fromLat: 0, dLon: 0, dLat: 0 };
const switchFrame = { normal: new THREE.Vector3(), east: new THREE.Vector3(), north: new THREE.Vector3() };
const POLE = new THREE.Vector3(0, 1, 0);
const switchPoint = new THREE.Vector3();
const lonOf = (n) => Math.atan2(n.x, n.z);
const latOf = (n) => Math.asin(THREE.MathUtils.clamp(n.y, -1, 1));

/** Base del punto en (lon, lat) con el norte hacia el polo, como surfaceFrame de terrainMarkers */
function setSwitchFrame(lon, lat) {
  const { normal, east, north } = switchFrame;
  normal.set(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
  east.crossVectors(POLE, normal);
  if (east.lengthSq() < 1e-10) east.set(1, 0, 0);
  east.normalize();
  north.crossVectors(normal, east);
}
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Distancia de la cámara en la vista de misión, como factor de `missionView.distance`:
 * más cerca en la lista de análogos (cuerpo más grande) y la normal dentro de un análogo
 */
const missionZoom = { current: 1, target: 1 };
const missionCameraDir = new THREE.Vector3();

/** Distancia de la cámara dentro de un análogo: compensa el campo de visión estrecho de la misión */
const missionCameraDistance = (view) => view.distance * distanceForFov(CAMERA.missionFov);

/**
 * Análogo terrestre en el que se ha entrado: Tierra en miniatura bajo el cuerpo con solo su área
 * y su propio holograma, y el cuerpo sube para dejarle sitio. Con `null` (lista de análogos) la
 * Tierra desaparece y el cuerpo vuelve al centro con su holograma.
 */
function showAnalog(analog) {
  const mission = missionBodies[missionBodyName];
  const view = mission.config.missionView;
  if (!analog) {
    analogRegionId = null;
    earthSwitch.t = 1;
    earthHologram.hide();
    earthMini.group.visible = false;
    viewShift.setTarget(...view.soloViewShift);
    missionZoom.target = view.soloDistanceScale;
    return;
  }
  missionZoom.target = 1;
  const changed = analogRegionId !== analog.region.regionId;
  const nextFrame = earthMarkers.localFrame(analog.region.regionId);
  if (!analogRegionId) earthAppear = 0; // solo crece si no estaba ya a la vista
  else if (changed && !reducedMotion.matches) {
    // Desde donde esté ahora el globo (también si estaba a mitad de otro giro)
    const from = earthSwitch.t < 1 ? switchFrame.normal : analogFrame.normal;
    earthSwitch.fromLon = lonOf(from);
    earthSwitch.fromLat = latOf(from);
    const dLon = lonOf(nextFrame.normal) - earthSwitch.fromLon;
    earthSwitch.dLon = Math.atan2(Math.sin(dLon), Math.cos(dLon)); // por el camino más corto
    earthSwitch.dLat = latOf(nextFrame.normal) - earthSwitch.fromLat;
    earthSwitch.t = 0;
  }
  analogRegionId = analog.region.regionId;
  analogFrame = nextFrame;
  earthMarkers.showOnly(analogRegionId);
  earthMini.group.visible = true;
  viewShift.setTarget(...view.viewShift);
  if (!changed) return;
  earthHologram.show(analog.region, earthMarkers.outline(analogRegionId), EARTH.realRadiusKm, {
    kicker: `Earth analog · ${analogRegionId}`,
    tag: `${Math.round(analog.similarity * 100)}%`
  }, {
    // La forma del análogo se adapta hacia la del terreno de la misión según la similitud
    target: mission.markers.outline(selectedRegionId),
    similarity: analog.similarity
  });
}

/**
 * Pide al backend los análogos de la misión abierta, ponderados con el filtro de misión elegido en
 * el panel de terrenos, y los pasa al panel (o el error, para que ofrezca reintentar). Se descarta
 * la respuesta si mientras tanto cambió la misión.
 */
function requestAnalogs() {
  const request = ++analogsRequest;
  const regionId = selectedRegionId;
  const isCurrent = () => request === analogsRequest && selectedRegionId === regionId;
  const saved = savedByRegion.get(regionId);
  const region = saved && missionBodies[missionBodyName].regions.find((r) => r.regionId === regionId);
  const analogs = saved
    ? fetchSavedRegionAnalogs(region, saved.matches, earthRegions, missionsPanel.filter)
    : fetchClosestAnalogs(regionId, missionBodyName, earthRegions, missionsPanel.filter);
  analogs
    .then((analogs) => isCurrent() && missionInfo.setAnalogs(analogs))
    .catch((err) => {
      if (!isCurrent()) return;
      console.error('Analogs API unavailable.', err);
      missionInfo.setAnalogsError();
    });
}

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

  focusBody(name); // cierra la misión anterior; la nueva se abre después
  // Se pausa la rotación para que el área no se escape del haz (closeMission la reanuda)
  isRotating = false;
  missionsPanel.hide();

  missionBodyName = name;
  selectedRegionId = region.regionId;
  mission.markers.showOnly(region.regionId); // solo el área de esta misión
  bodyHologram.show(region, mission.markers.outline(region.regionId), mission.config.realRadiusKm, {
    kicker: mission.kicker,
    tag: region.regionId
  });
  // Los 3 análogos más parecidos, del backend, con tarjetas esqueleto mientras llegan; la Tierra
  // no aparece hasta entrar en uno de ellos
  // Terreno propio sin filtro: sus análogos son los de la misión con la que se analizó
  const saved = savedByRegion.get(region.regionId);
  missionInfo.show(region, null, name, missionsPanel.filter || saved?.mission || '');
  requestAnalogs();
  analogRegionId = null;

  missionVignette.classList.add('is-visible');
  viewShift.setTarget(...view.soloViewShift);
  missionZoom.current = missionZoom.target = view.soloDistanceScale;
  setAnalysisMode(true, mission.group);

  mission.markers.worldPosition(region.regionId, missionArea);
  // Campo de visión estrecho y cámara más lejos: mismo encuadre, sin deformar los bordes
  targetFov = CAMERA.missionFov;
  const fullDistance = missionCameraDistance(view);
  // Llega a la distancia de la lista de análogos; el límite admite la de dentro de un análogo
  cameraNavigator.focusFrom(name, missionViewDirection(mission, missionArea), fullDistance * missionZoom.current, fullDistance);
}

// Los terrenos de la Tierra son opcionales: sin ellos las misiones se abren igual, sin análogos
const loadEarthRegions = () =>
  loadRegions('./backend/data/earth.json').catch((err) => {
    console.warn('No Earth terrains: missions will be shown without analogs.', err);
    return [];
  });

Promise.all([loadRegions('./backend/data/moon.json'), loadRegions('./backend/data/mars.json'), loadEarthRegions()])
  .then(([moonRegions, marsRegions, terrestrialRegions]) => {
    earthRegions = terrestrialRegions;
    earthMarkers = createTerrainMarkers({ body: earthMini.surface, radius: earthMini.areaRadius, regions: earthRegions });

    missionBodies.moon.builtin = moonRegions;
    missionBodies.mars.builtin = marsRegions;
    applyBodyRegions();
    // Al añadir o quitar terrenos propios (vista API) se rehacen las áreas y la lista de misiones
    customRegions.subscribe(() => {
      if (selectedRegionId) closeMission();
      applyBodyRegions();
      updateMissionsPanel(cameraNavigator.currentFocus);
      updateTerrainAreas(cameraNavigator.currentFocus, mainMenu.isOpen);
    });

    setupMarkerTooltip({
      camera,
      domElement: renderer.domElement,
      markerSets: () => [missionBodies.moon.markers, missionBodies.mars.markers],
      occluders: [moon.mesh, mars.mesh],
      onSelect: goToMission
    });
    updateMissionsPanel(cameraNavigator.currentFocus);
    updateTerrainAreas(cameraNavigator.currentFocus, mainMenu.isOpen);
  })
  .catch((err) => console.warn('Could not load terrains from backend/data.', err));

/**
 * Por fotograma con una misión abierta: acercamiento entre la lista de análogos y un análogo,
 * hologramas pegados a su cuerpo y Tierra en miniatura bajo el cuerpo
 */
function updateMissionView(delta) {
  const mission = missionBodies[missionBodyName];
  const view = mission.config.missionView;

  // Acercamiento suave entre la lista de análogos y un análogo (tras el vuelo de llegada)
  if (missionZoom.current !== missionZoom.target && !cameraNavigator.isFlying) {
    missionZoom.current = approach(missionZoom.current, missionZoom.target, CAMERA.missionZoomSpeed, delta, 1e-4);
    missionCameraDir.subVectors(camera.position, controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(missionCameraDir, missionCameraDistance(view) * missionZoom.current);
  }
  camera.updateMatrixWorld(); // OrbitControls ya movió la cámara en este fotograma
  mission.mesh.getWorldPosition(bodyCenter);
  mission.markers.worldPosition(selectedRegionId, missionArea);
  bodyHologram.update(camera, bodyCenter, mission.config.radius, missionArea);

  if (!analogRegionId) return;
  if (earthAppear < 1) {
    earthAppear = Math.min(1, earthAppear + EARTH_APPEAR_SPEED * delta);
    earthMini.setRadius(view.earth.radius * (1 - (1 - earthAppear) ** 3)); // ease-out cúbico
  }
  let frame = analogFrame;
  let eased = 1;
  if (earthSwitch.t < 1) {
    earthSwitch.t = Math.min(1, earthSwitch.t + delta / EARTH_SWITCH_SECONDS);
    eased = (1 - Math.cos(Math.PI * earthSwitch.t)) / 2; // ease-in-out senoidal
    setSwitchFrame(earthSwitch.fromLon + earthSwitch.dLon * eased, earthSwitch.fromLat + earthSwitch.dLat * eased);
    frame = switchFrame;
  }
  // Separación cuerpo → Tierra proporcional a la distancia de la vista (mantiene la composición)
  earthMini.place(camera, bodyCenter, view.earth.drop * view.distance, frame, view.faceCamera);
  earthMarkers.worldPosition(analogRegionId, analogArea);
  if (frame === switchFrame) {
    // Durante el giro el haz sale del punto del borde y acaba, sin salto, en el centro del área
    earthMini.surface.localToWorld(switchPoint.copy(switchFrame.normal).multiplyScalar(earthMini.areaRadius));
    analogArea.lerpVectors(switchPoint, analogArea, eased);
  }
  earthHologram.update(camera, earthMini.group.position, earthMini.radius, analogArea);
}

// --- Bucle principal ---
const clock = new THREE.Clock();
const spinningBodies = [earth.surface, moon.mesh, mars.mesh];

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();

  // Solo rotación sobre su propio eje, a la misma velocidad para todos (los cuerpos no se trasladan)
  if (isRotating) {
    const spin = ROTATION.baseSpeed * delta;
    spinningBodies.forEach((body) => {
      body.rotation.y += spin;
    });
    earth.clouds.rotation.y += spin * ROTATION.cloudsFactor;
  }

  // Transiciones suaves del desplazamiento de vista (menú y misión) y del campo de visión
  viewShift.update(delta);
  if (camera.fov !== targetFov) {
    camera.fov = approach(camera.fov, targetFov, CAMERA.fovSpeed, delta, 0.01);
    camera.updateProjectionMatrix();
  }

  cameraNavigator.update(delta);
  if (mainMenu.isOpen) menuTour.update(delta);
  starfield.rotation.y += ROTATION.starfieldSpeed * delta;

  controls.update();
  lighting.update(camera, controls.target);
  satellite.update(delta, clock.elapsedTime, lighting.direction);
  orion.update(delta, lighting.direction);
  rover.update(delta);
  antenna.update(delta);
  solarPanel.update(delta, lighting.direction);
  if (selectedRegionId) updateMissionView(delta);

  renderer.render(scene, camera);
});
