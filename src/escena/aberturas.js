// Puertas y ventana que se abren con animación: la puerta de acceso y la de la ducha giran sobre sus bisagras; la
// ventana es corredera (la hoja derecha va en el riel interior y se desliza delante de la izquierda). Medidas de
// layout.json.
import * as THREE from 'three';
import { L } from '../coordenadas.js';

const suave = (t) => t * t * (3 - 2 * t);

/** Eje de giro de una puerta en planta (cm de layout): el borde de la hoja junto a sus bisagras. Lo usan la escena
 * (pivote de la animación) y las colisiones. id: entrada | ducha. */
export function bisagra(id) {
  const pa = L.puerta_acceso;
  const fr = L.ducha.frente_vidrio;
  return {
    entrada: [pa.lado_bisagras === 'x_min' ? pa.vano.x[0] + 1.6 : pa.vano.x[1] - 1.6, 0],
    ducha: [fr.x + fr.espesor / 2, fr.paneles.find((p) => p.tipo === 'puerta').z[0]],
  }[id];
}

/** Hoja corredera de la ventana: cuánto más adentro va su riel y cuánto se corre (cm, el recorrido hacia −x). */
export function corredera() {
  const v = L.ventana;
  const c = v.hojas.corredera;
  const mu = (v.vano.x[0] + v.vano.x[1]) / 2;
  // se corre hasta tapar la otra hoja: su ancho más el parteluz
  return { id: `ventana_${c.hoja}`, adelanto: c.adelanto, recorrido: mu + v.parteluz.ancho / 2 - (v.vano.x[0] + v.marco.ancho_perfil),
    sentido: c.hoja === 'derecha' ? -1 : 1 };
}

class Hoja {
  /** valor: grados (puertas que giran) o fracción abierta 0–1 (corredera). aplicar(pieza, valor) mueve cada pieza. */
  constructor(piezas, tope, duracion, aplicar) {
    this.piezas = piezas;
    this.tope = tope;
    this.duracion = duracion;
    this.aplicar = aplicar;
    this.angulo = 0; // valor actual (grados o fracción)
    this.desde = 0;
    this.hacia = 0;
    this.t = 1;
    this.espera = 0;
  }

  mover(objetivo, retardo = 0) {
    if (objetivo === this.hacia && this.t >= 1) return;
    this.desde = this.angulo;
    this.hacia = objetivo;
    this.t = 0;
    this.espera = retardo;
  }

  /** Avanza la animación. choca(nuevo, actual): pasar de actual a nuevo empujaría al visitante. Devuelve true si quedó
   * detenida. */
  actualizar(dt, choca) {
    if (this.t >= 1) return false;
    if (this.espera > 0) {
      this.espera -= dt;
      return false;
    }
    // un recorrido parcial tarda proporcionalmente menos, sin bajar de un tercio de la duración
    const dur = this.duracion * Math.max(0.35, Math.abs(this.hacia - this.desde) / this.tope);
    const t = Math.min(1, this.t + dt / dur);
    const valor = this.desde + (this.hacia - this.desde) * suave(t);
    // como una puerta real, no atraviesa ni arrastra al visitante: se detiene donde lo tocaría y sigue cuando se aparta
    if (choca?.(valor, this.angulo)) return true;
    this.t = t;
    this.angulo = valor;
    for (const p of this.piezas) this.aplicar(p, valor);
    return false;
  }
}

/**
 * Grupos que se accionan juntos (cada uno con su botón). Las piezas se registran desde el GLB o desde la escena de
 * volúmenes, colgadas de un pivote: en el eje de las bisagras (puertas) o en cualquier punto (corredera).
 */
export class Aberturas {
  constructor() {
    this.hojas = new Map(); // entrada | ducha | ventana_derecha → Hoja
    this.grupos = {
      entrada: { nombre: 'Puerta de entrada', partes: [['entrada', 0]] },
      ducha: { nombre: 'Puerta de la ducha', partes: [['ducha', 0]] },
      ventana: { nombre: 'Ventana', partes: [[corredera().id, 0]] },
    };
    this.choca = null; // (id, valor nuevo, valor actual) → ¿ese paso empujaría al visitante? (lo asigna controles.js)
    this.alDetener = null; // (nombre del grupo) → aviso cuando una hoja se detiene por el visitante
    this.detenidas = new Set();
  }

  /** Registra una hoja: entrada o ducha (giran) o la corredera de la ventana. pivotes: grupos que se mueven. */
  agregar(id, pivotes) {
    const c = corredera();
    if (id === c.id) {
      // como una corredera real, la hoja vive siempre en su riel (más adentro que la otra, +z de three.js) y solo se
      // desliza de lado
      for (const p of pivotes) p.position.z += c.adelanto / 100;
      const base = pivotes.map((p) => p.position.clone());
      const aplicar = (p, f) => {
        const b = base[pivotes.indexOf(p)];
        p.position.x = b.x + (c.sentido * c.recorrido / 100) * f;
      };
      this.hojas.set(id, new Hoja(pivotes, 1, 1.6, aplicar));
      return;
    }
    const pa = L.puerta_acceso;
    const pd = L.ducha.frente_vidrio.paneles.find((p) => p.tipo === 'puerta');
    const tope = { entrada: pa.tope_grados, ducha: pd.apertura_max_grados }[id];
    // layout es de mano izquierda y three.js de mano derecha (z → −z): ver coordenadas.js
    const signo = {
      entrada: pa.lado_bisagras === 'x_min' ? 1 : -1, // hacia +z de layout (adentro)
      ducha: pd.abre === 'afuera' ? 1 : -1, // afuera: hacia −x de layout (el baño, hasta el vanitorio)
    }[id];
    this.hojas.set(id, new Hoja(pivotes, tope, 1.4, (p, grados) => (p.rotation.y = signo * THREE.MathUtils.degToRad(grados))));
  }

  abierto(grupo) {
    return this.grupos[grupo].partes.some(([id]) => (this.hojas.get(id)?.hacia ?? 0) > 0);
  }

  /** { entrada, ducha, ventana } → true si está abierta o abriéndose. */
  estado() {
    return Object.fromEntries(Object.keys(this.grupos).map((g) => [g, this.abierto(g)]));
  }

  /** Abre o cierra un grupo; devuelve true si quedó abriéndose. */
  alternar(grupo, retardo = 0) {
    const abrir = !this.abierto(grupo);
    const partes = this.grupos[grupo].partes;
    partes.forEach(([id, r], i) => {
      const h = this.hojas.get(id);
      // al cerrar, la última en abrir cierra primero
      const ret = abrir ? r : partes[partes.length - 1 - i][1];
      h?.mover(abrir ? h.tope : 0, retardo + ret);
    });
    return abrir;
  }

  /** Valores actuales: grados de las puertas y fracción abierta de la corredera (para las colisiones y las pruebas). */
  angulos() {
    const a = {};
    for (const [id, h] of this.hojas) a[id] = h.angulo;
    return a;
  }

  actualizar(dt) {
    for (const [id, h] of this.hojas) {
      const detenida = h.actualizar(dt, this.choca && ((nuevo, actual) => this.choca(id, nuevo, actual)));
      if (!detenida) this.detenidas.delete(id);
      else if (!this.detenidas.has(id)) {
        this.detenidas.add(id);
        this.alDetener?.(this.grupos[id.startsWith('ventana') ? 'ventana' : id].nombre);
      }
    }
  }
}
