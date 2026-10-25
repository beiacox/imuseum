#!/usr/bin/env bash
# Genera multimedia de ejemplo en public/demo con ffmpeg.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=public/demo
rm -rf "$OUT"
mkdir -p "$OUT/Fractales" "$OUT/Patrones/Geometría" "$OUT/Videos" "$OUT/Música"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }

ff -f lavfi -i "gradients=s=1600x1000:c0=0x1d3b6e:c1=0xe8a33d:x0=0:y0=0:x1=1600:y1=1000" -frames:v 1 "$OUT/Bienvenida.jpg"
ff -f lavfi -i "gradients=s=900x1200:c0=0x6e1d3b:c1=0x3de8c0:n=4" -frames:v 1 "$OUT/Retrato.jpg"

i=1
for spec in "start_scale=3:end_pts=1" "start_x=-0.743643887037151:start_y=0.13182590420533:start_scale=0.0005:end_pts=1" \
            "start_x=-0.16:start_y=1.0405:start_scale=0.02:end_pts=1" "start_x=0.285:start_y=0.01:start_scale=0.05:end_pts=1" \
            "start_x=-1.25066:start_y=0.02012:start_scale=0.0008:end_pts=1"; do
  ff -f lavfi -i "mandelbrot=s=1200x900:$spec" -frames:v 1 "$OUT/Fractales/Mandelbrot $i.jpg"; i=$((i+1))
done
ff -f lavfi -i "sierpinski=s=1000x1000:type=carpet" -frames:v 1 "$OUT/Fractales/Alfombra de Sierpinski.png"
ff -f lavfi -i "sierpinski=s=1000x1000:type=triangle" -frames:v 1 "$OUT/Fractales/Triángulo de Sierpinski.png"

for r in 30 90 110 150; do
  ff -f lavfi -i "cellauto=s=1400x800:rule=$r" -frames:v 1 "$OUT/Patrones/Autómata regla $r.png"
done
ff -f lavfi -i "life=s=600x600:mold=10:r=60:ratio=0.1:death_color=#C83232:life_color=#00ff00,scale=1200:1200:flags=neighbor" -frames:v 1 "$OUT/Patrones/Juego de la vida.png"
ff -f lavfi -i "testsrc2=s=1280x720" -frames:v 1 "$OUT/Patrones/Geometría/Carta de ajuste.png"
ff -f lavfi -i "smptehdbars=s=1280x720" -frames:v 1 "$OUT/Patrones/Geometría/Barras de color.png"
ff -f lavfi -i "gradients=s=800x1400:n=6:type=radial" -frames:v 1 "$OUT/Patrones/Geometría/Radial.png"

ff -f lavfi -i "testsrc2=s=960x540:r=30:d=8" -f lavfi -i "sine=f=330:d=8" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$OUT/Videos/Prueba de señal.mp4"
ff -f lavfi -i "mandelbrot=s=960x540:r=30:end_pts=80,trim=duration=10" -f lavfi -i "sine=f=220:d=10" -c:v libx264 -crf 32 -preset fast -pix_fmt yuv420p -c:a aac -shortest "$OUT/Videos/Viaje fractal.mp4"
ff -f lavfi -i "life=s=360x640:mold=10:r=20:ratio=0.1,scale=540:960:flags=neighbor,trim=duration=8" -c:v libvpx-vp9 -b:v 400k "$OUT/Videos/Vida vertical.webm"

ff -f lavfi -i "aevalsrc='0.3*sin(2*PI*(220+110*floor(mod(t*2,4)))*t)*exp(-3*mod(t,0.5))':d=16" -c:a libmp3lame -q:a 4 "$OUT/Música/Arpegio.mp3"
ff -f lavfi -i "aevalsrc='0.25*sin(2*PI*110*t)*(0.6+0.4*sin(2*PI*0.5*t))+0.15*sin(2*PI*165*t)':d=16" -c:a libvorbis -q:a 4 "$OUT/Música/Drone.ogg"
ff -f lavfi -i "aevalsrc='0.4*sin(2*PI*60*t)*exp(-12*mod(t,0.5))+0.1*(random(0)-0.5)*exp(-30*mod(t+0.25,0.5))':d=16" "$OUT/Música/Ritmo.wav"
ff -f lavfi -i "sine=f=523:d=12,volume=0.3" -c:a libopus "$OUT/Música/Tono puro.opus"

node -e '
const fs = require("fs"), path = require("path");
const root = "public/demo";
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(root, path.join(d, e.name))]);
const files = walk(root).filter((f) => f !== "manifest.json").sort();
fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({ name: "Museo de demostración", files }, null, 2));
console.log(files.length + " archivos");
'
du -sh "$OUT"
