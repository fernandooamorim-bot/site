(() => {
  if (window.Auth) return;

  // ======================================================
  // CONFIGURAÇÕES
  // ======================================================

  const API_URL = 'https://script.google.com/macros/s/AKfycbx-hCrZUTiTcRMffvq9mPCXsGkSCOhKyUODe16s5PoVaujTgAp2RzYf15q7VKKvV6jYLw/exec';
  const CLIENT_ID = '179346910046-ph0lma4i52sc9prtlkfdd63d82m350qj.apps.googleusercontent.com';

  const Auth = {};

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

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'verificarUsuario',
          email: email
        })
      });

      const data = await res.json();

      if (!data.ok || !data.user) {
        alert('Acesso não autorizado');
        return;
      }

      const user = {
        email: data.user.email,
        nome: data.user.nome,
        perfil: data.user.perfil
      };

      localStorage.setItem('auth_email', user.email);
      localStorage.setItem('auth_nome', user.nome);
      localStorage.setItem('auth_perfil', user.perfil);

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
  // LOGOUT
  // ======================================================

  Auth.logout = function () {
    localStorage.clear();
    location.reload();
  };

  window.Auth = Auth;
})();