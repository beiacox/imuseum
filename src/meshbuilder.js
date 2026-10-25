import * as THREE from 'three';

/*
 * Convierte las cajas de una Spec en pocas mallas: una por material (y por si tapan
 * la mira o no). Las UV usan coordenadas absolutas, así que la madera, el mármol y el
 * yeso continúan sin cortes entre piezas.
 */

// caras: normal, ejes u/v (u × v = normal) y esquinas en orden antihorario
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], c: (b) => [[b.x1, b.y0, b.z1], [b.x1, b.y0, b.z0], [b.x1, b.y1, b.z0], [b.x1, b.y1, b.z1]] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], c: (b) => [[b.x0, b.y0, b.z0], [b.x0, b.y0, b.z1], [b.x0, b.y1, b.z1], [b.x0, b.y1, b.z0]] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], c: (b) => [[b.x0, b.y1, b.z1], [b.x1, b.y1, b.z1], [b.x1, b.y1, b.z0], [b.x0, b.y1, b.z0]] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], c: (b) => [[b.x0, b.y0, b.z0], [b.x1, b.y0, b.z0], [b.x1, b.y0, b.z1], [b.x0, b.y0, b.z1]] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], c: (b) => [[b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], c: (b) => [[b.x1, b.y0, b.z0], [b.x0, b.y0, b.z0], [b.x0, b.y1, b.z0], [b.x1, b.y1, b.z0]] },
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();

export class MeshBuilder {
  constructor(texScale = {}) {
    this.texScale = texScale;
    this.buckets = new Map();
  }

  bucket(mat, ray) {
    const key = `${mat}|${ray ? 1 : 0}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { mat, ray, pos: [], nor: [], uv: [], idx: [] }));
    return b;
  }

  emit(b, corners, n, uvs) {
    const base = b.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      b.pos.push(...corners[i]);
      b.nor.push(...n);
      b.uv.push(...uvs[i]);
    }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Caja alineada a ejes; mat es un material o un array de 6 (+x −x +y −y +z −z). */
  addBox(box) {
    for (let f = 0; f < 6; f++) {
      const mat = Array.isArray(box.mat) ? box.mat[f] : box.mat;
      const face = FACES[f];
      const s = this.texScale[mat] ?? 1;
      const corners = face.c(box);
      this.emit(this.bucket(mat, box.ray), corners, face.n, corners.map((p) => [dot(p, face.u) / s, dot(p, face.v) / s]));
    }
  }

  /** Caja girada (decorativa): c centro, s tamaño, r rotación euler. */
  addOriented({ c, s, r, mat }) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...c),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)),
      new THREE.Vector3(1, 1, 1),
    );
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const local = { x0: -s[0] / 2, x1: s[0] / 2, y0: -s[1] / 2, y1: s[1] / 2, z0: -s[2] / 2, z1: s[2] / 2 };
    const b = this.bucket(mat, false);
    for (const face of FACES) {
      const corners = face.c(local).map((p) => tmpV.set(...p).applyMatrix4(m).toArray());
      const n = tmpN.set(...face.n).applyMatrix3(nm).normalize().toArray();
      this.emit(b, corners, n, face.c(local).map((p) => [dot(p, face.u), dot(p, face.v)]));
    }
  }

  /** Devuelve [{ mesh, ray }] usando `materials(key)` para cada material. */
  build(materials) {
    const out = [];
    for (const b of this.buckets.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setIndex(b.idx);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, materials(b.mat));
      if (b.mat === 'glass') mesh.renderOrder = 2;
      out.push({ mesh, ray: b.ray });
    }
    return out;
  }
}
