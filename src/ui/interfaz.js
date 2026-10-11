// Interfaz en español: carga, inicio, barra de acciones, ayuda, avisos y panel de depuración (?debug).
import { L } from '../coordenadas.js';

const $ = (id) => document.getElementById(id);
/** Pantalla táctil (teléfono o tablet): joystick para caminar. */
export const tactil = () => matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0;

const AYUDA_ESCRITORIO = [
  ['Arrastrar con el mouse', 'mirar alrededor'],
  ['W A S D / flechas', 'caminar (Shift para ir más rápido)'],
  ['Rueda', 'campo visual'],
  ['Botones de arriba', 'abrir o cerrar la puerta de entrada, la de la ducha y la ventana'],
];
const AYUDA_MOVIL = [
  ['Control abajo a la izquierda', 'caminar'],
  ['Arrastrar en el resto de la pantalla', 'mirar alrededor'],
  ['Pellizcar', 'campo visual'],
  ['Botones de arriba', 'abrir o cerrar la puerta de entrada, la de la ducha y la ventana'],
];

export class Interfaz {
  constructor(acciones) {
    this.acciones = acciones;
    // Pantalla completa. iPhone no la permite en el navegador: el botón explica cómo agregar el recorrido a la pantalla
    // de inicio, desde donde se abre como app a pantalla completa (también bajo el notch). Ya instalado, no se muestra.
    const doc = document;
    const raiz = document.documentElement;
    const puede = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
    const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const iphone = /iPhone|iPod/.test(navigator.userAgent);
    if (!puede && !(iphone && !instalado)) raiz.classList.add('sin-pantalla-completa');
    $('btn-pantalla').onclick = async () => {
      if (!puede) {
        this.aviso('Para verlo a pantalla completa en iPhone: toca Compartir y luego «Agregar a pantalla de inicio», y ábrelo desde ese ícono.', 9000);
        return;
      }
      try {
        if (doc.fullscreenElement || doc.webkitFullscreenElement) await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
        else await (raiz.requestFullscreen?.() ?? raiz.webkitRequestFullscreen?.());
      } catch {
        this.aviso('Este navegador no permitió la pantalla completa.');
      }
    };
    const lista = tactil() ? AYUDA_MOVIL : AYUDA_ESCRITORIO;
    for (const id of ['ayuda-inicio', 'ayuda-panel']) {
      $(id).innerHTML = lista.map(([k, v]) => `<li><b>${k}</b><span>${v}</span></li>`).join('');
    }
    $('btn-entrar').onclick = () => this.acciones.entrar();
    $('aberturas').onclick = (e) => {
      const b = e.target.closest('button');
      if (b) this.acciones.abertura(b.dataset.abertura);
    };
    $('sel-calidad').onchange = (e) => this.acciones.calidad(e.target.value);
    $('btn-ayuda').onclick = () => ($('ayuda').hidden = false);
    $('btn-cerrar-ayuda').onclick = () => ($('ayuda').hidden = true);
    const rng = $('rng-altura');
    rng.value = L.visor.altura_ojos;
    $('val-altura').textContent = rng.value;
    rng.oninput = () => { $('val-altura').textContent = rng.value; this.acciones.altura(+rng.value); };
    this.aberturas({});
  }

  progreso(frac, texto) {
    $('carga-barra').style.width = `${Math.round(frac * 100)}%`;
    $('carga-pct').textContent = Math.round(frac * 100);
    if (texto) $('carga-texto').textContent = texto;
  }

  listo() {
    $('carga').hidden = true;
    $('inicio').hidden = false;
  }

  mostrarRecorrido() {
    $('inicio').hidden = true;
    $('hud').hidden = false;
    $('joystick').hidden = !tactil();
  }

  /** Estado de los botones de puertas y ventana: { entrada, ducha, ventana } → true si está abierta o abriéndose. */
  aberturas(abiertas) {
    for (const b of document.querySelectorAll('#aberturas button')) {
      const abierta = !!abiertas[b.dataset.abertura];
      b.querySelector('.verbo').textContent = abierta ? 'Cerrar' : 'Abrir';
      b.setAttribute('aria-pressed', String(abierta));
      b.setAttribute('aria-label', `${abierta ? 'Cerrar' : 'Abrir'} ${b.querySelector('.largo').textContent}`);
    }
  }

  calidad(nivel) {
    $('sel-calidad').value = nivel;
  }

  aviso(texto, ms = 2200) {
    const a = $('aviso');
    a.textContent = texto;
    a.hidden = false;
    clearTimeout(this.tAviso);
    this.tAviso = setTimeout(() => (a.hidden = true), ms);
  }

  depurar(texto) {
    const d = $('depuracion');
    d.hidden = false;
    d.textContent = texto;
  }
}
