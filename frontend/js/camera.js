import * as THREE from 'three';
import { FLIGHT } from './config.js';

const outward = new THREE.Vector3();
const side = new THREE.Vector3();
// Componente vertical máxima de la vista sobre un punto de superficie (evita mirar justo desde el polo)
const MAX_POLAR_Y = 0.995;

/**
 * Vista lateral de un cuerpo: la cámara se coloca de costado respecto a la línea Tierra-cuerpo,
 * ligeramente elevada
 */
function sideView(elevation, distance) {
  return (target, out) => {
    outward.copy(target).normalize();
    side.set(-outward.z, elevation, outward.x).normalize();
    return out.copy(target).addScaledVector(side, distance);
  };
}

/**
 * Vista de una nave en órbita baja: desde fuera de la órbita (`outwardDistance` alejándose de la
 * Tierra, `sideDistance` de costado y `lift` hacia arriba), con la Tierra de fondo
 */
function orbitView(outwardDistance, sideDistance, lift) {
  return (target, out) => {
    outward.copy(target).normalize();
    side.set(-outward.z, 0, outward.x).normalize();
    out.copy(target).addScaledVector(outward, outwardDistance).addScaledVector(side, sideDistance);
    out.y += lift;
    return out;
  };
}

/**
 * Destinos de cámara. `zoom` limita el acercamiento/alejamiento (nunca lo suficiente para ver
 * todo el sistema) y `near` es el plano cercano de la cámara.
 */
function createFocusViews(bodies) {
  return {
    earth: {
      object: bodies.earth,
      cameraPosition: (_target, out) => out.set(0, 1.4, 6.2),
      zoom: [2.6, 12.0],
      near: 0.1
    },
    moon: {
      object: bodies.moon,
      cameraPosition: sideView(0.35, 2.3),
      zoom: [1.05, 6.0],
      near: 0.1
    },
    mars: {
      object: bodies.mars,
      cameraPosition: sideView(0.32, 3.8),
      zoom: [1.7, 10.0],
      near: 0.1
    },
    satellite: {
      object: bodies.satellite,
      cameraPosition: orbitView(0.55, 0.45, 0.22),
      zoom: [0.18, 3.0],
      near: 0.01 // reducido para no recortar el modelo al acercarse
    },
    orion: {
      object: bodies.orion,
      cameraPosition: orbitView(0.6, -0.2, 0.12),
      zoom: [0.16, 3.0],
      near: 0.01
    },
    rover: {
      object: bodies.rover,
      cameraPosition: orbitView(0.3, 0.22, 0.1),
      zoom: [0.08, 3.0],
      near: 0.005
    },
    antenna: {
      object: bodies.antenna,
      cameraPosition: orbitView(0.45, 0.25, 0.12),
      zoom: [0.12, 3.0],
      near: 0.01
    },
    solarPanel: {
      object: bodies.solarPanel,
      cameraPosition: orbitView(0.45, -0.3, 0.15),
      zoom: [0.12, 3.0],
      near: 0.01
    }
  };
}

/**
 * Lleva la cámara de un cuerpo a otro con un vuelo corto (aceleración y frenado suaves y un
 * arco leve), empujándola fuera de cualquier obstáculo que se cruce en el camino.
 *
 * @param bodies    objetos a enfocar: { earth, moon, mars, satellite, orion }
 * @param obstacles esferas que el vuelo no atraviesa: [{ object, safeRadius }]
 */
export function createCameraNavigator({ camera, controls, bodies, obstacles }) {
  const views = createFocusViews(bodies);
  const flight = {
    active: false,
    t: 0,
    duration: 1,
    arc: 0,
    fromCamera: new THREE.Vector3(),
    toCamera: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
    zoom: [0, Infinity]
  };
  const obstacleCenter = new THREE.Vector3();
  const obstacleOffset = new THREE.Vector3();
  let currentFocus = null;
  const surfaceDirection = new THREE.Vector3();

  const applyZoomLimits = ([min, max]) => {
    controls.minDistance = min;
    controls.maxDistance = max;
  };

  const endFlight = () => {
    flight.active = false;
    applyZoomLimits(flight.zoom);
  };

  // Si el usuario toma el control durante un vuelo, se detiene ahí mismo
  controls.addEventListener('start', () => {
    if (flight.active) endFlight();
  });

  /** Posición de cámara predefinida para un destino (sin moverla) */
  function viewPosition(name, out = new THREE.Vector3()) {
    const view = views[name];
    view.object.getWorldPosition(obstacleCenter);
    return view.cameraPosition(obstacleCenter, out);
  }

  /**
   * Enfoca un cuerpo ("earth" | "moon" | "mars" | "satellite" | "orion" | "rover" | "antenna" | "solarPanel"); `instant` evita el vuelo.
   * `distanceScale` < 1 acerca la cámara respecto a la vista predefinida.
   */
  function focus(name, instant = false, distanceScale = 1) {
    const view = views[name];
    currentFocus = name;

    camera.near = view.near;
    camera.updateProjectionMatrix();

    view.object.getWorldPosition(flight.toTarget);
    view.cameraPosition(flight.toTarget, flight.toCamera);
    if (distanceScale !== 1) {
      flight.toCamera.sub(flight.toTarget).multiplyScalar(distanceScale).add(flight.toTarget);
    }
    flight.zoom = view.zoom;

    if (instant) {
      camera.position.copy(flight.toCamera);
      controls.target.copy(flight.toTarget);
      endFlight();
      return;
    }

    const travel = camera.position.distanceTo(flight.toCamera);
    flight.fromCamera.copy(camera.position);
    flight.fromTarget.copy(controls.target);
    flight.duration = THREE.MathUtils.clamp(
      FLIGHT.minDuration + travel * FLIGHT.durationPerUnit,
      FLIGHT.minDuration,
      FLIGHT.maxDuration
    );
    flight.arc = Math.min(travel * FLIGHT.arcPerUnit, FLIGHT.maxArc);
    flight.t = 0;
    flight.active = true;

    // Sin límites de zoom durante el vuelo para que OrbitControls no lo frene
    applyZoomLimits([0, Infinity]);
  }

  /**
   * Vuela hasta ver un cuerpo desde `direction` (unitaria, en coordenadas de mundo) a
   * `distance` de su centro; la cámara sigue orbitando alrededor del cuerpo. El límite de
   * zoom se amplía si hace falta para que OrbitControls no la acerque al terminar el vuelo
   * (hasta `maxDistance`, si después se va a alejar más).
   */
  function focusFrom(name, direction, distance, maxDistance = distance) {
    const view = views[name];
    focus(name);
    // Cerca de los polos se separa un poco del eje vertical para que OrbitControls no se bloquee
    surfaceDirection.copy(direction);
    if (Math.abs(direction.y) > MAX_POLAR_Y) {
      surfaceDirection.y = 0;
      if (surfaceDirection.lengthSq() < 1e-6) surfaceDirection.set(1, 0, 0);
      surfaceDirection.setLength(Math.sqrt(1 - MAX_POLAR_Y * MAX_POLAR_Y));
      surfaceDirection.y = Math.sign(direction.y) * MAX_POLAR_Y;
    }
    view.object.getWorldPosition(flight.toTarget);
    flight.toCamera.copy(flight.toTarget).addScaledVector(surfaceDirection.normalize(), distance);
    flight.zoom = [view.zoom[0], Math.max(view.zoom[1], distance, maxDistance)];
  }

  /** Avanza el vuelo (smootherstep) evitando atravesar obstáculos */
  function update(delta) {
    if (!flight.active) return;

    flight.t = Math.min(1, flight.t + delta / flight.duration);
    const t = flight.t;
    const eased = t * t * t * (t * (t * 6 - 15) + 10);

    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, eased);
    camera.position.lerpVectors(flight.fromCamera, flight.toCamera, eased);
    camera.position.y += Math.sin(Math.PI * eased) * flight.arc;

    obstacles.forEach(({ object, safeRadius }) => {
      object.getWorldPosition(obstacleCenter);
      obstacleOffset.subVectors(camera.position, obstacleCenter);
      if (obstacleOffset.length() < safeRadius) {
        camera.position.copy(obstacleCenter).add(obstacleOffset.setLength(safeRadius));
      }
    });

    if (t >= 1) endFlight();
  }

  return {
    focus,
    focusFrom,
    update,
    get isFlying() {
      return flight.active;
    },
    viewPosition,
    get currentFocus() {
      return currentFocus;
    }
  };
}
