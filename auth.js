/**
 * =====================================================
 * auth.js — FRONTEND (OAuth Google)
 * =====================================================
 * - Gera ID Token via Google Identity Services
 * - Envia token para o Apps Script
 * - Mantém login persistente
 */

(() => {
  if (window.Auth) return;

  const API_URL = 'https://script.google.com/macros/s/AKfycbx-hCrZUTiTcRMffvq9mPCXsGkSCOhKyUODe16s5PoVaujTgAp2RzYf15q7VKKvV6jYLw/exec';

  const CLIENT_ID = '179346910046-ph0lma4i52sc9prtlkfdd63d82m350qj.apps.googleusercontent.com';

  const Auth = {
    token: null
  };

  /**
   * Inicializa Google OAuth
   */
  Auth.init = function () {
    return new Promise((resolve) => {
      if (!window.google || !google.accounts || !google.accounts.id) {
        resolve(null);
        return;
      }

      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (response) => {
          Auth.token = response.credential;
          localStorage.setItem('auth_token', Auth.token);
          resolve(Auth.token);
        }
      });

      google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          console.warn('Login automático não exibido');
        }
      });
    });
  };

  /**
   * Garante token válido
   */
  Auth.getToken = async function () {
    if (Auth.token) return Auth.token;

    const saved = localStorage.getItem('auth_token');
    if (saved) {
      Auth.token = saved;
      return saved;
    }

    return Auth.init();
  };

  /**
   * Chamada auth.me protegida
   */
  Auth.me = async function () {
  try {
    const token = await Auth.getToken();

    if (!token) {
      return { ok: false };
    }

    const url = `${API_URL}?action=auth.me&token=${encodeURIComponent(token)}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    const text = await res.text();

    if (!res.ok || text.trim().startsWith('<')) {
      return { ok: false };
    }

    return JSON.parse(text);

  } catch (err) {
    console.error('Auth.me erro:', err);
    return { ok: false };
  }
};

  Auth.renderButton = function (elementId) {
    if (!window.google || !google.accounts || !google.accounts.id) return;
    const el = document.getElementById(elementId);
    if (!el) return;
    google.accounts.id.renderButton(el, {
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'pill'
    });
  };

  /**
   * Logout
   */
  Auth.logout = function () {
    localStorage.removeItem('auth_token');
    Auth.token = null;
    location.reload();
  };

  window.Auth = Auth;
})();