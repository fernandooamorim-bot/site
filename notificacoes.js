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

  async function status() {
    return Auth.apiCall('obterStatusNotificacoes');
  }

  async function ativar(preferencias) {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('NOTIFICACOES_NAO_SUPORTADAS');
    const cfg = await status();
    if (!cfg.disponivel) throw new Error('FCM_CONFIG_INCOMPLETA');
    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') throw new Error('PERMISSAO_NAO_CONCEDIDA');
    await carregarSdk_();
    if (!firebase.apps.length) firebase.initializeApp(cfg.firebase);
    const reg = await navigator.serviceWorker.register('./sw-agenda.js', { scope: './' });
    await navigator.serviceWorker.ready;
    const token = await firebase.messaging().getToken({ vapidKey: cfg.vapidPublicKey, serviceWorkerRegistration: reg });
    if (!token) throw new Error('FCM_TOKEN_NAO_GERADO');
    localStorage.setItem(TOKEN_KEY, token);
    await Auth.apiCall('registrarDispositivoNotificacao', Object.assign({
      token: token,
      plataforma: plataforma_(),
      navegador: navigator.userAgent.slice(0, 120)
    }, preferencias || {}));
    return status();
  }

  async function desativar() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) await Auth.apiCall('removerDispositivoNotificacao', { token: token });
    localStorage.removeItem(TOKEN_KEY);
    return status();
  }

  async function salvarPreferencias(preferencias) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) throw new Error('DISPOSITIVO_NAO_ATIVADO');
    await Auth.apiCall('atualizarPreferenciasNotificacao', Object.assign({ token: token }, preferencias || {}));
    return status();
  }

  window.NotificacoesFA = { status, ativar, desativar, salvarPreferencias, token: () => localStorage.getItem(TOKEN_KEY) };
})();
