# Checklist de lanzamiento

## Publicación y SEO
- [ ] **robots.txt** en la raíz. Mientras sea un deploy de prueba: `Disallow: /`. En producción: permitir todo y agregar `Sitemap: https://<dominio>/sitemap.xml`.
- [ ] **sitemap.xml** con la URL final (es una sola página, así que basta una entrada).
- [x] **Meta tags** en `index.html`: `description`, `theme-color`, `color-scheme`.
- [ ] `canonical` y `og:url`: ya están comentados en `index.html`, falta poner el dominio.
- [x] **Open Graph / Twitter Card**: título y descripción listos.
- [ ] **`og:image`** de 1200×630: hacer una captura real de la escena, guardarla en `frontend/icons/og-image.jpg` y descomentar las líneas en `index.html` (necesita URL absoluta, o sea, el dominio).
- [x] **Favicon**: `frontend/icons/favicon.svg` + `apple-touch-icon.png` de 180×180.
- [x] `<title>` descriptivo: "Katsí · Earth analogs for Moon and Mars base sites".


- [ ] **Quitar `cdn.tailwindcss.com`**: es el Play CDN, que compila en el navegador y no está pensado para producción (bloquea el render y pesa ~300 KB de JS). Generar un CSS estático con el CLI de Tailwind.
- [x] **Comprimir texturas** a WebP (−34 %: 8.6 → 5.7 MB). Calidad 82 general, 92 en el normal map, 75 en Luna y nubes (error medio < 4/255).
- [ ] Versiones 2K para móvil: las 4K de la Luna (1.9 MB) y las nubes (1.6 MB) siguen siendo las más pesadas.
- [x] Carga por prioridad: primero la Tierra (0.8 MB) y después nubes, Luna y Marte. No se difieren hasta la misión porque el recorrido del menú las muestra a los pocos segundos.
- [x] `pixelRatio` del renderer limitado a 2 (ya estaba en `main.js`).
- [ ] Cache headers largos para `textures/` y `js/` en el hosting.

## Calidad
- [ ] Probar en Chrome, Safari y Firefox, y en un celular real (touch, orientación).
- [ ] Fallback si no hay WebGL (mensaje en vez de pantalla negra).
- [ ] Pantalla de carga mientras bajan las texturas.
- [ ] Consola sin errores ni warnings.
- [ ] Revisar el contraste y que la UI se pueda usar con teclado (Lighthouse → Accessibility).
- [ ] Fijar versiones exactas de los CDN (Three.js ya está en `0.164.1`).

## Extra
- [ ] README de raíz con descripción, demo en vivo, capturas y cómo correrlo localmente.
- [ ] Analítica ligera, si interesa medir visitas (Plausible, GoatCounter).
