(() => {
  if (window.NotificacoesFA) return;
  const IDENTIFICADOR_KEY = 'fcm_identificador_super_agenda';
  const TIPO_KEY = 'fcm_tipo_identificador_super_agenda';
  const TOKEN_LEGADO_KEY = 'fcm_token_super_agenda';
  const DESATIVADO_KEY = 'fcm_notificacoes_desativadas_super_agenda';
  const SDK_BASE = 'https://www.gstatic.com/firebasejs/12.16.0/';
  let sdkPromise_ = null;
  let contextoPromise_ = null;

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

  function identificadorLocal_() {
    return localStorage.getItem(IDENTIFICADOR_KEY) || localStorage.getItem(TOKEN_LEGADO_KEY) || '';
  }

  function tipoLocal_() {
    return localStorage.getItem(TIPO_KEY) || (localStorage.getItem(TOKEN_LEGADO_KEY) ? 'TOKEN_LEGADO' : '');
  }

  async function carregarSdk_() {
    if (!sdkPromise_) {
      sdkPromise_ = Promise.all([
        import(SDK_BASE + 'firebase-app.js'),
        import(SDK_BASE + 'firebase-messaging.js')
      ]).then(([appSdk, messagingSdk]) => ({ appSdk, messagingSdk }));
    }
    return sdkPromise_;
  }

  async function status() {
    return Auth.apiCall('obterStatusNotificacoes');
  }

  async function contextoFirebase_(cfg) {
    if (!contextoPromise_) {
      contextoPromise_ = (async () => {
        const sdk = await carregarSdk_();
        const suportado = await sdk.messagingSdk.isSupported();
        if (!suportado) throw new Error('FCM_NAO_SUPORTADO_NESTE_NAVEGADOR');
        const app = sdk.appSdk.getApps().length ? sdk.appSdk.getApps()[0] : sdk.appSdk.initializeApp(cfg.firebase);
        const reg = await navigator.serviceWorker.register('./sw-agenda.js', { scope: './' });
        await navigator.serviceWorker.ready;
        return { sdk, app, reg, messaging: sdk.messagingSdk.getMessaging(app) };
      })().catch((erro) => { contextoPromise_ = null; throw erro; });
    }
    return contextoPromise_;
  }

  async function registrarFid_(cfg) {
    const ctx = await contextoFirebase_(cfg);
    return new Promise((resolve, reject) => {
      let concluido = false;
      let timer = null;
      let cancelar = () => {};
      const finalizar = (erro, fid) => {
        if (concluido) return;
        concluido = true;
        if (timer) clearTimeout(timer);
        try { cancelar(); } catch (_) {}
        if (erro) reject(erro); else resolve({ ...ctx, fid });
      };
      cancelar = ctx.sdk.messagingSdk.onRegistered(ctx.messaging, (fid) => {
        if (fid) finalizar(null, String(fid));
      });
      timer = setTimeout(() => finalizar(new Error('FCM_FID_TIMEOUT')), 20000);
      ctx.sdk.messagingSdk.register(ctx.messaging, {
        vapidKey: cfg.vapidPublicKey,
        serviceWorkerRegistration: ctx.reg
      }).catch((erro) => finalizar(erro));
    });
  }

  function configurarForeground_(ctx) {
    if (ctx.messaging.__superAgendaForegroundConfigurado) return;
    ctx.sdk.messagingSdk.onMessage(ctx.messaging, (payload) => {
      const n = payload.notification || {};
      ctx.reg.showNotification(n.title || 'Super Agenda', {
        body: n.body || '',
        icon: './img/android-192.png',
        data: { url: payload.data?.url || './index.html?menu=1' }
      }).catch(() => {});
    });
    ctx.messaging.__superAgendaForegroundConfigurado = true;
  }

  async function salvarFid_(fid, preferencias) {
    const anterior = identificadorLocal_();
    await Auth.apiCall('registrarDispositivoNotificacao', Object.assign({
      token: fid,
      identificadorTipo: 'FID',
      plataforma: plataforma_(),
      navegador: navigator.userAgent.slice(0, 120),
      nomeDispositivo: nomeDispositivo_()
    }, preferencias || {}));
    // Só confirma localmente após o backend aceitar o FID. Isso impede a tela
    // de mostrar o aparelho como ativo quando a gravação remota falhou.
    localStorage.setItem(IDENTIFICADOR_KEY, fid);
    localStorage.setItem(TIPO_KEY, 'FID');
    localStorage.removeItem(TOKEN_LEGADO_KEY);
    localStorage.removeItem(DESATIVADO_KEY);
    if (anterior && anterior !== fid) {
      await Auth.apiCall('removerDispositivoNotificacao', { token: anterior }).catch(() => {});
    }
  }

  // Não solicita permissão. Reconcilia a instalação quando o iOS já autorizou.
  async function sincronizar(preferencias) {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return status();
    if (localStorage.getItem(DESATIVADO_KEY) === '1') return status();
    if (Notification.permission !== 'granted') return status();
    const cfg = await status();
    if (!cfg.disponivel) return cfg;
    const atual = await registrarFid_(cfg);
    configurarForeground_(atual);
    await salvarFid_(atual.fid, preferencias);
    return status();
  }

  async function ativar(preferencias) {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('NOTIFICACOES_NAO_SUPORTADAS');
    let permissao = Notification.permission;
    if (permissao === 'default') permissao = await Notification.requestPermission();
    if (permissao !== 'granted') throw new Error('PERMISSAO_NAO_CONCEDIDA');
    const cfg = await status();
    if (!cfg.disponivel) throw new Error('FCM_CONFIG_INCOMPLETA');
    const atual = await registrarFid_(cfg);
    configurarForeground_(atual);
    await salvarFid_(atual.fid, preferencias);
    return status();
  }

  async function desativar() {
    const identificador = identificadorLocal_();
    if (identificador) await Auth.apiCall('removerDispositivoNotificacao', { token: identificador });
    try {
      const cfg = await status();
      if (cfg.disponivel && Notification.permission === 'granted') {
        const ctx = await contextoFirebase_(cfg);
        await ctx.sdk.messagingSdk.unregister(ctx.messaging);
      }
    } catch (_) {}
    localStorage.removeItem(IDENTIFICADOR_KEY);
    localStorage.removeItem(TIPO_KEY);
    localStorage.removeItem(TOKEN_LEGADO_KEY);
    localStorage.setItem(DESATIVADO_KEY, '1');
    contextoPromise_ = null;
    // A remoção já foi concluída. Uma falha transitória na consulta de status
    // do iOS não deve transformar a desativação bem-sucedida em erro visual.
    try { return await status(); } catch (_) { return { ok: true, dispositivos: [] }; }
  }

  async function salvarPreferencias(preferencias) {
    const identificador = identificadorLocal_();
    if (!identificador) throw new Error('DISPOSITIVO_NAO_ATIVADO');
    await Auth.apiCall('atualizarPreferenciasNotificacao', Object.assign({ token: identificador }, preferencias || {}));
    return status();
  }

  window.NotificacoesFA = {
    status, sincronizar, ativar, desativar, salvarPreferencias,
    token: identificadorLocal_, tipo: tipoLocal_
  };
})();
