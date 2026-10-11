// Lightmaps horneados en Blender: JPEG Ultra HDR (imagen base sRGB de 8 bits + mapa de ganancia en log2).
// Se decodifican en la GPU a texturas de medio flotante con la fórmula de la especificación (peso 1, sin offsets):
//     HDR = sRGB⁻¹(base) · 2^(gmin + (gmax − gmin) · ganancia)
// lightmaps.json trae, por ambiente y atlas, gmin, gmax y dónde empieza la imagen de ganancia dentro del archivo,
// más la intensidad, la exposición y el balance de blancos con que Cycles hizo los renders.
import * as THREE from 'three';
import { recurso } from '../coordenadas.js';

const VERTICES = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAGMENTOS = /* glsl */ `
precision highp float;
uniform sampler2D base;
uniform sampler2D ganancia;
uniform float gmin;
uniform float gmax;
varying vec2 vUv;
vec3 lineal(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
void main() {
  vec3 b = lineal(texture2D(base, vUv).rgb);
  float g = texture2D(ganancia, vUv).r;
  gl_FragColor = vec4(b * exp2(gmin + (gmax - gmin) * g), 1.0);
}`;

const OPCIONES_BITMAP = { colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: 'none' };

export class Lightmaps {
  constructor(renderer, gestor) {
    this.renderer = renderer;
    this.gestor = gestor;
    this.indice = null;
    this.juegos = {}; // ambiente → { atlas → Texture }
  }

  async cargarIndice() {
    const r = await fetch(recurso('lightmaps/lightmaps.json'));
    if (!r.ok) return null;
    this.indice = await r.json();
    return this.indice;
  }

  ajustes(ambiente) {
    return this.indice?.ambientes?.[ambiente] ?? null;
  }

  get intensidad() {
    return this.indice?.intensidad ?? Math.PI;
  }

  /** Texturas de un ambiente, decodificadas una sola vez. */
  async juego(ambiente) {
    if (this.juegos[ambiente]) return this.juegos[ambiente];
    const entradas = Object.entries(this.indice?.juegos?.[ambiente] ?? {});
    const url = (d) => recurso(`lightmaps/${d.archivo}`);
    entradas.forEach(([, d]) => this.gestor?.itemStart(url(d)));
    const texturas = {};
    await Promise.all(entradas.map(async ([atlas, d]) => {
      texturas[atlas] = await this.#decodificar(d, url(d));
      this.gestor?.itemEnd(url(d));
    }));
    this.juegos[ambiente] = texturas;
    return texturas;
  }

  async #decodificar(d, url) {
    const datos = await (await fetch(url)).arrayBuffer();
    const [imgBase, imgGanancia] = await Promise.all([
      createImageBitmap(new Blob([datos.slice(0, d.inicio_ganancia)], { type: 'image/jpeg' }), OPCIONES_BITMAP),
      createImageBitmap(new Blob([datos.slice(d.inicio_ganancia)], { type: 'image/jpeg' }), OPCIONES_BITMAP),
    ]);
    const entrada = (img) => {
      const t = new THREE.Texture(img);
      t.flipY = false; // filas de arriba hacia abajo, como las UV de glTF
      t.colorSpace = THREE.NoColorSpace; // la conversión sRGB → lineal la hace el shader
      t.generateMipmaps = false;
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.needsUpdate = true;
      return t;
    };
    const base = entrada(imgBase);
    const ganancia = entrada(imgGanancia);
    const rt = new THREE.WebGLRenderTarget(imgBase.width, imgBase.height, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTICES, fragmentShader: FRAGMENTOS,
      uniforms: { base: { value: base }, ganancia: { value: ganancia }, gmin: { value: d.gmin }, gmax: { value: d.gmax } },
      depthTest: false, depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    const previo = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt);
    this.renderer.render(quad, new THREE.Camera());
    this.renderer.setRenderTarget(previo);
    base.dispose();
    ganancia.dispose();
    material.dispose();
    quad.geometry.dispose();
    imgBase.close();
    imgGanancia.close();
    const tex = rt.texture;
    tex.channel = 1; // TEXCOORD_1 = «UVLightmap»
    tex.name = url;
    return tex;
  }
}
