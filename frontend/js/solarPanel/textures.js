import { createCanvas, createCanvasTexture, createSeededRandom, fillCanvas, strokeLine, withStops } from '../utils/canvas.js';

/**
 * Texturas procedurales del panel solar: celdas de silicio (una losa por segmento plegable),
 * reverso de kapton y aislamiento de la unidad de potencia
 */
export function createSolarPanelTextures(anisotropy) {
  const rand = createSeededRandom(4242);

  // 1. Celdas: 4 × 10 por segmento (proporción del segmento, ~1.5 × 4.2 m)
  const W = 256;
  const H = 640;
  const { canvas: cellsCanvas, ctx: c } = createCanvas(W, H);
  fillCanvas(c, '#c9ced6');
  const cols = 4;
  const rows = 10;
  const border = 6;
  const gap = 3;
  const cw = (W - border * 2 - gap * (cols - 1)) / cols;
  const ch = (H - border * 2 - gap * (rows - 1)) / rows;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = border + k * (cw + gap);
      const y = border + r * (ch + gap);
      const t = rand() * 0.1;
      c.fillStyle = withStops(c.createLinearGradient(x, y, x + cw, y + ch), [
        [0, `rgb(${(28 + t * 120) | 0}, ${(46 + t * 140) | 0}, ${(110 + t * 160) | 0})`],
        [1, '#0b1638']
      ]);
      c.fillRect(x, y, cw, ch);
      c.strokeStyle = 'rgba(160, 182, 225, 0.12)';
      c.lineWidth = 1;
      for (let fy = y + 4; fy < y + ch - 2; fy += 4) strokeLine(c, x + 2, fy, x + cw - 2, fy);
      c.strokeStyle = 'rgba(210, 218, 232, 0.5)';
      c.lineWidth = 1.2;
      strokeLine(c, x + cw / 2, y + 2, x + cw / 2, y + ch - 2);
    }
  }

  // 2. Reverso: kapton ámbar con la retícula del sustrato
  const { canvas: backCanvas, ctx: b } = createCanvas(128, 320);
  fillCanvas(b, '#b7894a');
  b.strokeStyle = 'rgba(70, 44, 14, 0.3)';
  b.lineWidth = 2;
  for (let x = 0; x <= 128; x += 32) strokeLine(b, x, 0, x, 320);
  for (let y = 0; y <= 320; y += 32) strokeLine(b, 0, y, 128, y);

  // 3. Unidad de potencia: mantas blancas acolchadas (beta cloth) con costuras
  const { canvas: hubCanvas, ctx: h } = createCanvas(256, 256);
  fillCanvas(h, '#e7e6e1');
  for (let i = 0; i < 160; i++) {
    h.fillStyle = `rgba(${rand() > 0.5 ? '255, 255, 255' : '150, 148, 140'}, ${rand() * 0.25})`;
    h.fillRect(rand() * 256, rand() * 256, 6 + rand() * 30, 4 + rand() * 20);
  }
  h.strokeStyle = 'rgba(120, 118, 110, 0.6)';
  h.lineWidth = 2;
  for (let p = 64; p < 256; p += 64) {
    strokeLine(h, p, 0, p, 256);
    strokeLine(h, 0, p, 256, p);
  }

  return {
    cellsMap: createCanvasTexture(cellsCanvas, anisotropy, true),
    backMap: createCanvasTexture(backCanvas, anisotropy, true),
    hubMap: createCanvasTexture(hubCanvas, anisotropy, true)
  };
}
