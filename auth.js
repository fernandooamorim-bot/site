
(() => {
  if (window.Auth) return;

  const API_URL =
    'https://script.google.com/macros/s/AKfycbx-hCrZUTiTcRMffvq9mPCXsGkSCOhKyUODe16s5PoVaujTgAp2RzYf15q7VKKvV6jYLw/exec';

  const Auth = {};

  /**
   * Autenticação simples (PADRÃO LEGADO FUNCIONAL COM APPS SCRIPT)
   * - POST
   * - Content-Type text/plain (evita preflight / CORS)
   * - Email como identificador
   */
  Auth.me = async function (email) {
    try {
      if (!email) {
        throw new Error('Email não informado');
      }

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify({
          action: 'verificarUsuario',
          email: email
        })
      });

      if (!res.ok) {
        return { ok: false };
      }

      const data = await res.json();

      if (!data || data.authorized !== true) {
        return { ok: false };
      }

      return {
        ok: true,
        authorized: true
      };

    } catch (err) {
      console.error('Auth.me erro:', err);
      return { ok: false };
    }
  };

  /**
   * Logout simples
   */
  Auth.logout = function () {
    localStorage.clear();
    sessionStorage.clear();
    location.reload();
  };

  window.Auth = Auth;
})();