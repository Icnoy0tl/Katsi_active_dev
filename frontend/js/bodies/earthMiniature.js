import * as THREE from 'three';
import { EARTH } from '../config.js';

const cameraUp = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const toCamera = new THREE.Vector3();
const worldNormal = new THREE.Vector3();
const worldNorth = new THREE.Vector3();
const worldEast = new THREE.Vector3();
const worldBasis = new THREE.Matrix4();
const localBasis = new THREE.Matrix4();

/**
 * Tierra en miniatura para la vista de misión: comparte geometrías y materiales (superficie y
 * nubes) con la Tierra real, sin coste de memoria extra; recibe también las texturas
 * fotográficas al cargarse. Sin atmósfera.
 * El área del análogo se dibuja sobre `areaRadius` (justo encima de las nubes) para que las nubes
 * no la tapen.
 *
 * @param radius  radio en pantalla (unidades de escena)
 * @returns { group, surface, areaRadius, radius, setRadius(value), place(...) }
 */
export function createEarthMiniature({ earth, radius }) {
  const group = new THREE.Group();
  group.name = 'earth-miniature';
  group.visible = false;
  group.scale.setScalar(radius / EARTH.radius);

  const surface = new THREE.Mesh(earth.surface.geometry, earth.surface.material);
  const clouds = new THREE.Mesh(earth.clouds.geometry, earth.clouds.material);
  group.add(surface, clouds);

  return {
    group,
    surface,
    /** Cambia el radio en pantalla (la vista de misión de cada cuerpo usa uno distinto) */
    setRadius(value) {
      this.radius = value;
      group.scale.setScalar(value / EARTH.radius);
    },
    /** Radio (local) sobre el que dibujar áreas: justo por encima de las nubes */
    areaRadius: EARTH.cloudsRadius * 1.004,
    radius,
    /**
     * Coloca la miniatura `drop` unidades por debajo de `anchor` (según la vertical de la
     * cámara) y la gira para que el área (base local `frame`: normal, east, north) quede en su
     * borde derecho, algo de frente (`faceCamera`), con el norte hacia arriba en pantalla.
     * Sin asignaciones: se puede llamar en cada fotograma.
     */
    place(camera, anchor, drop, frame, faceCamera) {
      cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
      cameraUp.setFromMatrixColumn(camera.matrixWorld, 1);
      group.position.copy(anchor).addScaledVector(cameraUp, -drop);

      toCamera.subVectors(camera.position, group.position).normalize();
      worldNormal.copy(cameraRight).addScaledVector(toCamera, faceCamera).normalize();
      worldNorth.copy(cameraUp).addScaledVector(worldNormal, -cameraUp.dot(worldNormal)).normalize();
      worldEast.crossVectors(worldNorth, worldNormal);

      // Rotación que lleva la base local del área (este, norte, normal) a la del mundo
      worldBasis.makeBasis(worldEast, worldNorth, worldNormal);
      localBasis.makeBasis(frame.east, frame.north, frame.normal).transpose();
      group.quaternion.setFromRotationMatrix(worldBasis.multiply(localBasis));
      group.updateMatrixWorld(true);
    }
  };
}
