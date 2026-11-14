# Frontend — Escena 3D (Tierra, Luna, Marte y satélite)

## Cómo ejecutarlo

El código está dividido en módulos ES (`js/`), así que la página debe servirse por HTTP
(abrir `index.html` con doble clic no funciona):

```bash
npx serve .          # o la extensión Live Server de VS Code
```

## Estructura

```
index.html               Interfaz (panel de control) y punto de entrada
js/
  main.js                Renderizador, escena, bucle de animación
  config.js              Dimensiones, posiciones, velocidades y URLs de texturas
  state.js               Estado compartido entre panel y animación
  ui.js                  Eventos del panel de control
  camera.js              Destinos de cámara y vuelo entre cuerpos
  lighting.js            Luz que acompaña a la cámara
  bodies/                Tierra, Luna, Marte, estrellas y atmósferas
  satellite/             Modelo, texturas y animación del satélite
  textures/              Texturas procedurales (respaldo) y fotográficas
  utils/canvas.js        Utilidades de canvas compartidas
textures/                Mapas fotográficos 4K
```
