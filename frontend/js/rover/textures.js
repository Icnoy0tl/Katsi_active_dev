import * as THREE from 'three';
import { createCanvas, createCanvasTexture, createSeededRandom, fillCanvas, strokeLine, withStops } from '../utils/canvas.js';

/**
 * Texturas procedurales del rover: aislamiento dorado-marrón del cuerpo (con mazos de cables),
 * celdas solares de la cubierta, banda de rodadura de las ruedas con sus garras y tapacubos con
 * los muelles en espiral cobrizos
 */
export function createRoverTextures(anisotropy) {
  const rand = createSeededRandom(1604);

  // 1. Cuerpo (caja electrónica caliente): MLI marrón dorado arrugado + cables
  const S = 512;
  const { canvas: bodyCanvas, ctx: b } = createCanvas(S, S);
  const { canvas: bodyBumpCanvas, ctx: bb } = createCanvas(S, S);
  fillCanvas(b, '#7b5a2c');
  fillCanvas(bb, '#808080');

  for (let i = 0; i < 420; i++) {
    const cx = rand() * S;
    const cy = rand() * S;
    const r = 10 + rand() * 40;
    const bright = rand() > 0.5;
    const g = Math.floor(70 + rand() * 130);
    b.fillStyle = bright ? `rgba(226, 180, 98, ${0.06 + rand() * 0.2})` : `rgba(48, 30, 10, ${0.08 + rand() * 0.22})`;
    bb.fillStyle = `rgba(${g}, ${g}, ${g}, 0.4)`;
    b.beginPath();
    bb.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + rand() * 0.9;
      const px = cx + Math.cos(a) * r * (0.5 + rand() * 0.6);
      const py = cy + Math.sin(a) * r * (0.5 + rand() * 0.6);
      if (k === 0) {
        b.moveTo(px, py);
        bb.moveTo(px, py);
      } else {
        b.lineTo(px, py);
        bb.lineTo(px, py);
      }
    }
    b.fill();
    bb.fill();
  }

  // Mazos de cables serpenteantes (oscuros con brillo cobrizo)
  for (let i = 0; i < 70; i++) {
    let x = rand() * S;
    let y = rand() * S;
    const width = 2 + rand() * 4;
    b.lineCap = bb.lineCap = 'round';
    b.beginPath();
    bb.beginPath();
    b.moveTo(x, y);
    bb.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      const nx = x + (rand() - 0.5) * 140;
      const ny = y + (rand() - 0.5) * 140;
      b.quadraticCurveTo(x + (rand() - 0.5) * 60, y + (rand() - 0.5) * 60, nx, ny);
      bb.quadraticCurveTo(x, y, nx, ny);
      x = nx;
      y = ny;
    }
    b.strokeStyle = 'rgba(30, 18, 6, 0.75)';
    b.lineWidth = width + 1.5;
    b.stroke();
    b.strokeStyle = 'rgba(200, 130, 60, 0.55)';
    b.lineWidth = width * 0.45;
    b.stroke();
    bb.strokeStyle = 'rgba(235, 235, 235, 0.8)';
    bb.lineWidth = width + 1;
    bb.stroke();
  }

  // 2. Celdas solares: rectángulos azul-marrón oscuro con interconexiones claras (se repite)
  const P = 512;
  const { canvas: solarCanvas, ctx: s } = createCanvas(P, P);
  fillCanvas(s, '#3b2e22');
  const cells = 8;
  const gap = 3;
  const cell = (P - gap * cells) / cells;
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      const x = gap / 2 + c * (cell + gap);
      const y = gap / 2 + r * (cell + gap);
      const t = rand() * 0.1;
      s.fillStyle = withStops(s.createLinearGradient(x, y, x + cell, y + cell), [
        [0, `rgb(${(46 + t * 160) | 0}, ${(42 + t * 140) | 0}, ${(58 + t * 160) | 0})`],
        [1, '#1a1622']
      ]);
      s.fillRect(x, y, cell, cell);
      s.strokeStyle = 'rgba(190, 170, 140, 0.18)';
      s.lineWidth = 1;
      for (let f = 1; f < 4; f++) strokeLine(s, x + (cell * f) / 4, y + 2, x + (cell * f) / 4, y + cell - 2);
    }
  }
  // Juntas entre paneles (cada 4 celdas)
  s.fillStyle = 'rgba(12, 10, 8, 0.9)';
  s.fillRect(P / 2 - 3, 0, 6, P);
  s.fillRect(0, P / 2 - 3, P, 6);

  // 3. Banda de rodadura: aluminio con garras (grousers) transversales
  const { canvas: treadCanvas, ctx: t } = createCanvas(512, 128);
  const { canvas: treadBumpCanvas, ctx: tb } = createCanvas(512, 128);
  fillCanvas(t, withStops(t.createLinearGradient(0, 0, 0, 128), [[0, '#7d7465'], [0.5, '#a39784'], [1, '#7d7465']]));
  fillCanvas(tb, '#606060');
  const grousers = 32;
  for (let i = 0; i < grousers; i++) {
    const x = (i / grousers) * 512;
    t.fillStyle = 'rgba(40, 34, 26, 0.75)';
    t.fillRect(x, 0, 3, 128);
    t.fillStyle = 'rgba(220, 210, 190, 0.5)';
    t.fillRect(x + 3, 0, 4, 128);
    tb.fillStyle = '#f0f0f0';
    tb.fillRect(x, 0, 7, 128);
  }
  // Polvo marciano incrustado
  for (let i = 0; i < 900; i++) {
    t.fillStyle = `rgba(150, 82, 40, ${rand() * 0.35})`;
    t.fillRect(rand() * 512, rand() * 128, 2 + rand() * 4, 1 + rand() * 3);
  }

  // 4. Tapacubos: aro de aluminio con flexiones en espiral cobrizas (como en las ruedas reales)
  const H = 256;
  const { canvas: hubCanvas, ctx: h } = createCanvas(H, H);
  fillCanvas(h, '#8c8577');
  const c = H / 2;
  h.lineCap = 'round';
  for (let arm = 0; arm < 3; arm++) {
    h.beginPath();
    for (let k = 0; k <= 140; k++) {
      const u = k / 140;
      const radius = 22 + u * 92;
      const angle = (arm / 3) * Math.PI * 2 + u * Math.PI * 3.2;
      const px = c + Math.cos(angle) * radius;
      const py = c + Math.sin(angle) * radius;
      if (k === 0) h.moveTo(px, py);
      else h.lineTo(px, py);
    }
    h.strokeStyle = '#4a2a14';
    h.lineWidth = 9;
    h.stroke();
    h.strokeStyle = '#d0703a';
    h.lineWidth = 5;
    h.stroke();
  }
  h.strokeStyle = '#c6bfb2';
  h.lineWidth = 8;
  h.beginPath();
  h.arc(c, c, 120, 0, Math.PI * 2);
  h.stroke();
  h.fillStyle = withStops(h.createRadialGradient(c, c, 0, c, c, 26), [[0, '#e4e0d8'], [1, '#6f685c']]);
  h.beginPath();
  h.arc(c, c, 26, 0, Math.PI * 2);
  h.fill();

  const solarMap = createCanvasTexture(solarCanvas, anisotropy, true);
  solarMap.wrapS = solarMap.wrapT = THREE.RepeatWrapping;
  solarMap.repeat.set(1.6, 1.6); // la cubierta usa UV en metros: una losa de 8×8 celdas ≈ 0.6 m

  return {
    bodyMap: createCanvasTexture(bodyCanvas, anisotropy, true),
    bodyBump: createCanvasTexture(bodyBumpCanvas, anisotropy),
    solarMap,
    treadMap: createCanvasTexture(treadCanvas, anisotropy, true),
    treadBump: createCanvasTexture(treadBumpCanvas, anisotropy),
    hubMap: createCanvasTexture(hubCanvas, anisotropy, true)
  };
}
