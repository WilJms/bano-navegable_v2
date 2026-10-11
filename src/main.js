// Recorrido 3D del Baño Beatriz: arranque, bucle y conexión entre escena, controles, calidad e interfaz.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Escena } from './escena/escena.js';
import { Controles } from './controles/controles.js';
import { Calidad } from './calidad/calidad.js';
import { Interfaz } from './ui/interfaz.js';
import { L } from './coordenadas.js';

const DEPURAR = new URLSearchParams(location.search).has('debug');
const UMBRAL_BLOOM = 4.0; // sobre la imagen ya expuesta: solo LED, lentes de focos y llamas
// balance de blancos de Blender (matriz lineal medida por pipeline/blender/matriz_balance.py), antes de AgX
const BALANCE = {
  uniforms: { tDiffuse: { value: null }, matriz: { value: new THREE.Matrix3() } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; uniform mat3 matriz; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(max(matriz * c.rgb, 0.0), c.a); }',
};

const contenedor = document.getElementById('lienzo');
// tamaño real del lienzo (ocupa la pantalla por CSS): al rotar, el iPhone informa el tamaño de la ventana con atraso
const tam = () => [Math.max(1, contenedor.clientWidth), Math.max(1, contenedor.clientHeight)];
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1;
renderer.setSize(...tam(), false); // false: el tamaño en pantalla lo pone el CSS, no estilos en píxeles
renderer.info.autoReset = false; // el contador de draw calls abarca todas las pasadas del cuadro
contenedor.appendChild(renderer.domElement);
// si el navegador pierde el contexto WebGL, three.js lo recupera; los lightmaps y la sonda se rehacen (escena.js)
renderer.domElement.addEventListener('webglcontextrestored', () => {
  escena.restaurarContexto().catch((e) => console.warn('no se pudo restaurar la iluminación', e));
});

const gestor = new THREE.LoadingManager();
let ui;
gestor.onProgress = (_url, hechos, total) => ui?.progreso(hechos / Math.max(total, 1));

const camara = new THREE.PerspectiveCamera(70, tam()[0] / tam()[1], L.visor.plano_cercano / 100, 60);
const escena = new Escena(renderer, gestor);
let composer, bloom, smaa, balance, controles;

/** Exposición y balance de blancos de Cycles (si hay escena horneada). La exposición va en el mismo pase que el
 * balance, antes del bloom: así el umbral del bloom ve valores ya expuestos (si no, toda la escena, con radiancias
 * sobre 1, se lava en blanco). */
function color() {
  const a = escena.ajustesColor();
  renderer.toneMappingExposure = 1;
  if (balance) {
    balance.enabled = !!a;
    if (a) balance.uniforms.matriz.value.set(...a.balance.flat()).multiplyScalar(2 ** a.exposicion);
  }
}

const calidad = new Calidad(renderer, (c) => {
  if (bloom) bloom.enabled = c.config.bloom;
  escena?.aplicarCalidad?.(c.config);
  composer?.setPixelRatio(renderer.getPixelRatio());
  composer?.setSize(...tam());
});

ui = new Interfaz({
  entrar: () => ui.mostrarRecorrido(),
  abertura: (grupo) => {
    const abre = controles.alternarAbertura(grupo);
    ui.aviso(`${escena.aberturas.grupos[grupo].nombre}: ${abre ? 'abriendo' : 'cerrando'}`);
  },
  calidad: (nivel) => calidad.elegir(nivel),
  altura: (cm) => { controles.altura = cm; },
});

function crearPostproceso() {
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 }));
  composer.addPass(new RenderPass(escena.scene, camara));
  balance = new ShaderPass(BALANCE);
  composer.addPass(balance);
  // halo suave solo en lo que de verdad brilla (LED, lentes de los focos, llamas): umbral sobre la imagen ya expuesta
  bloom = new UnrealBloomPass(new THREE.Vector2(...tam()), 0.15, 0.35, UMBRAL_BLOOM);
  bloom.enabled = calidad.config.bloom;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  smaa = new SMAAPass();
  composer.addPass(smaa);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(...tam());
}

function componer() {
  escena.cuadro++;
  renderer.info.reset();
  composer.render();
}

function ajustarTamano() {
  const [w, h] = tam();
  renderer.setSize(w, h, false);
  composer?.setSize(w, h);
  controles?.ajustarProyeccion();
}
// el lienzo avisa cuando cambia de tamaño de verdad (rotar el teléfono, barras del navegador, ventana)
new ResizeObserver(ajustarTamano).observe(contenedor);
addEventListener('orientationchange', () => setTimeout(ajustarTamano, 350));

let ultimo = performance.now();
let acumulado = 0;
let cuadros = 0;
function bucle(t) {
  requestAnimationFrame(bucle);
  const dt = Math.min(0.1, (t - ultimo) / 1000);
  ultimo = t;
  controles.actualizar(dt);
  escena.actualizar(dt);
  componer();
  if (DEPURAR) {
    acumulado += dt;
    cuadros++;
    if (acumulado > 0.5) {
      const i = renderer.info;
      const p = controles.posicionPlanta();
      ui.depurar([
        `fps ${(cuadros / acumulado).toFixed(0)} · calidad ${calidad.config.nombre} · píxeles ×${renderer.getPixelRatio().toFixed(2)}`,
        `draw calls ${i.render.calls} · triángulos ${(i.render.triangles / 1000).toFixed(0)} k`,
        `texturas ${i.memory.textures} · geometrías ${i.memory.geometries}`,
        `gpu ${calidad.gpu || '—'}`,
        `posición x ${p.x.toFixed(0)} z ${p.z.toFixed(0)} cm`,
      ].join('\n'));
      acumulado = 0;
      cuadros = 0;
    }
  }
}

async function arrancar() {
  ui.progreso(0.05, 'Cargando el recorrido…');
  await escena.cargar(calidad.config);
  controles = new Controles(camara, renderer.domElement, escena, {
    alAviso: (t) => ui.aviso(t),
    alCambiarAberturas: () => ui.aberturas(escena.aberturas.estado()),
  });
  crearPostproceso();
  escena.aplicarCalidad(calidad.config);
  color();
  controles.ajustarProyeccion();
  ui.calidad(calidad.nivel);
  ui.progreso(1, 'Listo');
  ui.listo();
  // para depurar y para las pruebas automáticas (qa/)
  window.__bano = { THREE, escena, controles, camara, renderer, calidad, get composer() { return composer; }, get bloom() { return bloom; } };
  requestAnimationFrame(bucle);
}

arrancar().catch((e) => {
  console.error(e);
  ui.progreso(0, 'No se pudo cargar el recorrido. Revisa que el navegador tenga WebGL2 activo.');
});
