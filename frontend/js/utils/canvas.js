import * as THREE from 'three';

/**
 * Generador pseudoaleatorio determinista (LCG): misma semilla → mismas texturas en cada carga
 */
export function createSeededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

/**
 * Crea un canvas 2D del tamaño indicado
 */
export function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d') };
}

/**
 * Convierte un canvas en textura. Los mapas de color usan espacio sRGB;
 * los de datos (relieve, especular, transparencia) se dejan lineales.
 */
export function createCanvasTexture(canvas, anisotropy, isColor = false) {
  const texture = new THREE.CanvasTexture(canvas);
  if (isColor) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}
