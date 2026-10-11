// Escena: modelo horneado (models/bano.glb) si existe; si no, volúmenes generados desde layout.json. Solo de día.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { L, H_HAB, X_HAB, Z_HAB, recurso, v3 } from '../coordenadas.js';
import materiales from '../datos/materials.json';
import { Aberturas, bisagra, corredera } from './aberturas.js';
import { Lightmaps } from './lightmaps.js';

const M = materiales.materiales;
const color = (id) => new THREE.Color(M[id]?.color_base ?? '#cccccc');
const lista0 = (malla) => (Array.isArray(malla.material) ? malla.material[0] : malla.material) ?? {};
const AMBIENTE = 'dia'; // único juego de lightmaps (el ambiente de noche se retiró)
// El tabique opaco no tiene lightmap: lo ilumina la sonda del baño, cuya luz (focos de 2700 K y madera) lo tiñe de
// ámbar. Factor por canal (lineal) para que desde el WC se vea con el gris que tenía antes (medido con
// qa/capturar_camaras.mjs).
const SATINADO_COMPENSACION = [1.37, 1.98, 2.6];

// Espejo: el Reflector de three.js mezcla su tinte con «overlay», pensado para imágenes de 8 bits; con radiancias
// HDR distorsiona color y brillos. Aquí el reflejo se multiplica por la reflectancia del espejo, como en Cycles.
const ESPEJO_SHADER = {
  ...Reflector.ReflectorShader,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    varying vec4 vUv;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      gl_FragColor = vec4(texture2DProj(tDiffuse, vUv).rgb * color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

// Con lightmap, la luz difusa ya viene horneada: el entorno (sonda) solo aporta reflejos, no se suma otra vez como difusa.
THREE.ShaderChunk.lights_fragment_maps = THREE.ShaderChunk.lights_fragment_maps.replace(
  'iblIrradiance += getIBLIrradiance( geometryNormal );',
  '#ifndef USE_LIGHTMAP\n\t\t\tiblIrradiance += getIBLIrradiance( geometryNormal );\n\t\t\t#endif',
);

export class Escena {
  constructor(renderer, gestor) {
    this.renderer = renderer;
    this.gestor = gestor;
    this.scene = new THREE.Scene();
    this.raiz = new THREE.Group();
    this.scene.add(this.raiz);
    this.porRol = new Map();
    this.espejos = [];
    this.aberturas = new Aberturas();
    this.fondo = null; // cielo HDRI del jardín
    this.lightmaps = new Lightmaps(renderer, gestor);
    this.conLightmap = []; // [{ material, atlas }]
    this.tarjetas = []; // capas del jardín
    this.horneada = false; // true con el GLB y sus lightmaps
    this.cuadro = 0; // contador de cuadros (main.js lo avanza): el espejo se refleja una vez por cuadro
  }

  async cargar(calidad) {
    this.fondo = await new RGBELoader(this.gestor).loadAsync(recurso('env/jardin_dia_1k.hdr'));
    this.fondo.mapping = THREE.EquirectangularReflectionMapping;
    const glb = await this.#intentarGLB();
    if (glb) await this.#prepararGLB(glb, calidad);
    else this.#construirVolumenes(calidad);
    await this.aplicarIluminacion();
  }

  async #intentarGLB() {
    const url = recurso('models/bano.glb');
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (!r.ok || !(r.headers.get('content-type') || '').match(/gltf|octet|binary/)) return null;
    } catch {
      return null;
    }
    const ktx2 = new KTX2Loader(this.gestor).setTranscoderPath(recurso('basis/')).detectSupport(this.renderer);
    const loader = new GLTFLoader(this.gestor).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
    return loader.loadAsync(url);
  }

  #registrar(obj) {
    const rol = obj.userData?.rol;
    if (rol) {
      if (!this.porRol.has(rol)) this.porRol.set(rol, []);
      this.porRol.get(rol).push(obj);
    }
  }

  async #prepararGLB(gltf, calidad) {
    this.raiz.add(gltf.scene);
    const mallas = [];
    gltf.scene.traverse((o) => {
      this.#registrar(o);
      if (o.isMesh) mallas.push(o);
    });
    // los nodos con varias primitivas llegan como grupo: sus mallas heredan los extras (rol, atlas, colección…)
    const extras = (o) => {
      let p = o;
      while (p && p.userData?.atlas === undefined && p !== gltf.scene) p = p.parent;
      return p?.userData ?? {};
    };
    const indice = await this.lightmaps.cargarIndice();
    const clones = new Map();
    const fragüe = new THREE.MeshBasicMaterial({ color: color('junta').multiplyScalar(0.1) });
    for (const m of mallas) {
      const d = extras(m);
      m.userData = { ...d, ...m.userData };
      if (d.rol === 'espejo') {
        this.#convertirEnEspejo(m, calidad);
        continue;
      }
      if (d.rol === 'tarjeta') {
        // jardín: capas renderizadas en Cycles (radiancia × escala en sRGB de 8 bits), sin luz del visor
        const mapa = m.material.map;
        m.material = new THREE.MeshBasicMaterial({ map: mapa, alphaTest: 0.5, side: THREE.DoubleSide });
        m.userData.escalaLuz = d.escala_luz ?? 1;
        this.tarjetas.push(m);
        continue;
      }
      if (d.rol === 'fragüe') {
        // el fragüe solo asoma por juntas de 2 mm: en Cycles se ve casi negro
        m.material = fragüe;
        continue;
      }
      if (/satinado/.test(lista0(m).name)) {
        // tabique ducha–WC: un vidrio con transmisión no se ve a través de otro (three.js dibuja solo lo opaco en el
        // pase de refracción), así que tras el vidrio claro de la ducha desaparecía. Opaco se ve igual desde todos lados.
        m.material = this.#satinadoOpaco();
        continue;
      }
      if (!indice || !d.atlas || d.atlas === 'ninguno') continue;
      // un mismo material puede estar en objetos de atlas distintos: una copia por atlas
      const lista = Array.isArray(m.material) ? m.material : [m.material];
      const nuevos = lista.map((mat) => {
        const k = `${mat.uuid}|${d.atlas}`;
        if (!clones.has(k)) {
          const c = mat.clone();
          c.lightMapIntensity = this.lightmaps.intensidad;
          clones.set(k, c);
          this.conLightmap.push({ material: c, atlas: d.atlas });
        }
        return clones.get(k);
      });
      m.material = Array.isArray(m.material) ? nuevos : nuevos[0];
    }
    this.horneada = !!indice;
    this.#fusionarEstaticos();
    this.#sellarJuntas(fragüe);
    // Hojas que se mueven. En Blender cada puerta tiene el origen en el eje de sus bisagras, pero la cuantización del
    // GLB optimizado lo mueve al centro de su caja (por eso giraban «al medio»): se cuelgan de un pivote en la bisagra.
    const uno = (rol) => this.porRol.get(rol)?.[0];
    const hojas = {
      entrada: [uno('puerta')],
      ducha: [uno('vidrio_puerta'), uno('puerta_ducha_herrajes')],
    };
    for (const h of this.porRol.get('hoja_ventana') ?? []) hojas[`ventana_${h.userData.lado}`] = [h];
    this.#manillasVentana(hojas);
    const moviles = ['entrada', 'ducha', corredera().id]; // la otra hoja de la ventana queda fija
    for (const id of moviles) {
      const p = (hojas[id] ?? []).filter(Boolean);
      if (p.length) this.aberturas.agregar(id, [this.#pivoteHoja(id, p)]);
    }
  }

  /** Grupo del que cuelgan las piezas de una hoja sin moverse de lugar: en el eje de sus bisagras (layout.json) si
   * gira; si corre, en el origen. */
  #pivoteHoja(id, piezas) {
    const [x, z] = bisagra(id) ?? [0, 0];
    const pivote = new THREE.Group();
    pivote.name = `bisagra_${id}`;
    pivote.position.copy(v3(x, 0, z));
    this.raiz.add(pivote);
    pivote.updateMatrixWorld(true);
    for (const p of piezas) pivote.attach(p);
    return pivote;
  }

  /** layout.json pide una manilla en cada hoja de la ventana; la escena horneada trae solo la de la derecha. A la hoja
   * que no la tiene se le agrega una copia reflejada de la otra respecto del eje del vano (misma forma, material y luz
   * horneada), como la dibuja Blender (bb_arquitectura.py). */
  #manillasVentana(hojas) {
    const v = L.ventana;
    const manilla = (lado) => {
      let m = null;
      hojas[`ventana_${lado}`]?.[0]?.traverse((o) => { if (!m && o.isMesh && /negro/.test(lista0(o).name)) m = o; });
      return m;
    };
    for (const lado of v.herrajes.manilla.hojas) {
      const hoja = hojas[`ventana_${lado}`]?.[0];
      const modelo = manilla(lado === 'derecha' ? 'izquierda' : 'derecha');
      if (!hoja || manilla(lado) || !modelo) continue;
      const xm = (v.vano.x[0] + v.vano.x[1]) / 2 / 100;
      modelo.updateWorldMatrix(true, false);
      hoja.updateWorldMatrix(true, false);
      const mundo = new THREE.Matrix4().makeTranslation(2 * xm, 0, 0).multiply(new THREE.Matrix4().makeScale(-1, 1, 1))
        .multiply(modelo.matrixWorld);
      const copia = modelo.clone();
      copia.name = `manilla_ventana_${lado}`;
      hoja.matrixWorld.clone().invert().multiply(mundo).decompose(copia.position, copia.quaternion, copia.scale);
      hoja.add(copia);
    }
  }

  /** Vidrio satinado del tabique, opaco: el gris que se ve desde el lado del WC (color muestreado en la referencia 3). */
  #satinadoOpaco() {
    const d = M.vidrio_satinado ?? {};
    return new THREE.MeshStandardMaterial({
      name: 'vidrio_satinado_opaco',
      color: new THREE.Color(d.color_muestreado ?? d.color_base ?? '#a19688').multiply(new THREE.Color(...SATINADO_COMPENSACION)),
      roughness: d.pbr?.rugosidad ?? 0.5,
      metalness: 0,
    });
  }

  /**
   * Sellos detrás de las terminaciones. Cerámicas, piso y fragüe terminan justo en el plano de cada muro: en los
   * rincones y en las uniones con el piso quedan rendijas de 1 mm por las que se veía el cielo del jardín (líneas
   * verdes). Cajas del color del fragüe, por fuera del baño, cierran esas rendijas sin tocar nada visible: piso, muro
   * derecho bajo el nicho, muro de la ventana (con su vano), muro de la puerta (con el marco) y la junta entre el
   * alféizar y el marco de la ventana.
   */
  #sellarJuntas(material) {
    const X = X_HAB, Z = Z_HAB, H = H_HAB;
    const e = L.muros.espesor;
    const a = 1.05; // la cerámica (0,9 cm) y su fragüe (hasta 1 cm) quedan por delante
    const g = 2; // grosor de los sellos
    const pa = L.puerta_acceso;
    const mx = [pa.vano.x[0] - pa.marco_ancho, pa.vano.x[1] + pa.marco_ancho];
    const my = pa.vano.y[1] + pa.marco_ancho;
    const v = L.ventana;
    const al = v.alfeizar;
    const fondoVentana = Z + (L.muros.ventana.espesor ?? e);
    const nicho = L.ducha.nicho;
    const zPasillo = L.pasillo.z[0] - e;
    const c = 0.05; // holgura con las piezas vecinas
    const cajas = [
      // piso
      [[-e, X + e], [-a - g, -a], [zPasillo, fondoVentana]],
      // muro derecho, bajo la losa del nicho (sobre ella está la obra)
      [[X + a, X + a + g], [-a - g, nicho.y[0] - 1 - c], [-e, fondoVentana]],
      // muro de la ventana: bajo el alféizar, a sus lados y a los lados del vano
      [[-e, X + e], [-a - g, al.y[0] - c], [Z + a, Z + a + g]],
      [[-e, al.x[0] - c], [al.y[0] - c, al.y[1] + c], [Z + a, Z + a + g]],
      [[al.x[1] + c, X + e], [al.y[0] - c, al.y[1] + c], [Z + a, Z + a + g]],
      [[-e, v.vano.x[0] - c], [al.y[1] + c, H], [Z + a, Z + a + g]],
      [[v.vano.x[1] + c, X + e], [al.y[1] + c, H], [Z + a, Z + a + g]],
      // muro de la puerta, alrededor del marco
      [[-e, mx[0] - c], [-a - g, H], [-a - g, -a]],
      [[mx[1] + c, X + e], [-a - g, H], [-a - g, -a]],
      [[mx[0] - c, mx[1] + c], [my + c, H], [-a - g, -a]],
      // bajo el marco de la ventana, detrás del alféizar (entre ambos queda una ranura)
      [[v.vano.x[0] + c, v.vano.x[1] - c], [al.y[1] - 1.5, al.y[1] - 0.01], [al.z[1] - c, v.marco.z_cara_interior + v.marco.espesor]],
    ];
    const geos = cajas.map(([x, y, z]) => new THREE.BoxGeometry((x[1] - x[0]) / 100, (y[1] - y[0]) / 100, (z[1] - z[0]) / 100)
      .translate(...v3((x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2).toArray()));
    const sellos = new THREE.Mesh(mergeGeometries(geos), material);
    sellos.name = 'sellos_juntas';
    sellos.userData.rol = 'sello';
    this.raiz.add(sellos);
    geos.forEach((geo) => geo.dispose());
  }

  /**
   * Junta en una sola malla lo estático que comparte material y colección (menos llamadas de dibujo). Quedan aparte
   * las piezas que se mueven, el espejo y las tarjetas.
   */
  #fusionarEstaticos() {
    const aparte = new Set(['puerta', 'hoja_ventana', 'vidrio_puerta', 'puerta_ducha_herrajes', 'espejo', 'tarjeta']);
    const movil = (o) => { for (let p = o; p; p = p.parent) if (aparte.has(p.userData?.rol)) return true; return false; };
    this.raiz.updateMatrixWorld(true);
    const grupos = new Map();
    this.raiz.traverse((o) => {
      if (!o.isMesh || o.isReflector || !o.visible || o.userData.reemplazado || Array.isArray(o.material) || movil(o)) return;
      const g = o.geometry;
      const firma = [o.material.uuid, o.userData.coleccion ?? '', !!g.index, Object.keys(g.attributes).sort().join()].join('|');
      if (!grupos.has(firma)) grupos.set(firma, []);
      grupos.get(firma).push(o);
    });
    let antes = 0;
    let despues = 0;
    for (const [firma, mallas] of grupos) {
      antes += mallas.length;
      despues += 1;
      if (mallas.length < 2) continue;
      // a flotantes y en coordenadas de mundo (el GLB viene cuantizado, con la escala en cada nodo)
      const geos = mallas.map((m) => {
        const g = new THREE.BufferGeometry();
        for (const [nombre, a] of Object.entries(m.geometry.attributes)) {
          const arr = new Float32Array(a.count * a.itemSize);
          for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(i, c);
          g.setAttribute(nombre, new THREE.BufferAttribute(arr, a.itemSize));
        }
        if (m.geometry.index) g.setIndex(Array.from(m.geometry.index.array));
        g.applyMatrix4(m.matrixWorld);
        return g;
      });
      const unida = new THREE.Mesh(mergeGeometries(geos), mallas[0].material);
      const rol = mallas.every((m) => m.userData.rol === mallas[0].userData.rol) ? mallas[0].userData.rol : 'fusion';
      unida.userData = { rol, coleccion: mallas[0].userData.coleccion, fusion: true };
      this.raiz.add(unida);
      for (const m of mallas) m.removeFromParent();
      geos.forEach((g) => g.dispose());
    }
    console.info(`escena: ${antes} mallas estáticas → ${despues}`);
  }

  /** Reemplaza la malla del espejo por un Reflector del mismo tamaño, en su cara visible. */
  #convertirEnEspejo(malla, calidad) {
    malla.updateWorldMatrix(true, false);
    const caja = new THREE.Box3().setFromObject(malla);
    const t = caja.getSize(new THREE.Vector3());
    const c = caja.getCenter(new THREE.Vector3());
    // el eje más delgado es la normal; el espejo del vanitorio mira hacia +x
    const eje = t.x <= t.y && t.x <= t.z ? 'x' : t.z <= t.y ? 'z' : 'y';
    const [ancho, alto] = eje === 'x' ? [t.z, t.y] : eje === 'z' ? [t.x, t.y] : [t.x, t.z];
    const espejo = new Reflector(new THREE.PlaneGeometry(ancho, alto), {
      textureWidth: Math.round(1024 * calidad.reflejo), textureHeight: Math.round(1024 * calidad.reflejo * alto / ancho),
      clipBias: 0.003, color: new THREE.Color().setRGB(0.9, 0.91, 0.91, THREE.LinearSRGBColorSpace), shader: ESPEJO_SHADER,
    });
    espejo.position.copy(c);
    if (eje === 'x') {
      espejo.position.x = caja.max.x + 0.0005;
      espejo.rotation.y = Math.PI / 2;
    } else if (eje === 'z') {
      espejo.position.z = caja.max.z + 0.0005;
    }
    espejo.userData.rol = 'espejo';
    // el Reflector se vuelve a dibujar cada vez que un render lo incluye (también el pase de transmisión de los
    // vidrios): basta con una vez por cuadro
    const reflejar = espejo.onBeforeRender;
    // dentro del reflejo no se dibujan los vidrios con transmisión: obligarían a otro pase completo de la escena y en el
    // espejo casi no se ven (sus herrajes sí)
    espejo.onBeforeRender = (...args) => {
      if (espejo.userData.cuadro === this.cuadro) return;
      espejo.userData.cuadro = this.cuadro;
      this.transmisivos ??= this.#listarTransmisivos();
      this.transmisivos.forEach((o) => (o.userData.visiblePrevio = o.visible, o.visible = false));
      reflejar.apply(espejo, args);
      this.transmisivos.forEach((o) => (o.visible = o.userData.visiblePrevio));
    };
    malla.visible = false;
    malla.userData.reemplazado = true; // queda oculta siempre
    this.raiz.add(espejo);
    this.espejos.push(espejo);
    return espejo;
  }

  /** Vidrios según la calidad: con transmisión (refracción, satinado borroso) o transparentes simples. */
  aplicarCalidad(config) {
    this.raiz.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        const t = m.userData.transmisionOriginal ?? m.transmission;
        if (!(t > 0)) continue;
        m.userData.transmisionOriginal = t;
        const real = config.transmision !== false;
        m.transmission = real ? t : 0;
        m.transparent = !real;
        m.opacity = real ? 1 : m.roughness > 0.3 ? 0.85 : 0.12;
        // vidrio claro simple: sin el reflejo de la sonda (en la ventana dejaba una banda clara); el satinado lo conserva
        m.userData.envOriginal ??= m.envMapIntensity;
        m.envMapIntensity = real || m.roughness > 0.3 ? m.userData.envOriginal : 0;
        m.depthWrite = real;
        m.needsUpdate = true;
      }
    });
  }

  #listarTransmisivos() {
    const lista = [];
    this.raiz.traverse((o) => {
      const mats = o.isMesh ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      if (mats.some((m) => m.transmission > 0 || m.userData.transmisionOriginal > 0)) lista.push(o);
    });
    return lista;
  }

  /** Sonda cúbica del baño ya iluminado: reflejos de cromo, loza, vidrio y porcelanato (PMREM). */
  #capturarSonda() {
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.05, 30, rt);
    cam.position.copy(v3(X_HAB / 2, 150, Z_HAB / 2));
    this.scene.add(cam);
    this.scene.environment = null;
    const visibles = this.espejos.map((e) => e.visible);
    this.espejos.forEach((e) => (e.visible = false));
    cam.update(this.renderer, this.scene);
    this.espejos.forEach((e, i) => (e.visible = visibles[i]));
    this.scene.remove(cam);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const tex = pmrem.fromCubemap(rt.texture).texture;
    pmrem.dispose();
    rt.dispose();
    this.sonda?.dispose();
    this.sonda = tex;
    this.scene.environment = tex;
    this.scene.environmentIntensity = 1;
  }

  // --- versión de volúmenes (antes de tener el modelo horneado) ------------------------------
  #caja(nombre, x, y, z, mat, rol) {
    const [x0, x1] = [Math.min(...x), Math.max(...x)];
    const [y0, y1] = [Math.min(...y), Math.max(...y)];
    const [z0, z1] = [Math.min(...z), Math.max(...z)];
    const geo = new THREE.BoxGeometry((x1 - x0) / 100, (y1 - y0) / 100, (z1 - z0) / 100);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(v3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
    m.name = nombre;
    m.userData.rol = rol;
    m.castShadow = m.receiveShadow = true;
    this.raiz.add(m);
    this.#registrar(m);
    return m;
  }

  #mat(id, extra = {}) {
    const d = M[id] ?? {};
    const pbr = d.pbr ?? {};
    const base = { color: color(id), roughness: pbr.rugosidad ?? 0.6, metalness: pbr.metalico ?? 0, ...extra };
    if (pbr.transmision) {
      return new THREE.MeshPhysicalMaterial({ ...base, transmission: pbr.transmision, ior: pbr.ior ?? 1.5, thickness: 0.01 });
    }
    return new THREE.MeshStandardMaterial(base);
  }

  #construirVolumenes(calidad) {
    const X = X_HAB, Z = Z_HAB, H = H_HAB;
    const pint = this.#mat('pintura_crema');
    const porc = this.#mat('porcelanato_muro');
    const piso = this.#mat('porcelanato_piso');
    const madera = this.#mat('madera_muebles');
    const blanco = this.#mat('cubierta_blanca');
    const negro = this.#mat('negro_mate');
    // envolvente
    this.#caja('piso', [0, X], [-2, 0], [-12, Z], piso, 'piso');
    this.#caja('cielo', [0, X], [H, H + 2], [0, Z], this.#mat('pintura_cielo'), 'cielo');
    this.#caja('muro_izquierdo', [-12, 0], [0, H], [0, Z], pint, 'muro');
    this.#caja('muro_derecho', [X, X + 12], [0, H], [0, Z], porc, 'muro');
    const pa = L.puerta_acceso.vano;
    this.#caja('muro_puerta_a', [0, pa.x[0]], [0, H], [-12, 0], pint, 'muro');
    this.#caja('muro_puerta_b', [pa.x[1], X], [0, H], [-12, 0], porc, 'muro');
    this.#caja('muro_puerta_dintel', pa.x, [pa.y[1], H], [-12, 0], pint, 'muro');
    this.#puertaAcceso();
    this.#pasillo();
    const wv = L.ventana.vano;
    this.#caja('muro_ventana_a', [0, wv.x[0]], [0, H], [Z, Z + 30], porc, 'muro');
    this.#caja('muro_ventana_b', [wv.x[1], X], [0, H], [Z, Z + 30], porc, 'muro');
    this.#caja('antepecho', wv.x, [0, wv.y[0]], [Z, Z + 30], porc, 'muro');
    this.#ventana();
    this.#caja('cornisa', wv.x, [L.ventana.marco.y[1], H], [Z, Z + 30], pint, 'muro');
    // muebles
    for (const id of ['columna_estrecha', 'columna_alta']) {
      const c = L[id];
      this.#caja(id, c.x, c.y, c.z, madera, 'colision');
    }
    const v = L.vanitorio;
    this.#caja('vanitorio', v.x, [v.y[0], v.cubierta.y[0]], v.z, madera, 'colision');
    this.#caja('cubierta', v.cubierta.x, v.cubierta.y, v.z, blanco, 'colision');
    // espejo con reflejo en tiempo real
    const e = L.espejo;
    const espejo = new Reflector(new THREE.PlaneGeometry((e.z[1] - e.z[0]) / 100, (e.y[1] - e.y[0]) / 100), {
      textureWidth: Math.round(1024 * calidad.reflejo), textureHeight: Math.round(680 * calidad.reflejo), clipBias: 0.003,
      color: 0xd9dede,
    });
    espejo.position.copy(v3(e.x[1], (e.y[0] + e.y[1]) / 2, (e.z[0] + e.z[1]) / 2));
    espejo.rotation.y = Math.PI / 2;
    espejo.userData.rol = 'espejo';
    this.raiz.add(espejo);
    this.espejos.push(espejo);
    // ducha
    const du = L.ducha;
    const fr = du.frente_vidrio;
    const vidrio = this.#mat('vidrio_claro', { transparent: true, opacity: 0.25 });
    const fijo = fr.paneles.find((p) => p.tipo === 'fijo');
    const pd = fr.paneles.find((p) => p.tipo === 'puerta');
    this.#caja('vidrio_fijo', [fr.x, fr.x + fr.espesor], [0, H], fijo.z, vidrio, 'vidrio');
    const pivote = new THREE.Group();
    pivote.position.copy(v3(fr.x + fr.espesor / 2, 0, pd.z[0]));
    this.raiz.add(pivote);
    const hoja = this.#caja('vidrio_puerta', [fr.x, fr.x + fr.espesor], [0, H], pd.z, vidrio, 'vidrio_puerta');
    hoja.position.sub(pivote.position);
    pivote.add(hoja);
    const tir = pd.tirador;
    const tirador = this.#caja('tirador', [fr.x - 4.6, fr.x + 5.6], tir.y, [tir.z - 1, tir.z + 1], negro, 'tirador');
    tirador.position.sub(pivote.position);
    pivote.add(tirador);
    this.aberturas.agregar('ducha', [pivote]);
    this.#caja('tabique', du.tabique.x, [0, H], [du.tabique.z, du.tabique.z + 1], this.#mat('vidrio_satinado', { transparent: true, opacity: 0.85 }), 'vidrio');
    const ni = du.nicho;
    this.#caja('nicho', [X - 0.5, X + 0.2], ni.y, ni.z, this.#mat('relieve_ondas'), 'nicho');
    const w = L.wc;
    const semi = Math.max(w.taza.ancho, w.estanque.ancho) / 2;
    this.#caja('wc_taza', w.taza.x, [0, w.taza.asiento_y], [w.eje_z - w.taza.ancho / 2, w.eje_z + w.taza.ancho / 2], this.#mat('loza_blanca'), 'colision');
    this.#caja('wc_estanque', w.estanque.x, w.estanque.y, [w.eje_z - semi, w.eje_z + semi], this.#mat('loza_blanca'), 'colision');
    const rw = L.repisas_wc;
    for (const n of rw.niveles) this.#caja(n.id, rw.x, [n.y - rw.espesor, n.y], rw.z, this.#mat('madera_repisas_wc'), 'repisa');
    const a = L.alfombra;
    this.#caja('alfombra', a.x, [0, a.espesor], a.z, this.#mat('alfombra_yute'), 'alfombra');
    this.#calentador();
    // luces aproximadas (el modelo horneado trae la luz en sus lightmaps)
    this.luces = new THREE.Group();
    for (const f of [...L.focos_cielo, L.pasillo.foco]) {
      const l = new THREE.PointLight(0xffd7a8, 1.6, 4, 2);
      l.position.copy(v3(f.x, H - 5, f.z));
      this.luces.add(l);
    }
    this.luces.add(new THREE.HemisphereLight(0xfff4e6, 0x8a7560, 0.6));
    this.scene.add(this.luces);
  }

  /** Grupo con pivote en un punto de layout; las piezas se agregan en coordenadas de layout. */
  #pivote(nombre, x, y, z) {
    const g = new THREE.Group();
    g.name = nombre;
    g.position.copy(v3(x, y, z));
    this.raiz.add(g);
    return g;
  }

  #colgar(pivote, malla) {
    malla.position.sub(pivote.position);
    pivote.add(malla);
    return malla;
  }

  #puertaAcceso() {
    const pa = L.puerta_acceso;
    const [x0, x1] = pa.vano.x;
    const bx = pa.lado_bisagras === 'x_min' ? x0 + 1.6 : x1 - 1.6;
    const piv = this.#pivote('puerta_hoja', bx, 0, 0);
    this.#colgar(piv, this.#caja('puerta_tablero', [x0 + 1.6, x1 - 1.6], [0.8, pa.vano.y[1] - 1.7], [-pa.hoja_espesor - 0.5, -0.5],
      this.#mat('pintura_puerta_blanca'), 'puerta'));
    const m = pa.manilla;
    const negro = this.#mat('negro_mate');
    [[-0.5, 6], [-pa.hoja_espesor - 0.5, -6]].forEach(([z, d], i) =>
      this.#colgar(piv, this.#caja(`manilla_${i}`, [m.x - 12, m.x], [m.y - 1, m.y + 1], [z, z + d], negro, 'manilla')));
    this.aberturas.agregar('entrada', [piv]);
  }

  #pasillo() {
    const p = L.pasillo;
    const mt = p.materiales;
    this.#caja('pasillo_piso', p.x, [-2, 0], p.z, this.#mat(mt.piso), 'pasillo');
    this.#caja('pasillo_cielo', p.x, [p.y[1], p.y[1] + 2], p.z, this.#mat(mt.cielo), 'pasillo');
    const muro = this.#mat(mt.muros);
    this.#caja('pasillo_fondo', p.x, p.y, [p.z[0] - 2, p.z[0]], muro, 'pasillo');
    this.#caja('pasillo_izq', [p.x[0] - 2, p.x[0]], p.y, p.z, muro, 'pasillo');
    this.#caja('pasillo_der', [p.x[1], p.x[1] + 2], p.y, p.z, muro, 'pasillo');
  }

  #ventana() {
    const v = L.ventana;
    const [x0, x1] = v.vano.x;
    const [y0, y1] = v.marco.y;
    const zc = v.marco.z_cara_interior;
    const fp = v.marco.ancho_perfil;
    const hp = v.hojas.ancho_perfil;
    const mu = (x0 + x1) / 2;
    const pw = v.parteluz.ancho;
    const ytr = y1 - v.montante.alto;
    const madera = this.#mat('madera_ventana');
    const vidrio = this.#mat('vidrio_claro', { transparent: true, opacity: 0.12 });
    const anillo = (nombre, [a, b], [c, d], z, ancho, padre) => {
      const piezas = [[[a, a + ancho], [c, d]], [[b - ancho, b], [c, d]], [[a + ancho, b - ancho], [c, c + ancho]], [[a + ancho, b - ancho], [d - ancho, d]]]
        .map(([px, py], i) => this.#caja(`${nombre}_${i}`, px, py, z, madera, 'ventana'));
      if (padre) piezas.forEach((m) => this.#colgar(padre, m));
      return piezas;
    };
    anillo('ventana_marco', [x0, x1], [y0, y1], [zc, zc + 7], fp);
    this.#caja('ventana_parteluz', [mu - pw / 2, mu + pw / 2], [y0 + fp, y1 - fp], [zc - 0.5, zc + 5], madera, 'ventana');
    this.#caja('ventana_travesano', [x0 + fp, x1 - fp], [ytr - 1, ytr + 1], [zc - 0.3, zc + 5], madera, 'ventana');
    this.#caja('ventana_montantes', [x0 + fp, x1 - fp], [ytr + 1, y1 - fp], [zc + 2.6, zc + 3.2], vidrio, 'vidrio');
    const conManilla = v.herrajes.manilla.hojas;
    const movil = corredera().id;
    for (const [lado, hx, bx] of [['izquierda', [x0 + fp, mu - pw / 2], x0 + fp], ['derecha', [mu + pw / 2, x1 - fp], x1 - fp]]) {
      const piv = this.#pivote(`ventana_hoja_${lado}`, bx, 0, zc - 0.4);
      const piezas = anillo(`ventana_hoja_${lado}`, hx, [y0 + fp, ytr - 1], [zc + 0.5, zc + 5.5], hp, piv);
      piezas.push(this.#colgar(piv, this.#caja(`ventana_vidrio_${lado}`, [hx[0] + hp, hx[1] - hp], [y0 + fp + hp, ytr - 1 - hp],
        [zc + 2.6, zc + 3.2], vidrio, 'vidrio')));
      if (conManilla.includes(lado)) {
        const um = lado === 'derecha' ? hx[0] + 2.2 : hx[1] - 2.2;
        const my = v.herrajes.manilla.y;
        piezas.push(this.#colgar(piv, this.#caja('ventana_manilla', [um - 0.6, um + 0.6], [my - 11, my + 2], [zc - 3, zc + 0.5],
          this.#mat('negro_mate'), 'manilla')));
      }
      if (`ventana_${lado}` === movil) this.aberturas.agregar(movil, [piv]);
    }
  }

  #calentador() {
    const c = L.calentador_toallas;
    const negro = this.#mat(c.material);
    const zc = Z_HAB - c.separacion_muro;
    const rt = c.tubos.diametro / 2;
    const rb = c.barras.diametro / 2;
    const [xa, xb] = [c.x[0] + rt, c.x[1] - rt];
    for (const x of [xa, xb]) this.#caja('calentador_tubo', [x - rt, x + rt], c.y, [zc - rt, zc + rt], negro, 'calentador');
    for (const y of c.barras.y) this.#caja('calentador_barra', [xa, xb], [y - rb, y + rb], [zc - rb, zc + rb], negro, 'calentador');
    const t = c.toalla;
    const xm = (c.x[0] + c.x[1]) / 2;
    this.#caja('toalla_calentador', [xm - t.ancho / 2, xm + t.ancho / 2], [t.barra_y - t.caida, t.barra_y + rb + 0.6],
      [zc - rb - 0.8, zc + rb + 0.8], this.#mat(t.material), 'toalla');
  }

  // --- interacción --------------------------------------------------------------------------
  actualizar(dt) {
    this.aberturas.actualizar(dt);
  }

  async aplicarIluminacion() {
    this.scene.background = this.fondo;
    if (this.horneada) {
      // como en Cycles: el HDRI con su giro y su intensidad; la luz del baño viene de los lightmaps
      const f = this.lightmaps.ajustes(AMBIENTE)?.fondo ?? { rotacion: 0, intensidad: 1 };
      this.scene.backgroundRotation.set(0, f.rotacion, 0);
      this.scene.backgroundIntensity = f.intensidad;
      const texturas = await this.lightmaps.juego(AMBIENTE);
      for (const { material, atlas } of this.conLightmap) {
        const primera = !material.lightMap;
        material.lightMap = texturas[atlas] ?? null;
        if (primera) material.needsUpdate = true;
      }
      for (const t of this.tarjetas) t.material.color.setScalar(t.userData.escalaLuz);
      this.#capturarSonda();
      return;
    }
    this.scene.environment = this.fondo;
    this.scene.environmentIntensity = 0.6;
    this.scene.backgroundIntensity = 1.0;
    if (this.luces) this.luces.children.forEach((l) => (l.intensity = l.isPointLight ? 1.2 : 0.6));
  }

  /** Después de perder el contexto WebGL (frecuente en teléfonos al cambiar de app): three.js vuelve a subir mallas y
   * texturas, pero lo que se dibujó en la GPU se pierde. Se decodifican de nuevo los lightmaps y se recaptura la sonda. */
  async restaurarContexto() {
    if (!this.horneada) return;
    this.lightmaps.juegos = {};
    await this.aplicarIluminacion();
  }

  /** Exposición (pasos) y matriz de balance de blancos, como en los renders de Cycles. */
  ajustesColor() {
    const a = this.horneada ? this.lightmaps.ajustes(AMBIENTE) : null;
    return a ? { exposicion: a.exposicion, balance: a.balance } : null;
  }
}
