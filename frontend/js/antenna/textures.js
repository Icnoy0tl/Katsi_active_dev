import { createCanvas, createCanvasTexture, createSeededRandom, fillCanvas, strokeLine } from '../utils/canvas.js';

/**
 * Texturas procedurales de la antena: paneles del reflector (anillos y juntas radiales; en la
 * geometría de revolución u = ángulo y v = radio) y espejos hexagonales del cono central
 */
export function createAntennaTextures(anisotropy) {
  const rand = createSeededRandom(7031);

  // 1. Reflector: paneles crema con leve variación de tono, juntas radiales y anillos
  const S = 1024;
  const { canvas: dishCanvas, ctx: d } = createCanvas(S, S);
  fillCanvas(d, '#e9ddd0');
  const sectors = 48;
  const rings = [0, 0.18, 0.34, 0.48, 0.6, 0.71, 0.8, 0.88, 0.95, 1];
  for (let r = 0; r < rings.length - 1; r++) {
    // Más juntas radiales hacia el borde (paneles de tamaño parecido)
    const split = r < 2 ? 1 : r < 5 ? 2 : 3;
    const cols = sectors * split;
    for (let c = 0; c < cols; c++) {
      const v = 228 + Math.floor(rand() * 22) - 11;
      d.fillStyle = `rgb(${v}, ${v - 12}, ${v - 26})`;
      d.fillRect((c / cols) * S, rings[r] * S, S / cols, (rings[r + 1] - rings[r]) * S);
    }
    d.strokeStyle = 'rgba(120, 100, 84, 0.45)';
    d.lineWidth = 1.2;
    for (let c = 0; c <= cols; c++) strokeLine(d, (c / cols) * S, rings[r] * S, (c / cols) * S, rings[r + 1] * S);
  }
  d.strokeStyle = 'rgba(110, 92, 78, 0.6)';
  d.lineWidth = 2;
  rings.forEach((ring) => strokeLine(d, 0, ring * S, S, ring * S));

  // 2. Cono central: espejos hexagonales plateados
  const H = 256;
  const { canvas: hexCanvas, ctx: h } = createCanvas(H, H);
  fillCanvas(h, '#5d6670');
  const size = 18;
  const w = Math.sqrt(3) * size;
  for (let row = -1; row * size * 1.5 < H + size; row++) {
    for (let col = -1; col * w < H + w; col++) {
      const cx = col * w + (row % 2 ? w / 2 : 0);
      const cy = row * size * 1.5;
      const v = 175 + Math.floor(rand() * 60);
      h.fillStyle = `rgb(${v - 10}, ${v}, ${v + 12})`;
      h.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const px = cx + Math.cos(a) * (size - 1.5);
        const py = cy + Math.sin(a) * (size - 1.5);
        if (k === 0) h.moveTo(px, py);
        else h.lineTo(px, py);
      }
      h.fill();
    }
  }

  return {
    dishMap: createCanvasTexture(dishCanvas, anisotropy, true),
    hexMap: createCanvasTexture(hexCanvas, anisotropy, true)
  };
}
