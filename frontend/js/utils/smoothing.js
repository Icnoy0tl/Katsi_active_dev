/**
 * Acerca `current` a `target` una fracción `rate · delta` del camino restante (suavizado
 * exponencial por fotograma) y lo fija en `target` cuando la diferencia baja de `epsilon`.
 */
export function approach(current, target, rate, delta, epsilon) {
  const step = target - current;
  return Math.abs(step) < epsilon ? target : current + step * Math.min(1, rate * delta);
}
