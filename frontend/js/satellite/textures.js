import { createCanvas, createCanvasTexture, createSeededRandom, fillCanvas, strokeLine, withStops } from '../utils/canvas.js';

/**
 * Texturas procedurales del satélite: aislamiento multicapa (MLI) dorado arrugado,
 * celdas solares de triple unión, reverso de paneles, radiadores de espejo (OSR) y halo de luces
 */
export function createSatelliteTextures(anisotropy) {
  const rand = createSeededRandom(2718);

  // 1. MLI dorado: facetas arrugadas + pliegues + cinta de unión
  const S = 1024;
  const { canvas: mliCanvas, ctx: m } = createCanvas(S, S);
  const { canvas: mliBumpCanvas, ctx: mb } = createCanvas(S, S);
  fillCanvas(m, '#c99430');
  fillCanvas(mb, '#808080');

  for (let i = 0; i < 900; i++) {
    const cx = rand() * S;
    const cy = rand() * S;
    const r = 20 + rand() * 70;
    const sides = 3 + Math.floor(rand() * 3);
    const bright = rand() > 0.5;
    const g = Math.floor(70 + rand() * 130);
    m.fillStyle = bright
      ? `rgba(255, 228, 140, ${0.05 + rand() * 0.18})`
      : `rgba(90, 52, 8, ${0.05 + rand() * 0.2})`;
    mb.fillStyle = `rgba(${g}, ${g}, ${g}, 0.35)`;
    m.beginPath();
    mb.beginPath();
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + rand() * 0.8;
      const px = cx + Math.cos(a) * r * (0.5 + rand() * 0.6);
      const py = cy + Math.sin(a) * r * (0.5 + rand() * 0.6);
      if (k === 0) {
        m.moveTo(px, py);
        mb.moveTo(px, py);
      } else {
        m.lineTo(px, py);
        mb.lineTo(px, py);
      }
    }
    m.closePath();
    mb.closePath();
    m.fill();
    mb.fill();
  }

  for (let i = 0; i < 260; i++) {
    let x = rand() * S;
    let y = rand() * S;
    const light = rand() > 0.5;
    m.strokeStyle = light ? 'rgba(255, 240, 190, 0.45)' : 'rgba(70, 40, 5, 0.45)';
    mb.strokeStyle = light ? 'rgba(235, 235, 235, 0.6)' : 'rgba(25, 25, 25, 0.6)';
    m.lineWidth = mb.lineWidth = 1 + rand() * 2;
    m.beginPath();
    mb.beginPath();
    m.moveTo(x, y);
    mb.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += (rand() - 0.5) * 120;
      y += (rand() - 0.5) * 120;
      m.lineTo(x, y);
      mb.lineTo(x, y);
    }
    m.stroke();
    mb.stroke();
  }

  m.fillStyle = 'rgba(214, 220, 228, 0.55)';
  mb.fillStyle = 'rgba(150, 150, 150, 0.8)';
  [S * 0.34, S * 0.67].forEach((p) => {
    m.fillRect(p - 6, 0, 12, S);
    m.fillRect(0, p - 6, S, 12);
    mb.fillRect(p - 6, 0, 12, S);
    mb.fillRect(0, p - 6, S, 12);
  });

  // 2. Celdas solares (12 x 8 por panel) con esquinas recortadas, busbars y dedos colectores
  const PW = 1024;
  const PH = 640;
  const { canvas: solarCanvas, ctx: s } = createCanvas(PW, PH);
  fillCanvas(s, '#aeb6c2');
  const cols = 12;
  const rows = 8;
  const border = 14;
  const gap = 4;
  const cw = (PW - border * 2 - gap * (cols - 1)) / cols;
  const ch = (PH - border * 2 - gap * (rows - 1)) / rows;
  const cut = Math.min(cw, ch) * 0.14;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = border + c * (cw + gap);
      const y = border + r * (ch + gap);
      const t = rand() * 0.08;
      s.fillStyle = withStops(s.createLinearGradient(x, y, x + cw, y + ch), [
        [0, `rgb(${(20 + t * 120) | 0}, ${(40 + t * 140) | 0}, ${(96 + t * 180) | 0})`],
        [1, '#0a1736']
      ]);
      s.beginPath();
      s.moveTo(x + cut, y);
      s.lineTo(x + cw - cut, y);
      s.lineTo(x + cw, y + cut);
      s.lineTo(x + cw, y + ch - cut);
      s.lineTo(x + cw - cut, y + ch);
      s.lineTo(x + cut, y + ch);
      s.lineTo(x, y + ch - cut);
      s.lineTo(x, y + cut);
      s.closePath();
      s.fill();

      s.strokeStyle = 'rgba(150, 172, 215, 0.1)';
      s.lineWidth = 1;
      for (let fy = y + 5; fy < y + ch - 3; fy += 5) strokeLine(s, x + 2, fy, x + cw - 2, fy);
      s.strokeStyle = 'rgba(205, 214, 228, 0.45)';
      s.lineWidth = 1.4;
      for (let b = 1; b <= 2; b++) {
        const bx = x + (cw * b) / 3;
        strokeLine(s, bx, y + 2, bx, y + ch - 2);
      }
    }
  }

  // 3. Reverso de los paneles (sustrato de fibra de carbono con kapton claro)
  const { canvas: backCanvas, ctx: bk } = createCanvas(512, 320);
  fillCanvas(bk, '#d4d8de');
  bk.strokeStyle = 'rgba(40, 48, 60, 0.18)';
  bk.lineWidth = 2;
  for (let x = 0; x <= 512; x += 64) strokeLine(bk, x, 0, x, 320);
  for (let y = 0; y <= 320; y += 64) strokeLine(bk, 0, y, 512, y);

  // 4. Radiadores OSR: mosaico de pequeñas baldosas de espejo
  const R = 512;
  const { canvas: radCanvas, ctx: rc } = createCanvas(R, R);
  fillCanvas(rc, '#5d6672');
  const tile = R / 16;
  for (let ty = 0; ty < 16; ty++) {
    for (let tx = 0; tx < 16; tx++) {
      const v = 200 + Math.floor(rand() * 40);
      rc.fillStyle = `rgb(${v}, ${v + 4}, ${v + 10})`;
      rc.fillRect(tx * tile + 1.5, ty * tile + 1.5, tile - 3, tile - 3);
    }
  }

  // 5. Halo radial para las luces de navegación
  const { canvas: glowCanvas, ctx: gl } = createCanvas(128, 128);
  fillCanvas(
    gl,
    withStops(gl.createRadialGradient(64, 64, 0, 64, 64, 64), [
      [0, 'rgba(255, 255, 255, 1)'],
      [0.25, 'rgba(255, 255, 255, 0.55)'],
      [1, 'rgba(255, 255, 255, 0)']
    ])
  );

  return {
    mliMap: createCanvasTexture(mliCanvas, anisotropy, true),
    mliBump: createCanvasTexture(mliBumpCanvas, anisotropy),
    solarMap: createCanvasTexture(solarCanvas, anisotropy, true),
    panelBackMap: createCanvasTexture(backCanvas, anisotropy, true),
    radiatorMap: createCanvasTexture(radCanvas, anisotropy, true),
    glowMap: createCanvasTexture(glowCanvas, anisotropy, true)
  };
}
