/**
 * ======================================================
 * API AUTH — AUTENTICAÇÃO + ACL (VERSÃO DEFINITIVA)
 * ======================================================
 * ✔ Frontend externo (GitHub Pages / Netlify)
 * ✔ OAuth Google ocorre SOMENTE no frontend
 * ✔ Backend autentica por EMAIL recebido
 * ✔ Fonte da verdade: Aba USUARIOS
 * ✔ ACL aplicado DENTRO das funções de negócio
 * ======================================================
 */

/**
 * ======================================================
 * ENTRYPOINT ÚNICO
 * ======================================================
 */
function doPost(e) {
  try {
    // ======================================================
    // 1. NORMALIZA ENTRADA (JSON OU FORM)
    // ======================================================
    let params = {};

    const raw =
      e &&
      e.postData &&
      typeof e.postData.contents === 'string'
        ? e.postData.contents.trim()
        : '';

    if (raw && (raw.startsWith('{') || raw.startsWith('['))) {
      try {
        params = JSON.parse(raw);
      } catch (err) {
        params = {};
      }
    } else {
      params = e.parameter || {};
    }

    // ======================================================
    // WEBHOOK WOOVI — DETECÇÃO ANTES DE ACTION
    // ======================================================
    if (raw && raw.startsWith('{')) {
      try {
        const possibleWebhook = JSON.parse(raw);

        if (
          possibleWebhook &&
          possibleWebhook.event &&
          String(possibleWebhook.event).indexOf('OPENPIX') !== -1
        ) {
          return processarWebhookWoovi(e);
        }
      } catch (err) {
        // não é webhook, segue fluxo normal
      }
    }

    const action = params.action;
    const email  = params.email;

    // ======================================================
    // 2. VALIDAÇÃO MÍNIMA
    // ======================================================
    if (!action) {
      return json({ error: 'ACTION_REQUIRED' });
    }

    // ======================================================
    // 3. LOGIN
    // ======================================================
    if (action === 'verificarUsuario') {
      if (!email) {
        return json({ error: 'EMAIL_REQUIRED' });
      }
      return verificarUsuario(email);
    }

    // ======================================================
    // 4. CONTEXTO GLOBAL (APÓS LOGIN)
    // ======================================================
    if (email) {
      globalThis.REQUEST_EMAIL = email;
    }

    // ======================================================
    // 5. AGENDA
    // ======================================================
    if (action === 'listarEventos') {
      exigirAcao('eventos:listar');
      return json({
        ok: true,
        eventos: listarEventos(email)
      });
    }

    if (action === 'buscarEventosPorData') {
      exigirAcao('eventos:listar');
      return json(buscarEventosPorData(params.data));
    }

    // ======================================================
    // 6. CONFIGURAÇÕES
    // ======================================================
    if (action === 'carregarConfiguracoes') return json(carregarConfiguracoes());
    if (action === 'listarDuracoesPadrao') return json(listarDuracoesPadrao());
    if (action === 'listarProjetosSugeridos') return json(listarProjetosSugeridos());
    if (action === 'listarTiposEvento') return json(listarTiposEvento());
    if (action === 'obterConfig') return json(obterConfig(params.chave));
    if (action === 'obterPercentualNF') return json(obterPercentualNF());

    // ======================================================
    // 7. LISTAGENS AUXILIARES
    // ======================================================
    if (action === 'listarVendedores') return json(listarVendedores());
    if (action === 'listarContratantes') return json(listarContratantes());
    if (action === 'listarCerimonialistas') return json(listarCerimonialistas());
    if (action === 'listarEnderecos') return json(listarEnderecos());
    if (action === 'listarParceirosBV') return json(listarParceirosBV());

    // ======================================================
    // 8. CADASTROS RÁPIDOS
    // ======================================================
    if (action === 'cadastrarContratanteRapido') {
      exigirAcao('eventos:criar');
      return json(cadastrarContratanteRapido(params));
    }

    if (action === 'cadastrarCerimonialistaRapido') {
      exigirAcao('eventos:criar');
      return json(cadastrarCerimonialistaRapido(params));
    }

    if (action === 'cadastrarEnderecoRapido') {
      exigirAcao('eventos:criar');
      return json(cadastrarEnderecoRapido(params));
    }

    if (action === 'cadastrarParceiroBVRapido') {
      exigirAcao('eventos:criar');
      return json(cadastrarParceiroBVRapido(params));
    }

    // ======================================================
    // 9. CRIAÇÃO DE EVENTO
    // ======================================================
    if (action === 'criarEvento') {
      if (!email) return json({ error: 'EMAIL_REQUIRED' });
      globalThis.REQUEST_EMAIL = email;
      exigirAcao('eventos:criar');
      return json(criarEvento(params, email));
    }

    // ======================================================
    // 10. EDIÇÃO DE EVENTO — FRONTEND EXTERNO
    // ======================================================

    if (action === 'buscarEventoParaEdicao') {
      exigirAcao('eventos:editar');
      return json(buscarEventoParaEdicao(params.idEvento));
    }

    if (action === 'buscarEventoPorID') {
      exigirAcao('eventos:editar');
      return json(buscarEventoPorID(params.idEvento));
    }

    if (action === 'buscarEventoPorContratante') {
      exigirAcao('eventos:editar');
      return json(buscarEventoPorContratante(params.nome));
    }

    if (action === 'buscarEventoPorData') {
  exigirAcao('eventos:editar');
  return json(buscarEventoPorData(params.data));
}

    if (action === 'buscarEventoPorPeriodo') {
      exigirAcao('eventos:editar');
      return json(buscarEventoPorPeriodo(params.periodo));
    }

    if (action === 'verificarPermissaoEdicaoFinanceira') {
      exigirAcao('eventos:editar');
      return json(verificarPermissaoEdicaoFinanceira(params.idEvento));
    }

    if (action === 'validarAlteracoesEvento') {
      exigirAcao('eventos:editar');
      return json(validarAlteracoesEvento(params.idEvento, params));
    }

    if (action === 'salvarEdicaoEvento') {
      if (!email) return json({ error: 'EMAIL_REQUIRED' });
      globalThis.REQUEST_EMAIL = email;
      exigirAcao('eventos:editar');
      return json(salvarEdicaoEvento(params.idEvento, params));
    }

    // ======================================================
// 11. FINANCEIRO — CENTRAL FINANCEIRA
// ======================================================

if (action === 'buscarResumoFinanceiroEvento') {
  exigirAcao('eventos:listar');
  return json(buscarResumoFinanceiroEvento(params.idEvento));
}

if (action === 'listarRecebimentosPorEvento') {
  exigirAcao('eventos:listar');
  return json(listarRecebimentosPorEvento(params.idEvento));
}

if (action === 'apiRegistrarRecebimento') {
  exigirAcao('eventos:registrarRecebimento');
  return json(apiRegistrarRecebimento(params));
}

if (action === 'apiEstornarRecebimento') {
  exigirAcao('eventos:registrarRecebimento');
  return json(apiEstornarRecebimento(params));
}

if (action === 'apiRegistrarSaidaEvento') {
  exigirAcao('eventos:registrarSaida');
  return json(apiRegistrarSaidaEvento(params));
}

if (action === 'visualizarPreviewFechamento') {
  exigirAcao('comissao:fechar');
  return json(visualizarPreviewFechamento(params.idVendedor));
}

if (action === 'fecharComissaoVendedor') {
  exigirAcao('comissao:fechar');

  return json(
    fecharComissaoVendedor(
      params.idVendedor,
      null,
      null,
      params.ajusteCredito || 0,
      params.ajusteDebito || 0,
      params.linkComprovante || ''
    )
  );
}

if (action === 'listarEventosFinanceiros') {
  exigirAcao('eventos:visualizarFinanceiro');
  return json(listarEventosFinanceiros());
}

    // ======================================================
    // FALLBACK
    // ======================================================
    return json({ error: 'AÇÃO_INVALIDA', action });

  } catch (err) {
  const msg = String(err.message || err);

  let codigo = 'ERRO_INTERNO';
  let mensagem = 'Ocorreu um erro inesperado.';

  if (msg.startsWith('FORBIDDEN_ACTION')) {
    codigo = 'SEM_PERMISSAO';
    mensagem = 'Você não tem permissão para executar esta ação.';
  }

  if (msg === 'USER_NOT_FOUND') {
    codigo = 'USUARIO_NAO_ENCONTRADO';
    mensagem = 'Usuário não encontrado.';
  }

  if (msg === 'USER_INACTIVE') {
    codigo = 'USUARIO_INATIVO';
    mensagem = 'Usuário inativo no sistema.';
  }

  if (msg === 'EMAIL_NOT_IN_REQUEST') {
    codigo = 'SESSAO_INVALIDA';
    mensagem = 'Sessão inválida. Faça login novamente.';
  }

  return json({
    sucesso: false,
    codigo,
    mensagem
  });
}
}

/**
 * ======================================================
 * LOGIN / IDENTIDADE
 * ======================================================
 */
function verificarUsuario(email) {
  if (!email) {
    return json({ ok: false, error: 'EMAIL_NOT_PROVIDED' });
  }

  const user = requireUserByEmail(email);

  return json({
    ok: true,
    user: {
      email: user.EMAIL,
      nome: user.NOME,
      perfil: user.PERFIL
    }
  });
}

/**
 * ======================================================
 * FONTE DA VERDADE — USUARIOS
 * ======================================================
 */
function requireUserByEmail(email) {
  const usuario = buscarUsuarioPorEmail(email);

  if (!usuario) {
    throw new Error('USER_NOT_FOUND');
  }

  if (String(usuario.STATUS).toLowerCase() !== 'ativo') {
    throw new Error('USER_INACTIVE');
  }

  return usuario;
}

/**
 * ======================================================
 * ACL — CONTROLE DE ACESSO
 * ======================================================
 */
const ACL = {
  'Proprietário': ['*'],

  'Sócio': [
    'eventos:criar',
    'eventos:editar',
    'eventos:listar',
    'eventos:registrarRecebimento',
    'eventos:registrarSaida',
    'comissao:fechar',
    'eventos:visualizarFinanceiro'
  ],

  'Músico': [
    'eventos:listar'
  ]
};

function requirePermission(user, action) {
  if (!user || !user.PERFIL) {
    throw new Error('INVALID_USER');
  }

  const rules = ACL[user.PERFIL];
  if (!rules) {
    throw new Error('NO_ACL_FOR_PROFILE');
  }

  if (rules.includes('*')) return true;

  if (!rules.includes(action)) {
    throw new Error('FORBIDDEN_ACTION: ' + action);
  }

  return true;
}

/**
 * ======================================================
 * CONTEXTO GLOBAL DE USUÁRIO
 * ======================================================
 */
function getUsuarioAtual() {
  if (!globalThis.REQUEST_EMAIL) {
    throw new Error('EMAIL_NOT_IN_REQUEST');
  }
  return requireUserByEmail(globalThis.REQUEST_EMAIL);
}

function exigirAcao(acao) {
  const usuario = getUsuarioAtual();
  requirePermission(usuario, acao);
  return usuario;
}

/**
 * ======================================================
 * BUSCA NA ABA USUARIOS
 * ======================================================
 */
function buscarUsuarioPorEmail(email) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('USUARIOS');
  if (!sheet) throw new Error('ABA_USUARIOS_NAO_ENCONTRADA');

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;

  const headers = data[0].map(h =>
    String(h)
      .toUpperCase()
      .replace(/\s+/g, '_')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  );

  const iEmail  = headers.indexOf('EMAIL');
  const iNome   = headers.indexOf('NOME');
  const iPerfil = headers.indexOf('PERFIL');
  const iStatus = headers.indexOf('STATUS');

  if (iEmail === -1 || iPerfil === -1 || iStatus === -1) {
    throw new Error('COLUNAS_USUARIOS_INVALIDAS');
  }

  const emailBusca = String(email).toLowerCase().trim();

  for (let i = 1; i < data.length; i++) {
    const emailLinha = String(data[i][iEmail]).toLowerCase().trim();
    if (emailLinha === emailBusca) {
      return {
        EMAIL: data[i][iEmail],
        NOME: data[i][iNome],
        PERFIL: data[i][iPerfil],
        STATUS: data[i][iStatus]
      };
    }
  }

  return null;
}

/**
 * ======================================================
 * JSON RESPONSE
 * ======================================================
 */
function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}