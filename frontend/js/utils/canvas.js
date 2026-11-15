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

/** Añade paradas `[[offset, color], …]` a un degradado y lo devuelve */
export function withStops(gradient, stops) {
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  return gradient;
}

/** Rellena todo el canvas con un color o degradado */
export function fillCanvas(ctx, style) {
  ctx.fillStyle = style;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

export function fillCircle(ctx, x, y, radius, style) {
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** Círculo con degradado radial desde `innerRadius` hasta su borde (cráteres, manchas, relieve) */
export function fillRadialSpot(ctx, x, y, innerRadius, radius, stops) {
  fillCircle(ctx, x, y, radius, withStops(ctx.createRadialGradient(x, y, innerRadius, x, y, radius), stops));
}

export function strokeLine(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
