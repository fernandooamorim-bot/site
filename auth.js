(() => {
  // Evita sobrescrever se já existir
  if (window.Auth) return;

  /**
   * ======================================================
   * CONFIGURAÇÃO
   * ======================================================
   */
  const API_URL =
    'https://script.google.com/macros/s/AKfycbx-hCrZUTiTcRMffvq9mPCXsGkSCOhKyUODe16s5PoVaujTgAp2RzYf15q7VKKvV6jYLw/exec';

  const Auth = {};

  /**
   * ======================================================
   * AUTENTICAÇÃO SIMPLES (PADRÃO FUNCIONAL APPS SCRIPT)
   * ======================================================
   * ✔ POST
   * ✔ Sem Authorization
   * ✔ Sem application/json
   * ✔ Evita preflight (CORS)
   * ✔ Email como identificador
   */
  Auth.me = async function (email) {
    try {
      if (!email) {
        throw new Error('Email não informado');
      }

      const response = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'verificarUsuario',
          email: email
        })
      });

      if (!response.ok) {
        return { ok: false };
      }

      const data = await response.json();

      if (!data || data.authorized !== true) {
        return { ok: false };
      }

      // Persistência simples de sessão
      localStorage.setItem('auth_email', email);
      localStorage.setItem('auth_ok', '1');

      return {
        ok: true,
        email: email
      };

    } catch (err) {
      console.error('Auth.me erro:', err);
      return { ok: false };
    }
  };

  /**
   * ======================================================
   * VERIFICA SE JÁ EXISTE SESSÃO LOCAL
   * ======================================================
   */
  Auth.isLogged = function () {
    return localStorage.getItem('auth_ok') === '1';
  };

  /**
   * ======================================================
   * OBTÉM EMAIL DA SESSÃO
   * ======================================================
   */
  Auth.getEmail = function () {
    return localStorage.getItem('auth_email');
  };

  /**
   * ======================================================
   * LOGOUT
   * ======================================================
   */
  Auth.logout = function () {
    localStorage.removeItem('auth_ok');
    localStorage.removeItem('auth_email');
    location.reload();
  };

  // Expor globalmente
  window.Auth = Auth;
})();