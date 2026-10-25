# Arquitectura técnica

Este documento explica cómo funciona iMuseum por dentro. Para usarlo, ver el
[README](../README.md).

## Visión general

```
 carpeta en disco ──► escaneo (Node) ──► obras {id, tipo, carpeta, tamaño, fecha}
                                              │
                                              ▼
                     agrupación ──► colecciones (una o más por carpeta)
                                              │
                                              ▼
                     distribución ──► galería → alas → salas (solo datos)
                                              │
              ┌───────────────────────────────┼──────────────────────────────┐
              ▼                               ▼                              ▼
     física (siempre):              mallas (bajo demanda):          multimedia (bajo demanda):
     colisiones + suelos            salas a < ~60 m                 texturas, videos, audios
     en rejillas espaciales         se construyen/destruyen         por imuseum:// con rangos
```

La app es Electron + Three.js. El proceso principal (Node) escanea y sirve archivos; el
proceso de renderizado construye y dibuja el museo. Lo mismo funciona en un navegador
sin Electron (con las limitaciones del navegador).

## 1. Escaneo — `electron/scan.cjs`

- Recorre el árbol con `fs.promises.opendir` (pila, sin recursión profunda) y **nunca abre
  los archivos**: solo `stat` para tamaño y fecha.
- Ignora ocultos (`.algo`), enlaces simbólicos (evita ciclos) y carpetas de sistema
  (`node_modules`, `$RECYCLE.BIN`, `@eaDir`…, ver `shared/media-types.json`).
- Las rutas reales se quedan en el proceso principal. El renderizado solo recibe un **id**
  por archivo; no puede pedir rutas arbitrarias.
- Envía progreso cada 150 ms y se puede cancelar.

### Escaneos guardados e incrementales

- Cada escaneo se guarda en `userData/scans/<sha1(ruta)>.json.gz` como un mapa
  `carpeta → { fecha de modificación, archivos [nombre, tamaño, fecha], subcarpetas }`.
- Al reabrir, el museo se construye con ese mapa sin tocar el disco. Después, `rescan` vuelve
  a recorrer el árbol haciendo un único `stat` por carpeta: si su fecha de modificación no
  cambió, su lista sigue siendo válida (en los sistemas de archivos habituales la fecha de
  una carpeta cambia al añadir, borrar o renombrar algo dentro). Solo se releen las que
  cambiaron.
- Los **ids** de los archivos son estables por ruta durante la sesión, así el museo abierto
  sigue sirviendo sus archivos mientras se comprueba si hubo cambios.
- Limitación: un archivo modificado sin cambiar de nombre no altera la fecha de su carpeta;
  se detecta la próxima vez que esa carpeta se relea.

## 2. Protocolo `imuseum://` — `electron/main.cjs`

Un único esquema privilegiado (`standard`, `secure`, `stream`) sirve:

| Ruta | Contenido |
|---|---|
| `imuseum://app/…` | La app compilada (`dist/`) |
| `imuseum://app/__media/<id>` | El archivo original, con soporte de `Range` (respuestas 206) |
| `imuseum://app/__thumb/<id>?s=<px>` | Miniatura en caché para esa resolución (404 si no existe); `s=400` es el fotograma de un video |

Los videos y audios se reproducen leyendo trozos del disco según avanzan; nada se carga
entero en memoria.

## 3. Agrupación — `src/scanner.js`

- Cada carpeta con multimedia es una **colección**. Si sus obras de pared superan 150 m de
  pared (≈48 cuadros) se reparte en varias («Fotos (2/3)»); los audios, en grupos de 9.
- El orden es natural (`Foto 2` antes que `Foto 10`) y por carpeta de primer nivel, que
  define el ala.

## 4. Distribución — `src/layout.js` y `src/architecture.js`

### Jerarquía

- **Galería principal** a lo largo del eje Z.
- **Alas** a ambos lados (este/oeste): una por carpeta de primer nivel; las pequeñas
  comparten ala y las de más de 16 salas se reparten.
- **Salas** a ambos lados del pasillo de cada ala. Entre parejas de salas el pasillo puede
  subir o bajar 1,2 m (hasta ±2,4 m) con una escalera de ancho completo.

Todas las transformaciones son traslaciones más rotaciones de 0 o 180° alrededor de Y, así
que cualquier caja local sigue siendo una caja alineada a los ejes en el mundo. Eso
simplifica colisiones y búsquedas espaciales.

### Pisos de la galería

Con más alas que «Alas por piso» (Ajustes), la galería principal se repite en pisos
separados 22 m (cabe una torre de 3 pisos sobre un pasillo elevado sin tocar el piso de
arriba). Todos comparten el vestíbulo, donde está la cabina del ascensor. La distancia para
construir salas pondera la separación vertical ×4, así no se construyen las de otros pisos.

### Tipos de sala como datos

Cada tipo (`classic`, `sunken`, `mezzanine`, `panels`, `tower2`, `tower3`) es una función
`(W, D, opciones) → Spec`, en coordenadas locales (puerta en z = 0, suelo del pasillo en y = 0):

| Campo | Qué describe |
|---|---|
| `boxes` | Sólidos alineados a ejes: paredes, forjados, peldaños, tarimas. Con material (o uno por cara), `collide`, `ray` (tapa la mira) y `walk` (se camina encima) |
| `ramps` | Superficies inclinadas para caminar por escaleras |
| `colliders` | Cajas invisibles: barandillas, columnas, bancos |
| `oboxes` | Piezas giradas solo decorativas (pasamanos y vidrios inclinados) |
| `lines` | Tramos de pared donde se cuelgan obras, con su altura de suelo y sentido de lectura |
| `lights`, `columns`, `pedArea`, `levels`, `entry` | Luces del techo, columnas, zona para gramófonos, nombres de pisos, punto de entrada |

`layout.js` elige el tipo según los metros de pared necesarios (con un hash del nombre de
la carpeta para variar entre salas parecidas), hace crecer la sala de 2 en 2 m hasta que
caben las obras y los gramófonos, y reparte las obras por las líneas en orden de lectura.

## 5. Construcción bajo demanda — `src/museum.js`

- Al crear el museo solo se registran **datos de física**: colisiones (cajas 3D) y suelos
  (planos y rampas), cada uno en una **rejilla espacial** de 16 m. El jugador consulta solo
  las celdas cercanas.
- Cada 0,2 s se calcula la distancia a cada sala y ala:

  | Distancia (por defecto) | Qué ocurre |
  |---|---|
  | < 62 m | Se construyen las mallas (con un presupuesto de 6 ms por fotograma) |
  | < 16 m | Se activan cuadros y gramófonos: texturas y audio |
  | < 38 m | Se preparan las pantallas de video |
  | > 85 m | Se destruye todo y se libera la GPU |

  Las distancias derivan de los ajustes (`src/settings.js → distances()`) y siempre son
  coherentes entre sí.
- `meshbuilder.js` fusiona todas las cajas de una sala en **una malla por material**, con UV
  en coordenadas absolutas (madera, mármol y yeso continúan sin cortes). Una sala con
  decenas de peldaños son unas pocas llamadas de dibujo.

## 6. Obras — `src/exhibits.js` y `src/textures.js`

- **Imágenes**: `createImageBitmap` decodifica y reduce fuera del hilo principal. En la app de
  escritorio, la versión reducida se guarda en WebP en la caché (clave: ruta + tamaño + fecha
  + resolución) y la próxima vez se carga directamente.
- **Videos**: un `<video>` por pantalla preparada; se reproducen los N más cercanos (ajuste).
  El sonido usa `PositionalAudio`.
- **Audios**: `<audio>` + `PositionalAudio` + `AnalyserNode` para el visualizador.
- Las cartelas son texturas de canvas creadas al activar la sala y liberadas al desactivarla.

### Fotogramas de video

La primera vez que una pantalla reproduce su video se captura un fotograma real (pasado el
primer segundo, que suele ser negro) y se guarda como miniatura de 400 px. Al construir una
sala, las pantallas cargan ese fotograma y lo muestran —y emiten su color, atenuado— hasta
que el visitante se acerca lo bastante para reproducir el video.

### Formatos especiales y EXIF — `src/convert.js`, `src/convert.worker.js`, `src/exif.js`

- **EXIF**: se leen los primeros 256 KB (JPEG: segmento APP1; TIFF y RAW basados en TIFF:
  directamente; CR3: caja CMT1). En HEIC el EXIF suele ir al final del archivo: se localiza con
  la tabla de elementos de la caja `meta` (`iinf` + `iloc`) y se pide solo ese trozo.
- **HEIC/HEIF**: se decodifica con libheif (WebAssembly) en un Web Worker; la librería se carga
  como archivo aparte la primera vez que hace falta.
- **RAW**: en el worker se busca la mayor vista previa JPEG incrustada (base o progresiva; se
  descartan los JPEG sin pérdida que algunas cámaras usan para los datos del sensor) y se
  aplica la orientación del RAW si la vista previa no trae la suya.
- El visor a pantalla completa usa una versión JPEG convertida (se guardan las 12 últimas).

## 7. Iluminación — `src/lighting.js`

- La luz ambiental (ajuste) controla la luz hemisférica, el entorno y el brillo de techos y
  paneles de luz.
- Cada obra tiene un **color de luz**: media de la imagen (8×8 píxeles, realzada en
  saturación), del fotograma actual en los videos (cada 120 ms, suavizado) o del disco en los
  gramófonos (modulada por el volumen).
- Ese color se pinta en un **halo** aditivo sobre la pared y un **charco** en el suelo.
- `ArtLights` mantiene una reserva fija de N `PointLight` (ajuste «Luces dinámicas»). Cada
  0,15 s las asigna a las obras más cercanas y que están delante de la cámara, y las funde
  al cambiar de obra. Como el número de luces no cambia al caminar, los shaders no se
  recompilan.

## 8. Jugador — `src/player.js`

- Movimiento en el plano con aceleración suave; **Shift** multiplica la velocidad por 2,2.
- **Suelo**: la superficie más alta bajo los pies que esté a menos de 0,6 m por encima. Sube
  peldaños y rampas, baja pegado a ellas y cae con gravedad si no hay suelo. Si cae por
  debajo de −40 m vuelve al último punto seguro.
- **Colisiones**: círculo de 0,35 m contra cajas que se cruzan con la franja vertical del
  cuerpo (de 0,5 m sobre los pies hasta la cabeza). Así se pasa por debajo de un balcón pero
  no a través de una barandilla.

## 9. Visita guiada y mando — `src/tour.js`, `src/gamepad.js`

- La visita calcula sus paradas con los datos de la sala (no necesita que esté construida):
  la entrada y, para cada obra, un punto delante de ella a la altura de los ojos. La cámara
  se desliza entre paradas cercanas y usa un fundido a negro en saltos largos o con cambio
  de nivel, para no atravesar paredes ni forjados. Al salir, el visitante queda de pie en el
  suelo más cercano.
- El mando usa la Gamepad API (distribución estándar). En «modo mando» no se captura el
  ratón: el jugador se mueve con el stick (velocidad proporcional) y todas las pantallas
  (pausa, directorio, ascensor, visor, ajustes, visita) responden a los botones.

## 10. Ajustes — `src/settings.js`

Un esquema único define cada ajuste (tipo, rango, valor por defecto, ayuda). La pantalla de
Ajustes se genera a partir de él, los valores se validan al cargar y se guardan en
`localStorage` (en la app de escritorio vive en la carpeta de datos de la app). Los cambios
se aplican en vivo mediante `onSettingsChange`.

## 11. Actualizaciones y publicación

Ver [FIRMA-Y-ACTUALIZACIONES.md](FIRMA-Y-ACTUALIZACIONES.md).

## 12. Pruebas y capturas

`scripts/lib/electron-cdp.mjs` arranca la app con una carpeta de datos temporal y la
controla por el protocolo de DevTools. Lo usan:

- `scripts/selftest.mjs`: prueba de extremo a extremo con 19 comprobaciones sobre una copia
  temporal de la demo más archivos HEIC/RAW/EXIF generados por `scripts/make-fixtures.sh`.
- `scripts/screenshots.mjs`: construye un museo de muestra con la demo y captura las vistas
  de `docs/screenshots`.

La app expone dos ganchos para estas pruebas: `window.__imuseumOpen(ruta)` y
`window.__imuseumBuild(resultado)`.
