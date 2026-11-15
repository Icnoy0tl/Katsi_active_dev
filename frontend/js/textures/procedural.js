import { createCanvas, createCanvasTexture, createSeededRandom } from '../utils/canvas.js';

/*
 * Texturas generadas con canvas. Se muestran al instante mientras cargan las fotográficas
 * y quedan como respaldo si estas no están disponibles.
 */

/**
 * Genera texturas procedurales de alta resolución para la Tierra:
 * - Mapa difuso (océanos profundos, plataformas continentales, selvas, desiertos, cordilleras y polos)
 * - Mapa especular (brillo solar sobre océanos y cero brillo en tierra firme)
 * - Mapa de relieve bump (cordilleras y topografía continental)
 * - Mapa alfa de nubes (bandas ciclónicas y frentes nubosos)
 */
export function createEarthProceduralTextures(anisotropy) {
  const width = 1024;
  const height = 512;

  const { canvas: colorCanvas, ctx: ctx } = createCanvas(width, height);

  const { canvas: specCanvas, ctx: sCtx } = createCanvas(width, height);

  const { canvas: bumpCanvas, ctx: bCtx } = createCanvas(width, height);

  const { canvas: cloudCanvas, ctx: cCtx } = createCanvas(width, height);

  // 1. Océanos base (difuso = azul profundo, especular = blanco para reflejo solar)
  const oceanGrad = ctx.createLinearGradient(0, 0, 0, height);
  oceanGrad.addColorStop(0.0, '#103460');
  oceanGrad.addColorStop(0.25, '#0b2c59');
  oceanGrad.addColorStop(0.5, '#09254d');
  oceanGrad.addColorStop(0.75, '#0b2c59');
  oceanGrad.addColorStop(1.0, '#103460');
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, width, height);

  sCtx.fillStyle = '#d8d8d8';
  sCtx.fillRect(0, 0, width, height);

  bCtx.fillStyle = '#404040';
  bCtx.fillRect(0, 0, width, height);

  // Generador determinista para formas continentales naturales
  const rand = createSeededRandom(4242);

  // Masas continentales principales (América, Eurasia, África, Australia, Groenlandia)
  const landmasses = [
    // América del Norte
    { x: 225, y: 155, rx: 85, ry: 55, rot: -0.25, desert: false },
    { x: 255, y: 205, rx: 45, ry: 32, rot: 0.2, desert: true },
    // América del Sur
    { x: 315, y: 310, rx: 48, ry: 78, rot: 0.18, desert: false },
    // Groenlandia
    { x: 375, y: 78, rx: 38, ry: 22, rot: -0.2, ice: true },
    // África
    { x: 545, y: 265, rx: 62, ry: 78, rot: -0.08, desert: true },
    // Europa
    { x: 545, y: 148, rx: 55, ry: 34, rot: 0.1, desert: false },
    // Asia
    { x: 715, y: 155, rx: 135, ry: 68, rot: 0.06, desert: false },
    { x: 675, y: 215, rx: 68, ry: 35, rot: -0.1, desert: true },
    // Australia
    { x: 825, y: 345, rx: 46, ry: 30, rot: -0.15, desert: true }
  ];

  landmasses.forEach((land) => {
    // Plataforma continental costera turquesa en el océano
    ctx.save();
    ctx.translate(land.x, land.y);
    ctx.rotate(land.rot);
    const shelfGrad = ctx.createRadialGradient(0, 0, land.rx * 0.4, 0, 0, land.rx * 1.24);
    shelfGrad.addColorStop(0, 'rgba(20, 115, 165, 0.75)');
    shelfGrad.addColorStop(0.7, 'rgba(15, 85, 138, 0.45)');
    shelfGrad.addColorStop(1, 'rgba(11, 44, 89, 0)');
    ctx.fillStyle = shelfGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, land.rx * 1.24, land.ry * 1.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Sub-lóbulos orgánicos para costas irregulares
    const lobeCount = 26;
    for (let i = 0; i < lobeCount; i++) {
      const angle = (i / lobeCount) * Math.PI * 2;
      const distFactor = 0.25 + rand() * 0.58;
      const lx = land.x + Math.cos(angle + land.rot) * land.rx * distFactor;
      const ly = land.y + Math.sin(angle + land.rot) * land.ry * distFactor;
      const lr = (land.rx + land.ry) * (0.14 + rand() * 0.16);

      // Color del bioma
      const landGrad = ctx.createRadialGradient(lx, ly, lr * 0.1, lx, ly, lr);
      if (land.ice) {
        landGrad.addColorStop(0, '#f1f5f9');
        landGrad.addColorStop(0.85, '#cbd5e1');
        landGrad.addColorStop(1, 'rgba(203, 213, 225, 0)');
      } else if (land.desert && rand() > 0.35) {
        landGrad.addColorStop(0, '#c29b61');
        landGrad.addColorStop(0.65, '#8a7c46');
        landGrad.addColorStop(0.92, '#3b6e3c');
        landGrad.addColorStop(1, 'rgba(59, 110, 60, 0)');
      } else {
        landGrad.addColorStop(0, '#275931');
        landGrad.addColorStop(0.65, '#3b733e');
        landGrad.addColorStop(0.92, '#5c8a47');
        landGrad.addColorStop(1, 'rgba(92, 138, 71, 0)');
      }

      ctx.fillStyle = landGrad;
      ctx.beginPath();
      ctx.arc(lx, ly, lr, 0, Math.PI * 2);
      ctx.fill();

      // Quitar brillo especular sobre tierra firme
      sCtx.fillStyle = '#080808';
      sCtx.beginPath();
      sCtx.arc(lx, ly, lr * 0.94, 0, Math.PI * 2);
      sCtx.fill();

      // Elevación topográfica en mapa bump
      const bGrad = bCtx.createRadialGradient(lx, ly, lr * 0.1, lx, ly, lr);
      bGrad.addColorStop(0, '#dcdcdc');
      bGrad.addColorStop(0.7, '#9a9a9a');
      bGrad.addColorStop(1, 'rgba(64, 64, 64, 0)');
      bCtx.fillStyle = bGrad;
      bCtx.beginPath();
      bCtx.arc(lx, ly, lr, 0, Math.PI * 2);
      bCtx.fill();
    }
  });

  // Casquetes polares Ártico y Antártico
  const northIce = ctx.createLinearGradient(0, 0, 0, 38);
  northIce.addColorStop(0, '#f8fafc');
  northIce.addColorStop(0.7, 'rgba(241, 245, 249, 0.85)');
  northIce.addColorStop(1, 'rgba(241, 245, 249, 0)');
  ctx.fillStyle = northIce;
  ctx.fillRect(0, 0, width, 38);

  const southIce = ctx.createLinearGradient(0, height - 42, 0, height);
  southIce.addColorStop(0, 'rgba(241, 245, 249, 0)');
  southIce.addColorStop(0.3, 'rgba(241, 245, 249, 0.9)');
  southIce.addColorStop(1, '#f8fafc');
  ctx.fillStyle = southIce;
  ctx.fillRect(0, height - 42, width, 42);

  // 2. Capa de nubes procedurales (bandas atmosféricas y espirales ciclónicas)
  cCtx.clearRect(0, 0, width, height);
  for (let i = 0; i < 320; i++) {
    const cx = rand() * width;
    const cy = 28 + rand() * (height - 56);
    const rx = 18 + rand() * 68;
    const ry = 5 + rand() * 16;
    const rot = (rand() - 0.5) * 0.35;

    cCtx.save();
    cCtx.translate(cx, cy);
    cCtx.rotate(rot);
    const cloudGrad = cCtx.createRadialGradient(0, 0, 2, 0, 0, rx);
    cloudGrad.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
    cloudGrad.addColorStop(0.55, 'rgba(248, 250, 252, 0.35)');
    cloudGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    cCtx.fillStyle = cloudGrad;
    cCtx.beginPath();
    cCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    cCtx.fill();
    cCtx.restore();
  }

  return {
    colorMap: createCanvasTexture(colorCanvas, anisotropy, true),
    specularMap: createCanvasTexture(specCanvas, anisotropy),
    bumpMap: createCanvasTexture(bumpCanvas, anisotropy),
    cloudsMap: createCanvasTexture(cloudCanvas, anisotropy)
  };
}

/**
 * Genera texturas procedurales de alta definición para la Luna (mares basálticos y cráteres)
 */
export function createMoonProceduralTextures(anisotropy) {
  const width = 1024;
  const height = 512;

  const { canvas: colorCanvas, ctx: ctx } = createCanvas(width, height);

  const { canvas: bumpCanvas, ctx: bCtx } = createCanvas(width, height);

  ctx.fillStyle = '#9ca3af';
  ctx.fillRect(0, 0, width, height);

  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, width, height);

  const rand = createSeededRandom(9001);

  // Mares lunares (regiones oscuras de basalto)
  const maria = [
    { x: 340, y: 185, rx: 95, ry: 68 },
    { x: 455, y: 175, rx: 72, ry: 55 },
    { x: 530, y: 215, rx: 64, ry: 52 },
    { x: 270, y: 235, rx: 85, ry: 90 },
    { x: 420, y: 265, rx: 60, ry: 45 }
  ];

  maria.forEach((m) => {
    const grad = ctx.createRadialGradient(m.x, m.y, 10, m.x, m.y, m.rx);
    grad.addColorStop(0, 'rgba(65, 70, 78, 0.78)');
    grad.addColorStop(0.7, 'rgba(82, 88, 96, 0.45)');
    grad.addColorStop(1, 'rgba(156, 163, 175, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(m.x, m.y, m.rx, m.ry, 0.2, 0, Math.PI * 2);
    ctx.fill();
  });

  // Cráteres de impacto con bordes brillantes y relieve profundo
  for (let i = 0; i < 420; i++) {
    const cx = rand() * width;
    const cy = 18 + rand() * (height - 36);
    const r = 2 + Math.pow(rand(), 2.6) * 24;

    const cGrad = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    cGrad.addColorStop(0, 'rgba(72, 76, 84, 0.65)');
    cGrad.addColorStop(0.72, 'rgba(125, 130, 138, 0.35)');
    cGrad.addColorStop(0.9, 'rgba(229, 231, 235, 0.68)');
    cGrad.addColorStop(1, 'rgba(156, 163, 175, 0)');
    ctx.fillStyle = cGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    const bGrad = bCtx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    bGrad.addColorStop(0, 'rgba(25, 25, 25, 0.85)');
    bGrad.addColorStop(0.72, 'rgba(110, 110, 110, 0.5)');
    bGrad.addColorStop(0.9, 'rgba(245, 245, 245, 0.9)');
    bGrad.addColorStop(1, 'rgba(128, 128, 128, 0)');
    bCtx.fillStyle = bGrad;
    bCtx.beginPath();
    bCtx.arc(cx, cy, r, 0, Math.PI * 2);
    bCtx.fill();
  }

  return {
    colorMap: createCanvasTexture(colorCanvas, anisotropy, true),
    bumpMap: createCanvasTexture(bumpCanvas, anisotropy)
  };
}

/**
 * Genera texturas procedurales de alta definición para Marte:
 * tonos óxido/terracota, Valles Marineris, cráteres y casquetes polares blancos
 */
export function createMarsProceduralTextures(anisotropy) {
  const width = 1024;
  const height = 512;

  const { canvas: colorCanvas, ctx: ctx } = createCanvas(width, height);

  const { canvas: bumpCanvas, ctx: bCtx } = createCanvas(width, height);

  const baseGrad = ctx.createLinearGradient(0, 0, 0, height);
  baseGrad.addColorStop(0.0, '#d6b49c');
  baseGrad.addColorStop(0.15, '#c85a32');
  baseGrad.addColorStop(0.5, '#b84824');
  baseGrad.addColorStop(0.85, '#c4562e');
  baseGrad.addColorStop(1.0, '#d6b49c');
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, width, height);

  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, width, height);

  const rand = createSeededRandom(1337);

  // Regiones basálticas oscuras (Syrtis Major, Mare Erythraeum)
  const darkRegions = [
    { x: 240, y: 210, rx: 130, ry: 75, rot: -0.25 },
    { x: 460, y: 290, rx: 165, ry: 85, rot: 0.15 },
    { x: 690, y: 185, rx: 120, ry: 70, rot: 0.3 },
    { x: 840, y: 270, rx: 140, ry: 80, rot: -0.18 },
    { x: 120, y: 310, rx: 110, ry: 65, rot: 0.1 }
  ];

  darkRegions.forEach((reg) => {
    ctx.save();
    ctx.translate(reg.x, reg.y);
    ctx.rotate(reg.rot);
    const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, reg.rx);
    grad.addColorStop(0, 'rgba(82, 30, 16, 0.68)');
    grad.addColorStop(0.6, 'rgba(110, 42, 22, 0.38)');
    grad.addColorStop(1, 'rgba(110, 42, 22, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, reg.rx, reg.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // Mesetas brillantes de polvo ocre (Tharsis, Elysium)
  for (let i = 0; i < 45; i++) {
    const px = rand() * width;
    const py = 50 + rand() * (height - 100);
    const pr = 25 + rand() * 75;
    const pGrad = ctx.createRadialGradient(px, py, 3, px, py, pr);
    pGrad.addColorStop(0, 'rgba(228, 126, 74, 0.42)');
    pGrad.addColorStop(1, 'rgba(228, 126, 74, 0)');
    ctx.fillStyle = pGrad;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();

    const bGrad = bCtx.createRadialGradient(px, py, 3, px, py, pr);
    bGrad.addColorStop(0, 'rgba(185, 185, 185, 0.35)');
    bGrad.addColorStop(1, 'rgba(128, 128, 128, 0)');
    bCtx.fillStyle = bGrad;
    bCtx.beginPath();
    bCtx.arc(px, py, pr, 0, Math.PI * 2);
    bCtx.fill();
  }

  // Valles Marineris (gran cañón ecuatorial)
  ctx.save();
  ctx.strokeStyle = 'rgba(68, 22, 11, 0.74)';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(280, 268);
  ctx.bezierCurveTo(340, 278, 410, 262, 475, 274);
  ctx.stroke();

  bCtx.strokeStyle = 'rgba(20, 20, 20, 0.85)';
  bCtx.lineWidth = 9;
  bCtx.lineCap = 'round';
  bCtx.beginPath();
  bCtx.moveTo(280, 268);
  bCtx.bezierCurveTo(340, 278, 410, 262, 475, 274);
  bCtx.stroke();
  ctx.restore();

  // Cráteres marcianos con relieve
  for (let i = 0; i < 280; i++) {
    const cx = rand() * width;
    const cy = 36 + rand() * (height - 72);
    const r = 2 + Math.pow(rand(), 2.4) * 20;

    const cGrad = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    cGrad.addColorStop(0, 'rgba(92, 34, 18, 0.55)');
    cGrad.addColorStop(0.75, 'rgba(166, 72, 38, 0.25)');
    cGrad.addColorStop(0.92, 'rgba(232, 138, 86, 0.48)');
    cGrad.addColorStop(1, 'rgba(166, 72, 38, 0)');
    ctx.fillStyle = cGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    const bGrad = bCtx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    bGrad.addColorStop(0, 'rgba(35, 35, 35, 0.8)');
    bGrad.addColorStop(0.75, 'rgba(115, 115, 115, 0.45)');
    bGrad.addColorStop(0.9, 'rgba(235, 235, 235, 0.85)');
    bGrad.addColorStop(1, 'rgba(128, 128, 128, 0)');
    bCtx.fillStyle = bGrad;
    bCtx.beginPath();
    bCtx.arc(cx, cy, r, 0, Math.PI * 2);
    bCtx.fill();
  }

  // Casquetes polares blancos (Norte y Sur)
  const northCap = ctx.createLinearGradient(0, 0, 0, 44);
  northCap.addColorStop(0, 'rgba(255, 250, 245, 0.96)');
  northCap.addColorStop(0.55, 'rgba(248, 236, 226, 0.78)');
  northCap.addColorStop(1, 'rgba(248, 236, 226, 0)');
  ctx.fillStyle = northCap;
  ctx.fillRect(0, 0, width, 44);

  const southCap = ctx.createLinearGradient(0, height - 36, 0, height);
  southCap.addColorStop(0, 'rgba(248, 236, 226, 0)');
  southCap.addColorStop(0.45, 'rgba(248, 236, 226, 0.75)');
  southCap.addColorStop(1, 'rgba(255, 250, 245, 0.95)');
  ctx.fillStyle = southCap;
  ctx.fillRect(0, height - 36, width, 36);

  return {
    colorMap: createCanvasTexture(colorCanvas, anisotropy, true),
    bumpMap: createCanvasTexture(bumpCanvas, anisotropy)
  };
}
