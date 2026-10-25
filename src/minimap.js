import { DOOR_W } from './config.js';

const VIEW_M = 100; // metros visibles en el diámetro del minimapa

export class Minimap {
  constructor(canvas, museum) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.museum = museum;
  }

  draw(pos, yaw, currentRoom) {
    const { g, canvas, museum } = this;
    const S = canvas.width, s = S / VIEW_M, half = VIEW_M / 2 + 5;
    const X = (x) => S / 2 + (x - pos.x) * s;
    const Z = (z) => S / 2 + (z - pos.z) * s;
    // solo lo que está en el piso actual (las alas de otros pisos están justo encima o debajo)
    const near = (b) => b.maxX > pos.x - half && b.minX < pos.x + half && b.maxZ > pos.z - half && b.minZ < pos.z + half
      && (b.minY === undefined || (b.minY < pos.y + 7 && b.maxY > pos.y - 7));
    const rect = (b) => [X(b.minX), Z(b.minZ), (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s];

    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(12,11,10,0.78)';
    g.fillRect(0, 0, S, S);

    g.fillStyle = '#4a4238';
    const floor = museum.floorAt(pos.y - 1.65);
    g.fillRect(...rect(floor.bounds));
    for (const w of museum.wings) if (near(w.bounds)) g.fillRect(...rect(w.bounds));

    g.font = '600 9px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const r of museum.rooms) {
      if (!near(r.bounds)) continue;
      const [x, y, w, h] = rect(r.bounds);
      const cur = r === currentRoom;
      g.fillStyle = cur ? r.color : '#26221e';
      g.globalAlpha = cur ? 0.55 : 1;
      g.fillRect(x, y, w, h);
      g.globalAlpha = 1;
      g.strokeStyle = cur ? r.color : '#6a5f52';
      g.lineWidth = 1.5;
      g.strokeRect(x, y, w, h);
      // puerta (la pared de la puerta es paralela al eje del pasillo del ala)
      g.fillStyle = '#4a4238';
      const dw = DOOR_W * s;
      const alongX = Math.abs(r.door.z - r.bounds.minZ) < 0.5 || Math.abs(r.door.z - r.bounds.maxZ) < 0.5;
      if (alongX) g.fillRect(X(r.door.x) - dw / 2, Z(r.door.z) - 2, dw, 4);
      else g.fillRect(X(r.door.x) - 2, Z(r.door.z) - dw / 2, 4, dw);
      if (w > 30 && h > 14) {
        g.fillStyle = '#d8c9a8';
        g.fillText(r.title.length > 14 ? r.title.slice(0, 13) + '…' : r.title, x + w / 2, y + h / 2, w - 4);
      }
    }

    g.translate(S / 2, S / 2);
    g.rotate(-yaw);
    g.fillStyle = '#ffd36b';
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(5.5, 6);
    g.lineTo(0, 3);
    g.lineTo(-5.5, 6);
    g.closePath();
    g.fill();
    g.restore();

    g.strokeStyle = 'rgba(232,213,166,0.5)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
    g.stroke();
    if (museum.floors.length > 1) {
      g.fillStyle = 'rgba(12,11,10,0.85)';
      g.fillRect(S / 2 - 34, S - 30, 68, 20);
      g.fillStyle = '#e8d5a6';
      g.font = '600 12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`Piso ${floor.index}`, S / 2, S - 20);
    }
  }
}
