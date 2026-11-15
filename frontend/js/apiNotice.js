/**
 * Aviso flotante sobre el estado de la API de análogos. analogs.js emite `katsi:api` en `window`
 * con `detail` = 'slow' (la petición tarda), 'failed' (no respondió o respondió 5xx) u 'ok'.
 * La API está en el plan gratuito de Render: se duerme sin tráfico y tarda hasta un minuto en
 * arrancar, así que se explica al usuario y se le pide reintentar. Si falla dos veces seguidas,
 * el mensaje cambia (ya no es solo el arranque).
 */
const MESSAGES = {
  slow: {
    title: 'Waking up the server…',
    body: 'Katsí runs on a free hosting plan that sleeps when nobody is using it. The first request can take up to a minute; thanks for your patience.'
  },
  failed: {
    title: 'The server didn’t respond',
    body: 'Katsí runs on a free hosting plan that sleeps when idle, so it was probably still starting up. Please press Retry once more.'
  },
  failedAgain: {
    title: 'The server is still unavailable',
    body: 'The free server seems to be down right now. Please try again in a few minutes.'
  }
};

export function setupApiNotice() {
  const notice = document.createElement('div');
  notice.className = 'api-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.hidden = true;
  notice.innerHTML = `
    <span class="api-notice-dot" aria-hidden="true"></span>
    <div class="api-notice-text"><strong></strong><p></p></div>
    <button type="button" class="api-notice-close" aria-label="Dismiss">×</button>`;
  document.body.append(notice);

  const title = notice.querySelector('strong');
  const body = notice.querySelector('p');
  let failures = 0;

  const hide = () => {
    notice.hidden = true;
  };
  const show = (key) => {
    const { title: t, body: b } = MESSAGES[key];
    title.textContent = t;
    body.textContent = b;
    notice.dataset.state = key === 'slow' ? 'slow' : 'failed';
    notice.hidden = false;
  };

  notice.querySelector('.api-notice-close').addEventListener('click', hide);
  window.addEventListener('katsi:api', ({ detail }) => {
    if (detail === 'ok') {
      failures = 0;
      hide();
    } else if (detail === 'slow') {
      show('slow');
    } else if (detail === 'failed') {
      failures += 1;
      show(failures > 1 ? 'failedAgain' : 'failed');
    }
  });
}
