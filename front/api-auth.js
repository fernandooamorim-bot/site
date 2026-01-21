/**
 * =====================================================
 * auth.js
 * Autenticação central do sistema (Frontend Externo)
 * =====================================================
 *
 * ✔ Usa Apps Script como backend (Web App)
 * ✔ Autenticação por sessão Google
 * ✔ Controle de acesso por perfil
 * ✔ Arquivo ÚNICO (não duplicar em páginas)
 * ✔ Pronto para produção
 *
 * DEPENDÊNCIAS:
 *  - api.js (fetch padronizado)
 *  - state.js (estado global do usuário)
 *
 * NENHUMA dependência de index.html
 */

/**
 * URL BASE DO BACKEND (Web App publicado)
 * ⚠️ Trocar apenas aqui se mudar versão
 */
const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbx-hCrZUTiTcRMffvq9mPCXsGkSCOhKyUODe16s5PoVaujTgAp2RzYf15q7VKKvV6jYLw/exec';

/**
 * Estado interno de autenticação
 */
const Auth = {
  usuario: null,
  carregado: false
};

/**
 * =====================================================
 * Função principal de autenticação
 * =====================================================
 * - Deve ser chamada no carregamento do site
 * - Bloqueia o sistema até validar usuário
 */
async function autenticarUsuario() {
  try {
    const response = await fetch(`${BACKEND_URL}?action=auth.me`, {
      method: 'GET',
      credentials: 'include' // CRÍTICO para sessão Google
    });

    if (!response.ok) {
      throw new Error('Falha na comunicação com o servidor');
    }

    const data = await response.json();

    // Usuário não logado no Google
    if (!data.logado) {
      bloquearSistema('Usuário não autenticado no Google');
      return;
    }

    // Usuário sem permissão no sistema
    if (!data.autorizado) {
      bloquearSistema('Acesso não autorizado para este e-mail');
      return;
    }

    // Usuário inativo
    if (data.status !== 'Ativo') {
      bloquearSistema('Usuário inativo no sistema');
      return;
    }

    // Autenticação OK
    Auth.usuario = data;
    Auth.carregado = true;

    // Salva no estado global (opcional, se existir)
    if (window.AppState) {
      window.AppState.usuario = data;
    }

    // Dispara evento global
    document.dispatchEvent(
      new CustomEvent('auth:ready', { detail: data })
    );

    console.log('✅ Usuário autenticado:', data.email);

  } catch (error) {
    console.error('Erro na autenticação:', error);
    bloquearSistema('Erro ao validar autenticação');
  }
}

/**
 * =====================================================
 * Bloqueia completamente o sistema
 * =====================================================
 */
function bloquearSistema(mensagem) {
  document.body.innerHTML = `
    <div style="
      min-height:100vh;
      display:flex;
      align-items:center;
      justify-content:center;
      background:#0f172a;
      color:#fff;
      font-family:system-ui;
      padding:40px;
    ">
      <div style="
        max-width:420px;
        background:#111827;
        border-radius:16px;
        padding:30px;
        text-align:center;
        box-shadow:0 20px 40px rgba(0,0,0,.4);
      ">
        <h2 style="margin-bottom:12px;">🔒 Acesso bloqueado</h2>
        <p style="opacity:.85; font-size:14px;">
          ${mensagem}
        </p>
        <p style="margin-top:20px; font-size:12px; opacity:.6;">
          Verifique se você está logado com o e-mail correto
        </p>
      </div>
    </div>
  `;
}

/**
 * =====================================================
 * Helpers de permissão
 * =====================================================
 */

/**
 * Retorna true se usuário tiver um dos perfis
 */
function usuarioTemPerfil(...perfis) {
  if (!Auth.usuario) return false;
  return perfis.includes(Auth.usuario.perfil);
}

/**
 * Exemplo:
 * usuarioTemPerfil('Proprietário', 'Sócio')
 */

/**
 * =====================================================
 * Proteção de páginas
 * =====================================================
 * Uso:
 * protegerPagina(['Proprietário', 'Sócio'])
 */
function protegerPagina(perfisPermitidos) {
  if (!Auth.carregado) {
    document.addEventListener('auth:ready', () => {
      protegerPagina(perfisPermitidos);
    });
    return;
  }

  if (!usuarioTemPerfil(...perfisPermitidos)) {
    bloquearSistema('Você não tem permissão para acessar esta página');
  }
}

/**
 * =====================================================
 * Inicialização automática
 * =====================================================
 * Pode ser usada em qualquer página:
 *
 * <script src="auth.js"></script>
 */
document.addEventListener('DOMContentLoaded', () => {
  autenticarUsuario();
});