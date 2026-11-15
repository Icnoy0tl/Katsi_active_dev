# Checklist de lanzamiento

## Publicación y SEO
- [x] **robots.txt** en la raíz, apuntando a `https://katsi.onrender.com/sitemap.xml`. Si es un deploy de prueba, cambiar a `Disallow: /`.
- [x] **sitemap.xml** en la raíz con una sola entrada (`https://katsi.onrender.com/`).
- [x] **Meta tags** en `index.html`: `description`, `theme-color`, `color-scheme`.
- [x] `canonical` y `og:url` con `https://katsi.onrender.com/`.
- [x] **Open Graph / Twitter Card**: título y descripción listos.
- [x] **`og:image`** / `twitter:image` de 1200×630 en `frontend/icons/og-image.jpg` (93 KB), con tamaño y `alt`.
- [x] **API en `https://katsi-api.onrender.com`**: `config.js` la usa fuera de localhost; CORS en `backend/main.go` acepta `https://katsi.onrender.com` (o la lista de `ALLOWED_ORIGIN`, separada por comas) y localhost.
- [x] **Despertar la API** (plan gratuito de Render): al cargar, el front llama a `GET /api/health`; las peticiones esperan a que responda (máx. 60 s) antes de contar su timeout.
- [x] **Favicon**: `frontend/icons/favicon.svg` + `apple-touch-icon.png` de 180×180.
- [x] `<title>` descriptivo: "Katsí · Earth analogs for Moon and Mars base sites".


- [x] **Quitar `cdn.tailwindcss.com`**: sustituido por `frontend/css/tailwind.css` (Tailwind 3.4.17, 8.6 KB, 2.4 KB con gzip) en vez de 407 KB de JS que compilaba en el navegador. Se regenera con `npm run build:css` si se añaden clases de Tailwind (ver `tailwind.config.js`).
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
