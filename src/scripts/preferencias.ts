/**
 * Decisión única sobre `prefers-reduced-motion`.
 *
 * Por defecto los efectos SE EJECUTAN aunque el sistema pida menos movimiento.
 * Es una decisión deliberada del dueño del sitio: en este equipo la opción de
 * Windows «Efectos de animación» está desactivada y eso dejaba el preloader y
 * el scroll suave invisibles, que es justo lo que se quería mostrar.
 *
 * Para volver a respetar la preferencia del sistema (lo recomendable si el
 * sitio va a público general), pon esta constante en `true`. Es el único sitio
 * que hay que tocar: todos los componentes preguntan por aquí.
 */
export const RESPETAR_MOVIMIENTO_REDUCIDO = false;

/** `true` si hay que reducir el movimiento. */
export function movimientoReducido(): boolean {
  if (!RESPETAR_MOVIMIENTO_REDUCIDO) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * `true` si hay ratón de verdad (no táctil).
 *
 * La consulta se guarda una sola vez: `matchMedia()` crea un objeto nuevo en
 * cada llamada y esto se pregunta dentro de manejadores de `pointermove`.
 * El `MediaQueryList` se actualiza solo, así que seguir cacheado es correcto.
 */
let consultaPuntero: MediaQueryList | undefined;
export function punteroFino(): boolean {
  consultaPuntero ??= window.matchMedia("(hover: hover) and (pointer: fine)");
  return consultaPuntero.matches;
}
