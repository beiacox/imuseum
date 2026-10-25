# Cambios

## 0.3.0 — 2026-10

Todo lo que estaba en la hoja de ruta de la 0.2.0.

### Colecciones enormes
- **Escaneos guardados**: reabrir una carpeta es instantáneo; los cambios se buscan en
  segundo plano releyendo solo las carpetas modificadas, y **U** actualiza el museo sin
  perder la sala actual.
- **Galería de varios pisos con ascensor** cuando hay muchas alas (ajustable).
- **Fotogramas en las pantallas lejanas**, guardados en la caché la primera vez que se ve
  cada video.

### Fotos
- **EXIF** en cartelas y visor: cámara, objetivo, fecha de captura, diafragma, velocidad,
  ISO y focal (JPEG, TIFF, RAW, HEIC y CR3).
- **HEIC/HEIF** decodificados con libheif (WebAssembly, en un worker).
- **RAW** (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, PEF…) mediante su vista previa JPEG
  incrustada, con la orientación correcta.

### Recorrido
- **Visita guiada** (G o X en el mando): recorre las salas, se detiene ante cada obra y
  reproduce videos y audios.
- **Mando** (Xbox/PlayStation): caminar, mirar e interactuar en todas las pantallas sin ratón.

### Ajustes
- **Arquitectura**: frecuencia de desniveles, activar o desactivar cada tipo de sala y alas
  por piso, con botón «Reconstruir museo».
- **Visita guiada**, **mando**, **escaneo**, **EXIF** y **actualizaciones**.

### Distribución
- **Actualizaciones automáticas** desde GitHub Releases (AppImage, Windows, macOS; el .deb
  avisa y abre la página de descargas).
- **Flujo de GitHub Actions** que compila Linux, Windows y macOS al subir una etiqueta y deja
  un borrador de release; **firma de código** opcional mediante secretos del repositorio.

## 0.2.0 — 2026-10

Primera versión publicada.

### App de escritorio
- App Electron instalable (AppImage y .deb para Linux).
- Escaneo nativo de la carpeta sin leer su contenido, con progreso y cancelación.
- Multimedia servida por `imuseum://` con streaming por rangos.
- Caché de miniaturas en disco, con tamaño visible y botón para vaciarla.
- Carpetas recientes, con opción de quitar una o borrar todo el historial.
- «Mostrar en la carpeta» desde el visor.

### Museo
- Galería principal con columnata y lucernario, alas por carpeta de primer nivel y pasillos
  con desniveles.
- Cinco tipos de sala: clásica, hundida, de paneles, doble altura con entreplanta y torres de
  2 o 3 pisos.
- Física con suelos, rampas, escaleras, gravedad y colisiones por altura.
- Construcción y destrucción de salas según la distancia; probado con 76.000 archivos.

### Obras e iluminación
- Cuadros, pantallas de video con sonido 3D y gramófonos con visualizador.
- Museo a oscuras: cada obra emite el color de su imagen o de su fotograma actual, con luces
  dinámicas reales para las más cercanas.

### Ajustes
- Pantalla de ajustes con persistencia: videos simultáneos y distancia, iluminación,
  distancias de carga y de visión, resolución, calidad, controles, volumen, minimapa y FPS.
