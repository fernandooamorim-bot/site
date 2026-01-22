/**
 * =====================================================
 * auth.js — FRONTEND (Email-based Auth)
 * =====================================================
 * - Envia email para o Apps Script
 * - Verifica usuário via backend
 */

(() => {
  if (window.Auth) return;

  const API_URL = 'https://script.google.com/macros/s/AKfycbx-hCrZUTiTcRMffvq9mPCXsGkSCOhKyUODe16s5PoVaujTgAp2RzYf15q7VKKvV6jYLw/exec';

  const Auth = {
  };

  /**
   * Chamada auth.me via POST com email
   */
  Auth.me = async function (email) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'auth.me', email })
      });

      if (!res.ok) {
        return { ok: false };
      }

      const data = await res.json();
      return data;

    } catch (err) {
      console.error('Auth.me erro:', err);
      return { ok: false };
    }
  };

  /**
   * Logout (simples reload)
   */
  Auth.logout = function () {
    location.reload();
  };

  window.Auth = Auth;
})();