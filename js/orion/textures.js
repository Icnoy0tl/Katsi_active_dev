import { createCanvas, createCanvasTexture, createSeededRandom } from '../utils/canvas.js';

const FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif';

/**
 * Texturas procedurales de la cápsula tipo Orión. En los mapas que envuelven un cilindro o cono,
 * el centro horizontal (u = 0.5) es la cara frontal de la nave (+Z local).
 *
 * - crewMap:    módulo de tripulación metálico con losetas, ventanas, emblema y bandera
 * - bandMap:    banda blanca (adaptador) con las letras rojas "NASA"
 * - serviceMap: módulo de servicio blanco con paneles
 * - solarMap / solarBackMap: celdas y reverso de las alas solares
 */
export function createOrionTextures(anisotropy) {
  const rand = createSeededRandom(1969);
  return {
    crewMap: createCanvasTexture(drawCrewModule(rand), anisotropy, true),
    bandMap: createCanvasTexture(drawBand(), anisotropy, true),
    serviceMap: createCanvasTexture(drawServiceModule(rand), anisotropy, true),
    solarMap: createCanvasTexture(drawSolarCells(rand), anisotropy, true),
    solarBackMap: createCanvasTexture(drawSolarBack(), anisotropy, true)
  };
}

/** Cono del módulo de tripulación (2048 x 512; arriba = vértice del cono) */
function drawCrewModule(rand) {
  const W = 2048;
  const H = 512;
  const { canvas, ctx } = createCanvas(W, H);

  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#6f7f94');
  base.addColorStop(1, '#b7c3d1');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Losetas de protección térmica con ligeras variaciones de tono
  const rows = 7;
  const cols = 56;
  const th = H / rows;
  const tw = W / cols;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * tw * 0.5;
    for (let c = -1; c < cols; c++) {
      const v = rand();
      ctx.fillStyle = v > 0.5 ? `rgba(220, 232, 245, ${(v - 0.5) * 0.22})` : `rgba(20, 30, 45, ${v * 0.16})`;
      ctx.fillRect(c * tw + offset, r * th, tw, th);
    }
  }
  ctx.strokeStyle = 'rgba(30, 40, 55, 0.4)';
  ctx.lineWidth = 1.5;
  for (let r = 0; r <= rows; r++) {
    line(ctx, 0, r * th, W, r * th);
    const offset = (r % 2) * tw * 0.5;
    for (let c = 0; c <= cols; c++) line(ctx, c * tw + offset, r * th, c * tw + offset, (r + 1) * th);
  }

  // Los detalles frontales se dibujan comprimidos en vertical para compensar el estiramiento del cono
  const squash = 0.82;
  const decal = (x, y, draw) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, squash);
    draw();
    ctx.restore();
  };

  // Ventanas (cristal oscuro con reflejo y marco claro)
  [0.385, 0.615].forEach((u) =>
    decal(W * u, H * 0.3, () => {
      roundedRect(ctx, -34, -28, 68, 56, 12);
      ctx.fillStyle = '#d7dde5';
      ctx.fill();
      roundedRect(ctx, -27, -21, 54, 42, 9);
      const glass = ctx.createLinearGradient(-27, -21, 27, 21);
      glass.addColorStop(0, '#3b4b63');
      glass.addColorStop(0.45, '#0b1220');
      glass.addColorStop(1, '#1a2436');
      ctx.fillStyle = glass;
      ctx.fill();
    })
  );

  // Emblema circular azul
  decal(W * 0.47, H * 0.56, () => {
    ctx.beginPath();
    ctx.arc(0, 0, 40, 0, Math.PI * 2);
    ctx.fillStyle = '#0b3d91';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2;
      const d = 10 + rand() * 26;
      ctx.fillRect(Math.cos(a) * d, Math.sin(a) * d, 2, 2);
    }
    ctx.strokeStyle = '#fc3d21';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-38, 12);
    ctx.quadraticCurveTo(0, -18, 40, -16);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 21px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NASA', 0, 2);
  });

  // Bandera (13 franjas + cantón)
  decal(W * 0.535, H * 0.56, () => {
    const fw = 92;
    const fh = 50;
    const stripe = fh / 13;
    for (let i = 0; i < 13; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#b22234' : '#ffffff';
      ctx.fillRect(-fw / 2, -fh / 2 + i * stripe, fw, stripe + 0.5);
    }
    ctx.fillStyle = '#3c3b6e';
    ctx.fillRect(-fw / 2, -fh / 2, fw * 0.4, stripe * 7);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 6; x++) ctx.fillRect(-fw / 2 + 3 + x * 6, -fh / 2 + 3 + y * 5.2, 1.6, 1.6);
    }
  });

  return canvas;
}

/** Banda del adaptador: blanca con "NASA" en rojo (4096 x 256, proporción real del cilindro) */
function drawBand() {
  const W = 4096;
  const H = 256;
  const { canvas, ctx } = createCanvas(W, H);

  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#f4f6f8');
  base.addColorStop(1, '#d9dee4');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(60, 70, 85, 0.25)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= W; x += 256) line(ctx, x, 0, x, H);
  ctx.fillStyle = 'rgba(40, 48, 60, 0.55)';
  ctx.fillRect(0, 0, W, 6);
  ctx.fillRect(0, H - 6, W, 6);

  ctx.fillStyle = '#d42a2f';
  ctx.font = `900 178px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '18px';
  ctx.fillText('NASA', W * 0.5, H * 0.54);

  return canvas;
}

/** Módulo de servicio: blanco con paneles, rejillas y franja inferior oscura (2048 x 512) */
function drawServiceModule(rand) {
  const W = 2048;
  const H = 512;
  const { canvas, ctx } = createCanvas(W, H);

  ctx.fillStyle = '#e8ebef';
  ctx.fillRect(0, 0, W, H);

  const cols = 16;
  const cw = W / cols;
  for (let c = 0; c < cols; c++) {
    const v = rand();
    ctx.fillStyle = `rgba(${v > 0.5 ? '255, 255, 255' : '120, 130, 145'}, ${0.04 + rand() * 0.08})`;
    ctx.fillRect(c * cw, 0, cw, H);
  }

  ctx.strokeStyle = 'rgba(70, 80, 95, 0.4)';
  ctx.lineWidth = 2.5;
  for (let c = 0; c <= cols; c++) line(ctx, c * cw, 0, c * cw, H);
  [0.34, 0.68].forEach((v) => line(ctx, 0, H * v, W, H * v));

  // Rejillas y escotillas de acceso
  for (let i = 0; i < 40; i++) {
    const x = rand() * W;
    const y = H * (0.05 + rand() * 0.8);
    const w = 14 + rand() * 40;
    const h = 8 + rand() * 24;
    ctx.fillStyle = `rgba(60, 68, 80, ${0.25 + rand() * 0.35})`;
    ctx.fillRect(x, y, w, h);
  }

  ctx.fillStyle = 'rgba(50, 56, 66, 0.75)';
  ctx.fillRect(0, H - 22, W, 22);

  return canvas;
}

/** Celdas solares oscuras (proporción del panel 2.2 x 1.9) */
function drawSolarCells(rand) {
  const W = 1024;
  const H = 884;
  const { canvas, ctx } = createCanvas(W, H);
  ctx.fillStyle = '#9aa2ad';
  ctx.fillRect(0, 0, W, H);

  const cols = 12;
  const rows = 10;
  const border = 12;
  const gap = 4;
  const cw = (W - border * 2 - gap * (cols - 1)) / cols;
  const ch = (H - border * 2 - gap * (rows - 1)) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = border + c * (cw + gap);
      const y = border + r * (ch + gap);
      const t = rand() * 0.07;
      const grad = ctx.createLinearGradient(x, y, x + cw, y + ch);
      grad.addColorStop(0, `rgb(${(38 + t * 200) | 0}, ${(42 + t * 200) | 0}, ${(52 + t * 220) | 0})`);
      grad.addColorStop(1, '#12151b');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, cw, ch);
      ctx.strokeStyle = 'rgba(190, 198, 210, 0.3)';
      ctx.lineWidth = 1;
      line(ctx, x + cw / 2, y + 2, x + cw / 2, y + ch - 2);
    }
  }
  return canvas;
}

/** Reverso de las alas solares */
function drawSolarBack() {
  const { canvas, ctx } = createCanvas(256, 222);
  ctx.fillStyle = '#c9ced5';
  ctx.fillRect(0, 0, 256, 222);
  ctx.strokeStyle = 'rgba(40, 48, 60, 0.2)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= 256; x += 32) line(ctx, x, 0, x, 222);
  for (let y = 0; y <= 222; y += 37) line(ctx, 0, y, 256, y);
  return canvas;
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
