(() => {
  if (window.NotificacoesFA) return;
  const TOKEN_KEY = 'fcm_token_super_agenda';
  const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.5/';

  function carregarScript_(src) {
    return new Promise((resolve, reject) => {
      const existente = document.querySelector('script[src="' + src + '"]');
      if (existente) { existente.addEventListener('load', resolve, { once: true }); if (window.firebase) resolve(); return; }
      const s = document.createElement('script');
      s.src = src; s.async = true; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function carregarSdk_() {
    if (window.firebase && firebase.messaging) return;
    await carregarScript_(SDK_BASE + 'firebase-app-compat.js');
    await carregarScript_(SDK_BASE + 'firebase-messaging-compat.js');
  }

  function plataforma_() {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return 'iOS';
    if (/Android/.test(ua)) return 'Android';
    return 'Desktop';
  }

  function nomeDispositivo_() {
    const plataforma = plataforma_();
    const navegador = /CriOS/.test(navigator.userAgent) ? 'Chrome' :
      (/FxiOS/.test(navigator.userAgent) ? 'Firefox' :
        (/Safari/.test(navigator.userAgent) && !/Chrome|Chromium/.test(navigator.userAgent) ? 'Safari' :
          (/Chrome|Chromium/.test(navigator.userAgent) ? 'Chrome' : 'Navegador')));
    return plataforma + ' - ' + navegador;
  }

  async function status() {
    return Auth.apiCall('obterStatusNotificacoes');
  }

  async function obterRegistroEToken_(cfg) {
    await carregarSdk_();
    if (!firebase.apps.length) firebase.initializeApp(cfg.firebase);
    const reg = await navigator.serviceWorker.register('./sw-agenda.js', { scope: './' });
    await navigator.serviceWorker.ready;
    const messaging = firebase.messaging();
    const token = await messaging.getToken({ vapidKey: cfg.vapidPublicKey, serviceWorkerRegistration: reg });
    return { reg, messaging, token };
  }

  // Não solicita permissão. Apenas restaura o vínculo quando o iOS já autorizou
  // notificações, mas o armazenamento local do web app foi perdido/separado.
  async function sincronizar(preferencias) {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return status();
    if (Notification.permission !== 'granted') return status();
    const cfg = await status();
    if (!cfg.disponivel) return cfg;
    const atual = await obterRegistroEToken_(cfg);
    if (!atual.token) return cfg;
    localStorage.setItem(TOKEN_KEY, atual.token);
    await Auth.apiCall('registrarDispositivoNotificacao', Object.assign({
      token: atual.token,
      plataforma: plataforma_(),
      navegador: navigator.userAgent.slice(0, 120),
      nomeDispositivo: nomeDispositivo_()
    }, preferencias || {}));
    return status();
  }

  async function ativar(preferencias) {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('NOTIFICACOES_NAO_SUPORTADAS');
    // No iOS, requestPermission precisa ser a primeira operação assíncrona após
    // o toque. Uma consulta de rede antes dela perde a ativação do usuário e o
    // WebKit pode negar o pedido sem exibir o diálogo do sistema.
    let permissao = Notification.permission;
    if (permissao === 'default') permissao = await Notification.requestPermission();
    if (permissao !== 'granted') throw new Error('PERMISSAO_NAO_CONCEDIDA');
    const cfg = await status();
    if (!cfg.disponivel) throw new Error('FCM_CONFIG_INCOMPLETA');
    const atual = await obterRegistroEToken_(cfg);
    const reg = atual.reg;
    const messaging = atual.messaging;
    if (!messaging.__superAgendaForegroundConfigurado) {
      messaging.onMessage((payload) => {
        const n = payload.notification || {};
        reg.showNotification(n.title || 'Super Agenda', {
          body: n.body || '',
          icon: './img/android-192.png',
          data: { url: payload.data?.url || './index.html?menu=1' }
        }).catch(() => {});
      });
      messaging.__superAgendaForegroundConfigurado = true;
    }
    const token = atual.token;
    if (!token) throw new Error('FCM_TOKEN_NAO_GERADO');
    localStorage.setItem(TOKEN_KEY, token);
    await Auth.apiCall('registrarDispositivoNotificacao', Object.assign({
      token: token,
      plataforma: plataforma_(),
      navegador: navigator.userAgent.slice(0, 120),
      nomeDispositivo: nomeDispositivo_()
    }, preferencias || {}));
    return status();
  }

  async function desativar() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) await Auth.apiCall('removerDispositivoNotificacao', { token: token });
    try {
      const cfg = await status();
      if (cfg.disponivel && Notification.permission === 'granted') {
        await carregarSdk_();
        if (!firebase.apps.length) firebase.initializeApp(cfg.firebase);
        await firebase.messaging().deleteToken();
      }
    } catch (_) {}
    localStorage.removeItem(TOKEN_KEY);
    return status();
  }

  async function salvarPreferencias(preferencias) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) throw new Error('DISPOSITIVO_NAO_ATIVADO');
    await Auth.apiCall('atualizarPreferenciasNotificacao', Object.assign({ token: token }, preferencias || {}));
    return status();
  }

  window.NotificacoesFA = { status, sincronizar, ativar, desativar, salvarPreferencias, token: () => localStorage.getItem(TOKEN_KEY) };
})();
