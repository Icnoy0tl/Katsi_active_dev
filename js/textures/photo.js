import * as THREE from 'three';
import { PHOTO_TEXTURES } from '../config.js';

/**
 * Descarga en paralelo los mapas fotográficos y los sustituye cuerpo por cuerpo.
 * Si alguna textura falla, ese cuerpo conserva su versión procedural.
 */
export function loadPhotoTextures({ anisotropy, earth, moon, mars }) {
  const loader = new THREE.TextureLoader();

  const loadTexture = (url, isColor) =>
    loader.loadAsync(url).then((texture) => {
      if (isColor) texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = anisotropy;
      return texture;
    });

  // Intenta la versión local 4K y, si no está disponible, la del CDN
  const loadWithFallback = ({ local, fallback }, isColor) =>
    loadTexture(local, isColor).catch(() => loadTexture(fallback, isColor));

  // Tierra: color diurno, océanos especulares y relieve normal
  Promise.all([
    loadWithFallback(PHOTO_TEXTURES.earthDay, true),
    loadWithFallback(PHOTO_TEXTURES.earthSpecular, false),
    loadWithFallback(PHOTO_TEXTURES.earthNormal, false)
  ])
    .then(([day, specular, normal]) => {
      applyMaps(
        earth.surface.material,
        { map: day, specularMap: specular, normalMap: normal, bumpMap: null },
        { normalScale: new THREE.Vector2(0.85, -0.85), specular: new THREE.Color(0x4a6a8a), shininess: 22 }
      );
    })
    .catch((err) => console.warn('Texturas de la Tierra no disponibles, usando procedurales.', err));

  // Nubes: la local se usa como transparencia; el PNG de respaldo trae su propio alfa
  const clouds = PHOTO_TEXTURES.earthClouds;
  loadTexture(clouds.local, false)
    .then((alpha) => {
      applyMaps(earth.clouds.material, { map: null, alphaMap: alpha }, { color: new THREE.Color(0xffffff), opacity: 0.95 });
    })
    .catch(() =>
      loadTexture(clouds.fallback, true).then((map) => {
        applyMaps(earth.clouds.material, { map, alphaMap: null }, { opacity: 0.9 });
      })
    )
    .catch((err) => console.warn('Textura de nubes no disponible.', err));

  // Luna (mosaico LRO/Clementine) y Marte (mosaico Viking): color + relieve
  const rockyBodies = [
    { body: moon, color: PHOTO_TEXTURES.moonColor, bump: PHOTO_TEXTURES.moonBump, props: { bumpScale: 1.0, roughness: 0.97, metalness: 0 }, name: 'la Luna' },
    { body: mars, color: PHOTO_TEXTURES.marsColor, bump: PHOTO_TEXTURES.marsBump, props: { bumpScale: 2.0, roughness: 0.93, metalness: 0 }, name: 'Marte' }
  ];

  rockyBodies.forEach(({ body, color, bump, props, name }) => {
    Promise.all([loadWithFallback(color, true), loadWithFallback(bump, false)])
      .then(([colorMap, bumpMap]) => applyMaps(body.mesh.material, { map: colorMap, bumpMap }, props))
      .catch((err) => console.warn(`Texturas de ${name} no disponibles.`, err));
  });
}

/**
 * Sustituye mapas de un material (liberando los anteriores) y ajusta sus propiedades
 */
function applyMaps(material, maps, props) {
  Object.entries(maps).forEach(([key, texture]) => {
    if (material[key] && material[key] !== texture) material[key].dispose();
    material[key] = texture;
  });
  Object.assign(material, props);
  material.needsUpdate = true;
}
