#!/usr/bin/env bash
# Genera archivos de prueba de formatos especiales en la carpeta indicada:
#   exif.jpg   JPEG con datos de cámara (EXIF)
#   foto.heic  HEIC con EXIF al final del archivo (como los de iPhone editados)
#   prueba.nef «RAW» sintético: cabecera TIFF con EXIF y orientación vertical, datos del
#              sensor en JPEG sin pérdida (deben descartarse) y la vista previa JPEG
# Requiere ImageMagick (magick), exiftool y heif-enc (libheif).
set -euo pipefail
OUT=${1:?uso: make-fixtures.sh carpeta}
SRC=${2:-public/demo/Fractales/Mandelbrot 2.jpg}
mkdir -p "$OUT"
magick "$SRC" -resize 1600x1200 "$OUT/exif.jpg"
exiftool -q -overwrite_original -Make=Canon -Model="Canon EOS R6" -LensModel="RF24-70mm F2.8 L IS USM" \
  -DateTimeOriginal="2019:03:12 14:22:01" -FNumber=2.8 -ExposureTime=0.004 -ISO=400 -FocalLength=35 "$OUT/exif.jpg"
heif-enc -q 80 "$OUT/exif.jpg" -o "$OUT/foto.heic" >/dev/null
exiftool -q -overwrite_original -Make=Apple -Model="iPhone 15 Pro" -DateTimeOriginal="2024:07:04 19:05:33" \
  -FNumber=1.8 -ExposureTime=0.01 -ISO=80 "$OUT/foto.heic"
TMP=$(mktemp -d)
magick "$OUT/exif.jpg" -resize 160x120 -compress none "$TMP/head.tif"
exiftool -q -overwrite_original -Make=NIKON -Model="NIKON Z 6II" -Orientation#=6 \
  -DateTimeOriginal="2021:10:02 08:15:00" -FNumber=4 -ExposureTime=0.002 -ISO=200 -FocalLength=50 "$TMP/head.tif"
python3 - "$TMP/head.tif" "$OUT/exif.jpg" "$OUT/prueba.nef" <<'PY'
import sys, random
head, preview, out = open(sys.argv[1], 'rb').read(), open(sys.argv[2], 'rb').read(), sys.argv[3]
sof3 = bytes([0xFF, 0xD8, 0xFF, 0xC3, 0, 11, 14, 0, 16, 0, 16, 1, 1, 0x11, 0, 0xFF, 0xDA, 0, 8, 1, 1, 0, 1, 0, 0])
random.seed(1)
lossless = sof3 + bytes(random.randrange(0, 0xFE) for _ in range(2_000_000)) + b'\xFF\xD9'
open(out, 'wb').write(head + b'\0' * 64 + lossless + b'\0' * 32 + preview)
PY
echo "fixtures en $OUT"
