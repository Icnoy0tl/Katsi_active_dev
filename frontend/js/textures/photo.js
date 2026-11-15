import * as THREE from 'three';
import { PHOTO_TEXTURES } from '../config.js';

/**
 * `createImageBitmap` con opciones decodifica las imágenes fuera del hilo principal; sin él, la
 * decodificación de una 4K congela un fotograma al subirla a la GPU. Mismo criterio que el
 * GLTFLoader de three: Safari < 17 y Firefox < 98 no admiten las opciones (`imageOrientation`).
 */
const decodesOffThread = (() => {
  if (typeof createImageBitmap === 'undefined') return false;
  const ua = navigator.userAgent;
  const safari = /^((?!chrome|android).)*safari/i.test(ua) ? Number(ua.match(/Version\/(\d+)/)?.[1] ?? 0) : Infinity;
  const firefox = ua.includes('Firefox') ? Number(ua.match(/Firefox\/(\d+)/)?.[1] ?? 0) : Infinity;
  return safari >= 17 && firefox >= 98;
})();

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Descarga los mapas fotográficos y los sustituye cuerpo por cuerpo, por prioridad:
 * primero la Tierra (lo primero que se ve) y, cuando termina, nubes, Luna y Marte, para no
 * competir por el ancho de banda en la carga inicial. Si alguna textura falla, ese cuerpo
 * conserva su versión procedural.
 *
 * Para no dar tirones: cada textura se sube a la GPU en su propio fotograma y el shader nuevo de
 * cada material se compila en paralelo antes de usarlo (ver applyMaps).
 */
export function loadPhotoTextures({ renderer, scene, camera, anisotropy, earth, moon, mars }) {
  const bitmapLoader = decodesOffThread && new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
  const imageLoader = new THREE.TextureLoader();
  let uploads = Promise.resolve(); // cola de subidas a la GPU, una por fotograma

  const fetchTexture = (url) =>
    bitmapLoader
      ? bitmapLoader.loadAsync(url).then((bitmap) => {
          const texture = new THREE.Texture(bitmap);
          texture.flipY = false; // ya viene volteada (imageOrientation)
          // Ya está en la GPU con sus mipmaps: se libera la copia decodificada en memoria
          texture.onUpdate = () => bitmap.close();
          return texture;
        })
      : imageLoader.loadAsync(url);

  const loadTexture = (url, isColor) =>
    fetchTexture(url).then((texture) => {
      if (isColor) texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
      const uploaded = uploads.then(nextFrame).then(() => renderer.initTexture(texture));
      uploads = uploaded.catch(() => {});
      return uploaded.then(() => texture);
    });

  // Intenta la versión local 4K y, si no está disponible, la del CDN
  const loadWithFallback = ({ local, fallback }, isColor) =>
    loadTexture(local, isColor).catch(() => loadTexture(fallback, isColor));

  const apply = (mesh, maps, props) => applyMaps({ renderer, scene, camera }, mesh, maps, props);

  // Tierra: color diurno, océanos especulares y relieve normal
  const earthReady = Promise.all([
    loadWithFallback(PHOTO_TEXTURES.earthDay, true),
    loadWithFallback(PHOTO_TEXTURES.earthSpecular, false),
    loadWithFallback(PHOTO_TEXTURES.earthNormal, false)
  ])
    .then(([day, specular, normal]) =>
      apply(
        earth.surface,
        { map: day, specularMap: specular, normalMap: normal, bumpMap: null },
        { normalScale: new THREE.Vector2(0.85, -0.85), specular: new THREE.Color(0x4a6a8a), shininess: 22 }
      )
    )
    .catch((err) => console.warn('Earth textures unavailable, using procedural ones.', err));

  earthReady.then(() => loadSecondary(loadTexture, loadWithFallback, apply, earth, moon, mars));
}

/** Nubes, Luna y Marte: se piden en paralelo una vez aplicada la Tierra */
function loadSecondary(loadTexture, loadWithFallback, apply, earth, moon, mars) {
  // Nubes: la local se usa como transparencia; el PNG de respaldo trae su propio alfa
  const clouds = PHOTO_TEXTURES.earthClouds;
  loadTexture(clouds.local, false)
    .then((alpha) => apply(earth.clouds, { map: null, alphaMap: alpha }, { color: new THREE.Color(0xffffff), opacity: 0.95 }))
    .catch(() => loadTexture(clouds.fallback, true).then((map) => apply(earth.clouds, { map, alphaMap: null }, { opacity: 0.9 })))
    .catch((err) => console.warn('Cloud texture unavailable.', err));

  // Luna (mosaico LRO/Clementine) y Marte (mosaico Viking): color + relieve
  const rockyBodies = [
    { body: moon, color: PHOTO_TEXTURES.moonColor, bump: PHOTO_TEXTURES.moonBump, props: { bumpScale: 1.0, roughness: 0.97, metalness: 0 }, name: 'the Moon' },
    { body: mars, color: PHOTO_TEXTURES.marsColor, bump: PHOTO_TEXTURES.marsBump, props: { bumpScale: 2.0, roughness: 0.93, metalness: 0 }, name: 'Mars' }
  ];

  rockyBodies.forEach(({ body, color, bump, props, name }) => {
    Promise.all([loadWithFallback(color, true), loadWithFallback(bump, false)])
      .then(([colorMap, bumpMap]) => apply(body.mesh, { map: colorMap, bumpMap }, props))
      .catch((err) => console.warn(`${name} textures unavailable.`, err));
  });
}

/**
 * Sustituye mapas del material de `mesh` (liberando los anteriores) y ajusta sus propiedades.
 * Con otros mapas el material necesita otro shader: se prepara una copia, se compila en paralelo
 * (KHR_parallel_shader_compile) y solo entonces se cambia en todas las mallas que lo comparten
 * (la Tierra en miniatura usa los de la Tierra). Así el render nunca espera a la compilación.
 */
async function applyMaps({ renderer, scene, camera }, mesh, maps, props) {
  const current = mesh.material;
  const next = Object.assign(current.clone(), maps, props);
  await renderer.compileAsync(new THREE.Mesh(mesh.geometry, next), camera, scene);
  scene.traverse((object) => {
    if (object.material === current) object.material = next;
  });
  Object.keys(maps).forEach((key) => {
    if (current[key] && current[key] !== next[key]) current[key].dispose();
  });
  current.dispose();
}
