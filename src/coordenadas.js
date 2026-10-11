// Medidas y conversión de coordenadas. layout.json (copia de especificacion/layout.json) es la única fuente.
// layout: cm, x = ancho, y = altura, z = profundidad (0 puerta → 224 ventana), sistema de mano izquierda.
// three.js: metros, mano derecha → (x, y, z)cm ↦ (x/100, y/100, −z/100).
import * as THREE from 'three';
import layout from './datos/layout.json';

export const L = layout;
export const X_HAB = L.habitacion.ancho;
export const Z_HAB = L.habitacion.largo;
export const H_HAB = L.habitacion.alto;

export const v3 = (x, y, z) => new THREE.Vector3(x / 100, y / 100, -z / 100);

/** three.js → layout (cm) en planta. */
export const aPlanta = (p) => ({ x: p.x * 100, z: -p.z * 100 });

/** Ruta de un recurso público, válida bajo cualquier subruta de GitHub Pages. */
export const recurso = (ruta) => `${import.meta.env.BASE_URL}${ruta}`;
