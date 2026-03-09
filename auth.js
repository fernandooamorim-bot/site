(() => {
  if (window.Auth) return;

  // ======================================================
  // CONFIGURAÇÕES
  // ======================================================

  const API_URL = 'https://script.google.com/macros/s/AKfycbx-hCrZUTiTcRMffvq9mPCXsGkSCOhKyUODe16s5PoVaujTgAp2RzYf15q7VKKvV6jYLw/exec';
  const CLIENT_ID = '179346910046-ph0lma4i52sc9prtlkfdd63d82m350qj.apps.googleusercontent.com';

  const Auth = {};

  Auth.clearAuthStorage = function () {
    localStorage.removeItem('auth_email');
    localStorage.removeItem('auth_nome');
    localStorage.removeItem('auth_perfil');
    localStorage.removeItem('auth_session');
  };

  Auth.forceLogout = function (mensagem) {
    try {
      Auth.clearAuthStorage();
    } catch (_) {}

    if (mensagem) {
      try { alert(mensagem); } catch (_) {}
    }

    try {
      window.location.href = 'index.html';
    } catch (_) {
      location.reload();
    }
  };

  // ======================================================
  // INICIALIZA GOOGLE OAUTH
  // ======================================================

  Auth.initGoogle = function () {
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
      console.error('Google Identity Services não carregado');
      return;
    }

    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: Auth.handleCredential
    });

    google.accounts.id.renderButton(
      document.getElementById('google-btn'),
      {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill'
      }
    );
  };

  // ======================================================
  // CALLBACK DO GOOGLE
  // ======================================================

  Auth.handleCredential = async function (response) {
    try {
      if (!response || !response.credential) {
        throw new Error('Credencial inválida do Google');
      }

      const payload = JSON.parse(atob(response.credential.split('.')[1]));
      const email = payload.email;

      if (!email) {
        throw new Error('E-mail não encontrado no token');
      }

      const params = new URLSearchParams();
      params.append('action', 'verificarUsuario');
      params.append('idToken', response.credential);

      const res = await fetch(API_URL, {
        method: 'POST',
        body: params
      });

      const data = await res.json();

      if (!data.ok || !data.user) {
        alert('Acesso não autorizado');
        return;
      }

      if (!data.sessionToken) {
        throw new Error('Sessão não retornada pelo backend');
      }

      const user = {
        email: data.user.email,
        nome: data.user.nome,
        perfil: data.user.perfil
      };

      localStorage.setItem('auth_email', user.email);
      localStorage.setItem('auth_nome', user.nome);
      localStorage.setItem('auth_perfil', user.perfil);
      localStorage.setItem('auth_session', data.sessionToken);

      if (typeof onLoginSuccess === 'function') {
        onLoginSuccess(user);
      }

      if (typeof aplicarPermissoes === 'function') {
        aplicarPermissoes(user);
      }

    } catch (err) {
      console.error('Erro de autenticação:', err);
      alert('Erro ao autenticar. Verifique o console.');
    }
  };

  // ======================================================
  // API CALL PADRÃO (FRONTEND → APPS SCRIPT)
  // ======================================================

  Auth.apiCall = async function (action, payload = {}) {
    try {
      const sessionToken = localStorage.getItem('auth_session');

      if (!sessionToken) {
        throw new Error('Usuário não autenticado');
      }

      // Monta parâmetros como FORM (evita preflight CORS)
      const params = new URLSearchParams();
      params.append('action', action);
      params.append('sessionToken', sessionToken);

      Object.keys(payload).forEach(key => {
        if (payload[key] !== undefined && payload[key] !== null) {
          params.append(key, payload[key]);
        }
      });

      const res = await fetch(API_URL, {
        method: 'POST',
        body: params
      });

      if (!res.ok) {
        throw new Error('Erro de rede ao acessar API');
      }

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      if (
        data &&
        data.sucesso === false &&
        (
          data.codigo === 'SESSAO_INVALIDA' ||
          data.codigo === 'SESSAO_EXPIRADA' ||
          data.codigo === 'USUARIO_NAO_ENCONTRADO' ||
          data.codigo === 'USUARIO_INATIVO'
        )
      ) {
        Auth.forceLogout('Sua sessão foi encerrada. Faça login novamente.');
        const authErr = new Error(data.mensagem || 'Sessão inválida');
        authErr.name = 'AuthSessionError';
        authErr.code = data.codigo || 'SESSAO_INVALIDA';
        throw authErr;
      }

      return data;

    } catch (err) {
      console.error('[Auth.apiCall]', err);
      throw err;
    }
  };
  // ======================================================
  // LOGOUT
  // ======================================================

  Auth.logout = function () {
    Auth.clearAuthStorage();
    location.reload();
  };

  window.Auth = Auth;
})();
