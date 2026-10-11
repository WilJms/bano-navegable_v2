// Colisiones en planta: un círculo (radio de layout.visor) contra muros, muebles, WC y vidrios, con deslizamiento.
import { L, X_HAB, Z_HAB } from '../coordenadas.js';
import { bisagra } from '../escena/aberturas.js';

const rect = (nombre, x, z) => ({ nombre, x: [Math.min(...x), Math.max(...x)], z: [Math.min(...z), Math.max(...z)] });

/** Distancia en planta de pos al segmento h (a → b) y el vector desde su punto más cercano. */
function distanciaSegmento(pos, h) {
  const [ax, az] = h.a;
  const [ex, ez] = [h.b[0] - ax, h.b[1] - az];
  const t = Math.min(Math.max(((pos.x - ax) * ex + (pos.z - az) * ez) / (ex * ex + ez * ez), 0), 1);
  const dx = pos.x - (ax + ex * t);
  const dz = pos.z - (az + ez * t);
  return { dx, dz, d: Math.hypot(dx, dz) };
}

export class Colisiones {
  constructor() {
    this.radio = L.visor.radio_colision;
    const du = L.ducha;
    const fr = du.frente_vidrio;
    const fijo = fr.paneles.find((p) => p.tipo === 'fijo');
    this.puerta = fr.paneles.find((p) => p.tipo === 'puerta');
    const semi = Math.max(L.wc.taza.ancho, L.wc.estanque.ancho) / 2;
    this.fijos = [
      rect('columna_estrecha', L.columna_estrecha.x, L.columna_estrecha.z),
      rect('vanitorio', L.vanitorio.x, L.vanitorio.z),
      rect('columna_alta', L.columna_alta.x, L.columna_alta.z),
      rect('wc', L.wc.x, [L.wc.eje_z - semi, L.wc.eje_z + semi]),
      rect('vidrio_fijo', [fr.x, fr.x + fr.espesor], fijo.z),
      rect('tabique', du.tabique.x, [du.tabique.z, du.tabique.z + du.tabique.espesor]),
    ];
    // puertas que giran: bisagra en planta (cm), dirección cerrada, dirección hacia donde abre y largo. La hoja
    // corredera de la ventana no está: se mueve dentro del derrame, nunca en el espacio por donde se camina.
    const pa = L.puerta_acceso;
    const izq = pa.lado_bisagras === 'x_min';
    this.hojas = {
      ducha: { bisagra: bisagra('ducha'), cerrada: [0, 1], abre: [this.puerta.abre === 'afuera' ? -1 : 1, 0], largo: this.puerta.z[1] - this.puerta.z[0] },
      entrada: { bisagra: bisagra('entrada'), cerrada: [izq ? 1 : -1, 0], abre: [0, 1], largo: pa.vano.x[1] - pa.vano.x[0] - 3.2 },
    };
    this.angulos = {}; // grados por hoja; 0 = cerrada
  }

  /** Hoja id en un ángulo (grados) como segmento desde la bisagra, de medio espesor 0,6 cm. «avance» es hacia donde se
   * mueve al abrir: si alguien queda justo encima de la hoja, sale en ese sentido. */
  segmento(id, ang) {
    const h = this.hojas[id];
    const a = (ang * Math.PI) / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    const d = [h.cerrada[0] * c + h.abre[0] * s, h.cerrada[1] * c + h.abre[1] * s];
    const avance = [h.abre[0] * c - h.cerrada[0] * s, h.abre[1] * c - h.cerrada[1] * s];
    return { nombre: id, a: h.bisagra, b: [h.bisagra[0] + d[0] * h.largo, h.bisagra[1] + d[1] * h.largo], medio: 0.6, avance };
  }

  /** Hojas que estorban. Cerradas, la puerta de entrada y la ventana quedan en el plano del muro; la de la ducha
   * siempre cierra el paso. */
  hojasActivas() {
    return Object.keys(this.hojas)
      .filter((id) => (this.angulos[id] ?? 0) >= 1 || id === 'ducha')
      .map((id) => this.segmento(id, this.angulos[id] ?? 0));
  }

  /** Espacio libre (cm) entre la hoja id en un ángulo y alguien parado en pos (negativo: se superponen). */
  holgura(id, ang, pos) {
    const h = this.segmento(id, ang);
    return distanciaSegmento(pos, h).d - (this.radio + h.medio);
  }

  /** ¿Mover la hoja id de un ángulo a otro empujaría a alguien parado en pos? Sí, si queda a menos de 2 mm de tocarlo
   * y acercándose; alejarse siempre se puede (así una puerta abierta contra la que uno se apoya se puede abrir más). */
  bloquea(id, nuevo, actual, pos) {
    if (!this.hojas[id]) return false;
    const h = this.holgura(id, nuevo, pos);
    return h < 0.2 && h < this.holgura(id, actual, pos);
  }

  /** Si alguna de las hojas que van a moverse ([{ id, desde, hacia }], grados) pasaría por pos, devuelve el lugar
   * libre más cercano fuera de todos esos recorridos, al que se llega caminando (con deslizamiento) y cuyo camino
   * recto desde pos no se mete en los muebles (así el deslizamiento de la cámara no los cruza); si no, null. */
  apartar(pos, movimientos) {
    movimientos = movimientos.filter(({ id }) => this.hojas[id]);
    const enRecorrido = (q) => movimientos.some(({ id, desde, hacia }) => {
      const n = Math.max(2, Math.ceil(Math.abs(hacia - desde) / 3));
      for (let i = 0; i <= n; i++) if (this.holgura(id, desde + ((hacia - desde) * i) / n, q) < 0.5) return true;
      return false;
    });
    if (!enRecorrido(pos)) return null;
    let mejor = null;
    let dMejor = Infinity;
    for (let r = 10; r <= 150; r += 10) {
      for (let k = 0; k < 24; k++) {
        const a = (k * Math.PI) / 12;
        const q = this.mover({ ...pos }, Math.sin(a) * r, Math.cos(a) * r);
        const d = Math.hypot(q.x - pos.x, q.z - pos.z);
        if (d < dMejor && !enRecorrido(q) && this.#caminoRecto(pos, q)) [mejor, dMejor] = [q, d];
      }
    }
    return mejor;
  }

  /** El tramo recto de a a b pasa a más de (radio − 8) cm de muros y muebles: la cámara queda lejos de cualquier cara. */
  #caminoRecto(a, b) {
    const m = this.radio - 8;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
    for (let i = 0; i <= n; i++) {
      const x = a.x + ((b.x - a.x) * i) / n;
      const z = a.z + ((b.z - a.z) * i) / n;
      if (x < m || z < m || x > X_HAB - m || z > Z_HAB - m) return false;
      for (const o of this.fijos) {
        if (Math.hypot(x - Math.min(Math.max(x, o.x[0]), o.x[1]), z - Math.min(Math.max(z, o.z[0]), o.z[1])) < m) return false;
      }
    }
    return true;
  }

  /** Avanza (dx, dz) cm en pasos de a lo más un tercio del radio, corrigiendo en cada uno: con pocos cuadros por
   * segundo un solo paso largo podría dejar el centro dentro de un vidrio de 1 cm y sacarlo por el otro lado. */
  mover(pos, dx, dz) {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (this.radio / 3)));
    for (let i = 0; i < n; i++) {
      pos.x += dx / n;
      pos.z += dz / n;
      this.resolver(pos);
    }
    return pos;
  }

  /** Corrige una posición en planta (cm) para que el círculo no atraviese nada. En los rincones (muro + mueble) los
   * empujes se contradicen: se itera hasta que dejan de corregir y los muros mandan al final. */
  resolver(pos) {
    const r = this.radio;
    const hojas = this.hojasActivas();
    const muros = () => {
      pos.x = Math.min(Math.max(pos.x, r), X_HAB - r);
      pos.z = Math.min(Math.max(pos.z, r), Z_HAB - r);
    };
    for (let it = 0; it < 12; it++) {
      muros();
      const [x0, z0] = [pos.x, pos.z];
      for (const o of this.fijos) {
        const cx = Math.min(Math.max(pos.x, o.x[0]), o.x[1]);
        const cz = Math.min(Math.max(pos.z, o.z[0]), o.z[1]);
        let dx = pos.x - cx;
        let dz = pos.z - cz;
        const d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d < 1e-6) {
          // el centro quedó dentro: sale por el lado más cercano
          const salidas = [
            [o.x[0] - r - pos.x, 0], [o.x[1] + r - pos.x, 0], [0, o.z[0] - r - pos.z], [0, o.z[1] + r - pos.z],
          ];
          const [ex, ez] = salidas.reduce((m, s) => (Math.hypot(...s) < Math.hypot(...m) ? s : m));
          pos.x += ex;
          pos.z += ez;
        } else {
          dx /= d;
          dz /= d;
          pos.x += dx * (r - d);
          pos.z += dz * (r - d);
        }
      }
      for (const h of hojas) {
        let { dx, dz, d } = distanciaSegmento(pos, h);
        const lim = r + h.medio;
        if (d >= lim) continue;
        if (d < 1e-6) [dx, dz] = h.avance;
        else [dx, dz] = [dx / d, dz / d];
        pos.x += dx * (lim - d);
        pos.z += dz * (lim - d);
      }
      if (Math.hypot(pos.x - x0, pos.z - z0) < 0.01) break;
    }
    muros();
    return pos;
  }
}
