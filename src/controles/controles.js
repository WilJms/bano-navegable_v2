// Recorrido en primera persona. Mirar: arrastrar sobre la escena (mouse o dedo). Caminar: W A S D / flechas en el
// escritorio y joystick abajo a la izquierda en pantallas táctiles. Las puertas y la ventana se accionan con sus botones.
import * as THREE from 'three';
import { L, v3, aPlanta } from '../coordenadas.js';
import { Colisiones } from './colisiones.js';

const RAD = THREE.MathUtils.degToRad;
const VEL = 1.25; // m/s
const GIRO_MOUSE = 0.0035; // rad por píxel arrastrado
const GIRO_DEDO = 0.0045;
/** Captura el puntero si el navegador lo permite (un puntero ya liberado o sintético lanzaría un error). */
const capturar = (el, id) => { try { el.setPointerCapture(id); } catch { /* sin captura: se siguen sus eventos igual */ } };

export class Controles {
  constructor(camara, lienzo, escena, eventos) {
    this.camara = camara;
    this.lienzo = lienzo;
    this.escena = escena;
    this.eventos = eventos; // { alAviso(texto), alCambiarAberturas() }
    this.col = new Colisiones();
    this.altura = L.visor.altura_ojos;
    this.fovH = L.visor.fov_horizontal;
    this.yaw = 0;
    this.pitch = 0;
    this.pos = { x: 0, z: 0 };
    this.teclas = new Set();
    this.joy = { x: 0, y: 0 };
    this.transicion = null; // el visitante se aparta del recorrido de una hoja
    // las puertas y la ventana se detienen si van a tocar al visitante
    const ab = escena.aberturas;
    ab.choca = (id, nuevo, actual) => this.col.bloquea(id, nuevo, actual, this.pos);
    ab.alDetener = (nombre) => { if (!this.transicion) this.eventos.alAviso?.(`${nombre}: detenida, estás en su recorrido`); };
    this.#teclado();
    this.#arrastre();
    this.#joystick();
    this.#ubicarEnEntrada();
  }

  // --- entrada ---------------------------------------------------------------------------------
  #teclado() {
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      this.teclas.add(e.code);
    });
    addEventListener('keyup', (e) => this.teclas.delete(e.code));
    addEventListener('blur', () => this.teclas.clear());
    this.lienzo.addEventListener('wheel', (e) => {
      this.fovH = THREE.MathUtils.clamp(this.fovH + Math.sign(e.deltaY) * 3, 55, 105);
      this.ajustarProyeccion();
    }, { passive: true });
  }

  /** Mirar arrastrando sobre la escena: con el botón del mouse apretado o con un dedo; dos dedos pellizcan el campo
   * visual. El puntero nunca se oculta ni se bloquea. */
  #arrastre() {
    const punteros = new Map(); // pointerId → { x, y }
    let distPellizco = 0;
    const lienzo = this.lienzo;
    lienzo.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
      punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      capturar(lienzo, e.pointerId);
      lienzo.classList.add('arrastrando');
      distPellizco = 0;
    });
    lienzo.addEventListener('pointermove', (e) => {
      const p = punteros.get(e.pointerId);
      if (!p) return;
      const actual = { x: e.clientX, y: e.clientY };
      if (punteros.size >= 2) {
        punteros.set(e.pointerId, actual);
        const [a, b] = [...punteros.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (distPellizco && d > 0) {
          this.fovH = THREE.MathUtils.clamp(this.fovH * (distPellizco / d), 55, 105);
          this.ajustarProyeccion();
        }
        distPellizco = d;
        return;
      }
      this.#mirar(actual.x - p.x, actual.y - p.y, e.pointerType === 'mouse' ? GIRO_MOUSE : GIRO_DEDO);
      punteros.set(e.pointerId, actual);
    });
    const soltar = (e) => {
      punteros.delete(e.pointerId);
      distPellizco = 0;
      if (!punteros.size) lienzo.classList.remove('arrastrando');
    };
    lienzo.addEventListener('pointerup', soltar);
    lienzo.addEventListener('pointercancel', soltar);
    lienzo.addEventListener('lostpointercapture', soltar);
    lienzo.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  #joystick() {
    const joy = document.getElementById('joystick');
    const perilla = joy.querySelector('.perilla');
    let idJoy = null;
    const centro = () => { const r = joy.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; };
    const mover = (e) => {
      const c = centro();
      let dx = (e.clientX - c.x) / c.r;
      let dy = (e.clientY - c.y) / c.r;
      const n = Math.hypot(dx, dy);
      if (n > 1) { dx /= n; dy /= n; }
      this.joy = { x: dx, y: -dy };
      perilla.style.transform = `translate(${dx * 37}px, ${dy * 37}px)`;
    };
    joy.addEventListener('pointerdown', (e) => {
      idJoy = e.pointerId;
      capturar(joy, e.pointerId);
      mover(e);
    });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === idJoy) mover(e); });
    const soltar = (e) => {
      if (e.pointerId !== idJoy) return;
      idJoy = null;
      this.joy = { x: 0, y: 0 };
      perilla.style.transform = '';
    };
    joy.addEventListener('pointerup', soltar);
    joy.addEventListener('pointercancel', soltar);
    joy.addEventListener('lostpointercapture', soltar);
  }

  #mirar(dx, dy, k) {
    this.yaw -= dx * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k, RAD(-85), RAD(85));
  }

  // --- puertas y ventana -----------------------------------------------------------------------
  /** Abre o cierra un grupo (entrada | ducha | ventana). Devuelve true si quedó abriéndose. */
  alternarAbertura(grupo) {
    const abre = this.escena.aberturas.alternar(grupo);
    this.#apartarse();
    this.eventos.alCambiarAberturas?.();
    return abre;
  }

  /** Si una hoja que empieza a moverse pasaría por donde está el visitante, este se corre deslizándose a un lugar libre
   * cercano (desde la entrada, al abrir la puerta, avanza medio metro); la hoja espera a que el paso quede libre. */
  #apartarse() {
    if (this.transicion) return;
    const ab = this.escena.aberturas;
    const movimientos = [...ab.hojas].filter(([, h]) => h.t < 1).map(([id, h]) => ({ id, desde: h.angulo, hacia: h.hacia }));
    this.col.angulos = ab.angulos();
    const q = this.col.apartar(this.pos, movimientos);
    if (!q) return;
    // solo se mueve la posición: mirar alrededor sigue funcionando mientras tanto
    this.transicion = { desde: { x: this.pos.x, z: this.pos.z }, a: { x: q.x, z: q.z }, t: 0, duracion: 0.7 };
  }

  // --- punto de partida ------------------------------------------------------------------------
  #ubicarEnEntrada() {
    const pv = L.puntos_de_vista.find((p) => p.id === 'entrada');
    const [x, y, z] = pv.pos;
    const [mx, my, mz] = pv.mirar;
    this.pos = { x, z };
    this.altura = y;
    this.yaw = Math.atan2(-(mx - x), mz - z);
    this.pitch = Math.atan2(my - y, Math.hypot(mx - x, mz - z));
    this.ajustarProyeccion();
    this.#aplicarCamara();
  }

  // --- proyección ------------------------------------------------------------------------------
  ajustarProyeccion() {
    const asp = this.lienzo.clientWidth / Math.max(1, this.lienzo.clientHeight);
    const v = 2 * Math.atan(Math.tan(RAD(this.fovH) / 2) / asp);
    this.camara.fov = THREE.MathUtils.radToDeg(Math.min(v, RAD(105)));
    this.camara.aspect = asp;
    this.camara.updateProjectionMatrix();
  }

  // --- bucle -----------------------------------------------------------------------------------
  actualizar(dt) {
    if (this.transicion) {
      const tr = this.transicion;
      tr.t = Math.min(1, tr.t + dt / tr.duracion);
      const k = tr.t < 0.5 ? 2 * tr.t * tr.t : 1 - (-2 * tr.t + 2) ** 2 / 2;
      this.pos = { x: tr.desde.x + (tr.a.x - tr.desde.x) * k, z: tr.desde.z + (tr.a.z - tr.desde.z) * k };
      if (tr.t >= 1) this.transicion = null;
    } else {
      this.#caminar(dt);
    }
    this.#aplicarCamara();
  }

  #caminar(dt) {
    let f = 0;
    let s = 0;
    if (this.teclas.has('KeyW') || this.teclas.has('ArrowUp')) f += 1;
    if (this.teclas.has('KeyS') || this.teclas.has('ArrowDown')) f -= 1;
    if (this.teclas.has('KeyD') || this.teclas.has('ArrowRight')) s += 1;
    if (this.teclas.has('KeyA') || this.teclas.has('ArrowLeft')) s -= 1;
    f += this.joy.y;
    s += this.joy.x;
    const n = Math.hypot(f, s);
    this.col.angulos = this.escena.aberturas.angulos();
    // quieto también se corrige: una hoja que se abre o se cierra empuja al visitante en vez de atravesarlo
    if (n < 0.01) {
      this.col.resolver(this.pos);
      return;
    }
    if (n > 1) { f /= n; s /= n; }
    const vel = VEL * (this.teclas.has('ShiftLeft') || this.teclas.has('ShiftRight') ? 1.5 : 1) * 100 * dt; // cm
    // yaw 0 mira hacia +z de layout (la ventana); la derecha es +x
    const fx = -Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    this.col.mover(this.pos, (fx * f + fz * s) * vel, (fz * f - fx * s) * vel);
  }

  #aplicarCamara() {
    this.camara.position.copy(v3(this.pos.x, this.altura, this.pos.z));
    // three.js: mirar hacia −z es mirar hacia +z de layout
    this.camara.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  posicionPlanta() {
    return aPlanta(this.camara.position);
  }
}
