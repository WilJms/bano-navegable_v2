// Niveles de calidad. Siempre parte en Alta, en cualquier equipo; el visitante puede bajarla desde la barra.
export const NIVELES = {
  // transmision: vidrios con refracción real (un pase más de la escena); sin ella, vidrios transparentes simples
  alta: { nombre: 'Alta', pixeles: 2.0, bloom: true, reflejo: 1.0, transmision: true },
  media: { nombre: 'Media', pixeles: 1.5, bloom: true, reflejo: 0.6, transmision: false },
  baja: { nombre: 'Baja', pixeles: 1.0, bloom: false, reflejo: 0.4, transmision: false },
};

// siempre Alta; ?calidad=media|baja en la URL solo para pruebas (las automáticas corren sin GPU)
const pedido = new URLSearchParams(location.search).get('calidad');
export const NIVEL_INICIAL = NIVELES[pedido] ? pedido : 'alta';

/** Nombre de la GPU (solo para el panel de depuración). */
function nombreGpu(renderer) {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
}

export class Calidad {
  constructor(renderer, alCambiar) {
    this.renderer = renderer;
    this.alCambiar = alCambiar;
    this.gpu = nombreGpu(renderer);
    this.nivel = NIVEL_INICIAL;
    this.aplicar();
  }

  get config() {
    return NIVELES[this.nivel];
  }

  elegir(nivel) {
    if (!NIVELES[nivel]) return;
    this.nivel = nivel;
    this.aplicar();
  }

  aplicar() {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.config.pixeles));
    this.alCambiar?.(this);
  }
}
