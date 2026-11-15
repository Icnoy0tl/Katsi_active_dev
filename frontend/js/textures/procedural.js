import {
  createCanvas,
  createCanvasTexture,
  createSeededRandom,
  fillCanvas,
  fillCircle,
  fillRadialSpot,
  withStops
} from '../utils/canvas.js';

/*
 * Texturas generadas con canvas. Se muestran al instante mientras cargan las fotográficas
 * y quedan como respaldo si estas no están disponibles.
 */

const WIDTH = 1024;
const HEIGHT = 512;

/** Banda horizontal a todo lo ancho con degradado vertical (casquetes polares) */
function fillBand(ctx, y, height, stops) {
  ctx.fillStyle = withStops(ctx.createLinearGradient(0, y, 0, y + height), stops);
  ctx.fillRect(0, y, WIDTH, height);
}

/** Elipse con degradado radial, girada `rotation` alrededor de su centro */
function fillRadialEllipse(ctx, { x, y, rx, ry, rotation }, innerRadius, outerRadius, stops) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = withStops(ctx.createRadialGradient(0, 0, innerRadius, 0, 0, outerRadius), stops);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Degradados de cada bioma terrestre */
const BIOME_STOPS = {
  ice: [[0, '#f1f5f9'], [0.85, '#cbd5e1'], [1, 'rgba(203, 213, 225, 0)']],
  desert: [[0, '#c29b61'], [0.65, '#8a7c46'], [0.92, '#3b6e3c'], [1, 'rgba(59, 110, 60, 0)']],
  forest: [[0, '#275931'], [0.65, '#3b733e'], [0.92, '#5c8a47'], [1, 'rgba(92, 138, 71, 0)']]
};

/**
 * Genera texturas procedurales de alta resolución para la Tierra:
 * - Mapa difuso (océanos profundos, plataformas continentales, selvas, desiertos, cordilleras y polos)
 * - Mapa especular (brillo solar sobre océanos y cero brillo en tierra firme)
 * - Mapa de relieve bump (cordilleras y topografía continental)
 * - Mapa alfa de nubes (bandas ciclónicas y frentes nubosos)
 */
export function createEarthProceduralTextures(anisotropy) {
  const { canvas: colorCanvas, ctx } = createCanvas(WIDTH, HEIGHT);
  const { canvas: specCanvas, ctx: sCtx } = createCanvas(WIDTH, HEIGHT);
  const { canvas: bumpCanvas, ctx: bCtx } = createCanvas(WIDTH, HEIGHT);
  const { canvas: cloudCanvas, ctx: cCtx } = createCanvas(WIDTH, HEIGHT);

  // 1. Océanos base (difuso = azul profundo, especular = blanco para reflejo solar)
  fillCanvas(
    ctx,
    withStops(ctx.createLinearGradient(0, 0, 0, HEIGHT), [
      [0.0, '#103460'],
      [0.25, '#0b2c59'],
      [0.5, '#09254d'],
      [0.75, '#0b2c59'],
      [1.0, '#103460']
    ])
  );
  fillCanvas(sCtx, '#d8d8d8');
  fillCanvas(bCtx, '#404040');

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
    fillRadialEllipse(
      ctx,
      { x: land.x, y: land.y, rx: land.rx * 1.24, ry: land.ry * 1.24, rotation: land.rot },
      land.rx * 0.4,
      land.rx * 1.24,
      [[0, 'rgba(20, 115, 165, 0.75)'], [0.7, 'rgba(15, 85, 138, 0.45)'], [1, 'rgba(11, 44, 89, 0)']]
    );

    // Sub-lóbulos orgánicos para costas irregulares
    const lobeCount = 26;
    for (let i = 0; i < lobeCount; i++) {
      const angle = (i / lobeCount) * Math.PI * 2;
      const distFactor = 0.25 + rand() * 0.58;
      const lx = land.x + Math.cos(angle + land.rot) * land.rx * distFactor;
      const ly = land.y + Math.sin(angle + land.rot) * land.ry * distFactor;
      const lr = (land.rx + land.ry) * (0.14 + rand() * 0.16);

      // El sorteo del desierto solo se hace en masas desérticas (conserva la secuencia aleatoria)
      const biome = land.ice ? 'ice' : land.desert && rand() > 0.35 ? 'desert' : 'forest';
      fillRadialSpot(ctx, lx, ly, lr * 0.1, lr, BIOME_STOPS[biome]);

      // Quitar brillo especular sobre tierra firme
      fillCircle(sCtx, lx, ly, lr * 0.94, '#080808');

      // Elevación topográfica en mapa bump
      fillRadialSpot(bCtx, lx, ly, lr * 0.1, lr, [[0, '#dcdcdc'], [0.7, '#9a9a9a'], [1, 'rgba(64, 64, 64, 0)']]);
    }
  });

  // Casquetes polares Ártico y Antártico
  fillBand(ctx, 0, 38, [[0, '#f8fafc'], [0.7, 'rgba(241, 245, 249, 0.85)'], [1, 'rgba(241, 245, 249, 0)']]);
  fillBand(ctx, HEIGHT - 42, 42, [[0, 'rgba(241, 245, 249, 0)'], [0.3, 'rgba(241, 245, 249, 0.9)'], [1, '#f8fafc']]);

  // 2. Capa de nubes procedurales (bandas atmosféricas y espirales ciclónicas)
  for (let i = 0; i < 320; i++) {
    const x = rand() * WIDTH;
    const y = 28 + rand() * (HEIGHT - 56);
    const rx = 18 + rand() * 68;
    const ry = 5 + rand() * 16;
    const rotation = (rand() - 0.5) * 0.35;
    fillRadialEllipse(cCtx, { x, y, rx, ry, rotation }, 2, rx, [
      [0, 'rgba(255, 255, 255, 0.72)'],
      [0.55, 'rgba(248, 250, 252, 0.35)'],
      [1, 'rgba(255, 255, 255, 0)']
    ]);
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
  const { canvas: colorCanvas, ctx } = createCanvas(WIDTH, HEIGHT);
  const { canvas: bumpCanvas, ctx: bCtx } = createCanvas(WIDTH, HEIGHT);

  fillCanvas(ctx, '#9ca3af');
  fillCanvas(bCtx, '#808080');

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
    ctx.fillStyle = withStops(ctx.createRadialGradient(m.x, m.y, 10, m.x, m.y, m.rx), [
      [0, 'rgba(65, 70, 78, 0.78)'],
      [0.7, 'rgba(82, 88, 96, 0.45)'],
      [1, 'rgba(156, 163, 175, 0)']
    ]);
    ctx.beginPath();
    ctx.ellipse(m.x, m.y, m.rx, m.ry, 0.2, 0, Math.PI * 2);
    ctx.fill();
  });

  // Cráteres de impacto con bordes brillantes y relieve profundo
  for (let i = 0; i < 420; i++) {
    const x = rand() * WIDTH;
    const y = 18 + rand() * (HEIGHT - 36);
    const r = 2 + Math.pow(rand(), 2.6) * 24;

    fillRadialSpot(ctx, x, y, r * 0.1, r, [
      [0, 'rgba(72, 76, 84, 0.65)'],
      [0.72, 'rgba(125, 130, 138, 0.35)'],
      [0.9, 'rgba(229, 231, 235, 0.68)'],
      [1, 'rgba(156, 163, 175, 0)']
    ]);
    fillRadialSpot(bCtx, x, y, r * 0.1, r, [
      [0, 'rgba(25, 25, 25, 0.85)'],
      [0.72, 'rgba(110, 110, 110, 0.5)'],
      [0.9, 'rgba(245, 245, 245, 0.9)'],
      [1, 'rgba(128, 128, 128, 0)']
    ]);
  }

  return {
    colorMap: createCanvasTexture(colorCanvas, anisotropy, true),
    bumpMap: createCanvasTexture(bumpCanvas, anisotropy)
  };
}

/** Valles Marineris (gran cañón ecuatorial) */
function strokeVallesMarineris(ctx, strokeStyle, lineWidth) {
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(280, 268);
  ctx.bezierCurveTo(340, 278, 410, 262, 475, 274);
  ctx.stroke();
}

/**
 * Genera texturas procedurales de alta definición para Marte:
 * tonos óxido/terracota, Valles Marineris, cráteres y casquetes polares blancos
 */
export function createMarsProceduralTextures(anisotropy) {
  const { canvas: colorCanvas, ctx } = createCanvas(WIDTH, HEIGHT);
  const { canvas: bumpCanvas, ctx: bCtx } = createCanvas(WIDTH, HEIGHT);

  fillCanvas(
    ctx,
    withStops(ctx.createLinearGradient(0, 0, 0, HEIGHT), [
      [0.0, '#d6b49c'],
      [0.15, '#c85a32'],
      [0.5, '#b84824'],
      [0.85, '#c4562e'],
      [1.0, '#d6b49c']
    ])
  );
  fillCanvas(bCtx, '#808080');

  const rand = createSeededRandom(1337);

  // Regiones basálticas oscuras (Syrtis Major, Mare Erythraeum)
  const darkRegions = [
    { x: 240, y: 210, rx: 130, ry: 75, rotation: -0.25 },
    { x: 460, y: 290, rx: 165, ry: 85, rotation: 0.15 },
    { x: 690, y: 185, rx: 120, ry: 70, rotation: 0.3 },
    { x: 840, y: 270, rx: 140, ry: 80, rotation: -0.18 },
    { x: 120, y: 310, rx: 110, ry: 65, rotation: 0.1 }
  ];

  darkRegions.forEach((region) => {
    fillRadialEllipse(ctx, region, 10, region.rx, [
      [0, 'rgba(82, 30, 16, 0.68)'],
      [0.6, 'rgba(110, 42, 22, 0.38)'],
      [1, 'rgba(110, 42, 22, 0)']
    ]);
  });

  // Mesetas brillantes de polvo ocre (Tharsis, Elysium)
  for (let i = 0; i < 45; i++) {
    const x = rand() * WIDTH;
    const y = 50 + rand() * (HEIGHT - 100);
    const r = 25 + rand() * 75;
    fillRadialSpot(ctx, x, y, 3, r, [[0, 'rgba(228, 126, 74, 0.42)'], [1, 'rgba(228, 126, 74, 0)']]);
    fillRadialSpot(bCtx, x, y, 3, r, [[0, 'rgba(185, 185, 185, 0.35)'], [1, 'rgba(128, 128, 128, 0)']]);
  }

  strokeVallesMarineris(ctx, 'rgba(68, 22, 11, 0.74)', 8);
  strokeVallesMarineris(bCtx, 'rgba(20, 20, 20, 0.85)', 9);

  // Cráteres marcianos con relieve
  for (let i = 0; i < 280; i++) {
    const x = rand() * WIDTH;
    const y = 36 + rand() * (HEIGHT - 72);
    const r = 2 + Math.pow(rand(), 2.4) * 20;

    fillRadialSpot(ctx, x, y, r * 0.1, r, [
      [0, 'rgba(92, 34, 18, 0.55)'],
      [0.75, 'rgba(166, 72, 38, 0.25)'],
      [0.92, 'rgba(232, 138, 86, 0.48)'],
      [1, 'rgba(166, 72, 38, 0)']
    ]);
    fillRadialSpot(bCtx, x, y, r * 0.1, r, [
      [0, 'rgba(35, 35, 35, 0.8)'],
      [0.75, 'rgba(115, 115, 115, 0.45)'],
      [0.9, 'rgba(235, 235, 235, 0.85)'],
      [1, 'rgba(128, 128, 128, 0)']
    ]);
  }

  // Casquetes polares blancos (Norte y Sur)
  fillBand(ctx, 0, 44, [[0, 'rgba(255, 250, 245, 0.96)'], [0.55, 'rgba(248, 236, 226, 0.78)'], [1, 'rgba(248, 236, 226, 0)']]);
  fillBand(ctx, HEIGHT - 36, 36, [[0, 'rgba(248, 236, 226, 0)'], [0.45, 'rgba(248, 236, 226, 0.75)'], [1, 'rgba(255, 250, 245, 0.95)']]);

  return {
    colorMap: createCanvasTexture(colorCanvas, anisotropy, true),
    bumpMap: createCanvasTexture(bumpCanvas, anisotropy)
  };
}
