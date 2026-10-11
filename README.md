# Baño Beatriz · Recorrido 3D

Recorrido en primera persona del Baño Beatriz (180 × 224 × 250 cm): vanitorio suspendido de roble con columnas, ducha walk-in con relieve de ondas y nicho iluminado, WC con repisas y una ventana de madera que mira a un jardín. Funciona en el navegador de escritorio y del teléfono, sin instalar nada.

> Estado: el recorrido usa el modelo completo con la iluminación horneada en Blender (`public/models/bano.glb` y `public/lightmaps/`).

## Cómo publicar en GitHub Pages

1. Crea un repositorio **público** vacío en GitHub (en el plan gratuito, Pages requiere repositorio público). El nombre que elijas será parte de la URL.
2. Desde esta carpeta (`bano-beatriz-web/`), sube el contenido a la rama `main`:

   ```bash
   git add -A
   git commit -m "Recorrido 3D del Baño Beatriz"
   git remote add origin https://github.com/<usuario>/<repositorio>.git
   git push -u origin main
   ```

3. En el repositorio: **Settings → Pages → Source: GitHub Actions**.
4. Espera a que el workflow «Publicar en GitHub Pages» termine en verde (pestaña **Actions**) y abre `https://<usuario>.github.io/<repositorio>/`.

Cada push a `main` vuelve a publicar el sitio. No hay pasos manuales adicionales.

## Probar en tu computador

Requiere Node 24 o superior.

```bash
npm ci
npm run dev
```

Abre la dirección que muestra la consola. Para ver el sitio tal como quedará publicado:

```bash
npm run build
npm run preview
```

Agrega `?debug` a la URL para ver fps, draw calls, triángulos y la GPU detectada. `?calidad=media` o `?calidad=baja` cambian la calidad inicial (solo para pruebas: el sitio siempre parte en Alta).

## Controles

| Escritorio | Teléfono y tablet |
| --- | --- |
| Arrastrar con el mouse (botón apretado) para mirar | Control abajo a la izquierda para caminar |
| W A S D o flechas para caminar (Shift: más rápido) | Arrastrar el dedo en el resto de la pantalla para mirar |
| Rueda para el campo visual | Pellizcar para el campo visual |

Arriba están los botones para abrir y cerrar la puerta de entrada, la puerta de la ducha y la ventana (corredera: la hoja derecha se corre delante de la izquierda), la calidad (Alta, Media, Baja; siempre parte en Alta), la pantalla completa y la ayuda. Tocar la escena no abre nada: solo los botones. El recorrido es de día.

## Lista de verificación en teléfonos reales

Prueba en un iPhone (Safari) y en un Android de gama media (Chrome):

- [ ] La pantalla de carga avanza y el recorrido abre en menos de 6 s con buena señal.
- [ ] El joystick mueve sin saltos y no se puede atravesar muebles, vidrios ni muros.
- [ ] Arrastrar con el dedo mira alrededor; pellizcar cambia el campo visual.
- [ ] En vertical y en horizontal la interfaz se lee completa y nada queda tapado.
- [ ] En calidad Alta el recorrido se mantiene fluido (≥ 30 fps con `?debug`); si no, Media.
- [ ] El espejo refleja la ducha y el WC.
- [ ] Cada botón abre y cierra lo suyo: la puerta de entrada gira hacia adentro hasta la columna, la de la ducha hacia el fondo de la ducha, y la hoja derecha de la ventana se corre delante de la izquierda.
- [ ] La cámara no atraviesa las puertas abiertas.

## Contenido

- `src/`: código del visor (three.js): escena, aberturas animadas, controles y colisiones, calidad e interfaz.
- `src/datos/layout.json` y `materials.json`: medidas y colores, copiados desde la especificación del proyecto.
- `public/`: modelo, lightmaps de día, cielo (HDRI), transcoder KTX2 y renders fijos.
- `CREDITOS.md`: recursos CC0 usados y sus autores.
