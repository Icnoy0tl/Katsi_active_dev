/**
 * Tailwind v3 (la misma versión que servía cdn.tailwindcss.com). Solo se generan las clases que
 * aparecen en estos archivos: si añades clases de Tailwind en otro sitio, agrégalo aquí y vuelve
 * a ejecutar `npm run build:css`.
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./index.html', './frontend/js/**/*.js']
};
