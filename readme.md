# Frontend — Escena 3D (Tierra, Luna, Marte, satélite y cápsula Orión)

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
  menu.js                Menú principal (Orión de fondo, opciones a la izquierda)
  menuTour.js            Recorrido automático de cámara detrás del menú (Orión → Luna → Marte)
  camera.js              Destinos de cámara y vuelo entre cuerpos
  lighting.js            Luz que acompaña a la cámara
  bodies/                Tierra, Luna, Marte, estrellas y atmósferas
  satellite/             Modelo, texturas y animación del satélite
  orion/                 Cápsula tipo Orión (modelo, texturas y alas solares)
  utils/environment.js   Mapa de entorno compartido para reflejos metálicos
  textures/              Texturas procedurales (respaldo) y fotográficas
  utils/canvas.js        Utilidades de canvas compartidas
textures/                Mapas fotográficos 4K
```
