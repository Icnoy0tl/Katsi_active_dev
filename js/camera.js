import * as THREE from 'three';
import { FLIGHT } from './config.js';

const outward = new THREE.Vector3();
const side = new THREE.Vector3();

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
 * Destinos de cámara. `zoom` limita el acercamiento/alejamiento (nunca lo suficiente para ver
 * todo el sistema) y `near` es el plano cercano de la cámara.
 */
function createFocusViews(bodies) {
  return {
    earth: {
      object: bodies.earth,
      cameraPosition: (target, out) => out.set(0, 1.4, 6.2),
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
      // Desde fuera de la órbita, ligeramente por encima, con la Tierra de fondo
      cameraPosition: (target, out) => {
        outward.copy(target).normalize();
        side.set(-outward.z, 0, outward.x).normalize();
        out.copy(target).addScaledVector(outward, 0.55).addScaledVector(side, 0.45);
        out.y += 0.22;
        return out;
      },
      zoom: [0.18, 3.0],
      near: 0.01 // reducido para no recortar el modelo al acercarse
    }
  };
}

/**
 * Lleva la cámara de un cuerpo a otro con un vuelo corto (aceleración y frenado suaves y un
 * arco leve), empujándola fuera de cualquier obstáculo que se cruce en el camino.
 *
 * @param bodies    objetos a enfocar: { earth, moon, mars, satellite }
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

  /** Enfoca un cuerpo ("earth" | "moon" | "mars" | "satellite"); `instant` evita el vuelo */
  function focus(name, instant = false) {
    const view = views[name];
    currentFocus = name;

    camera.near = view.near;
    camera.updateProjectionMatrix();

    view.object.getWorldPosition(flight.toTarget);
    view.cameraPosition(flight.toTarget, flight.toCamera);
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
    update,
    get currentFocus() {
      return currentFocus;
    }
  };
}
