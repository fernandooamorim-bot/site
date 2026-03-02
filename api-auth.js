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
  let action = '';
  let email = '';
  let params = {};
  const requestId = 'REQ-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  const startedAt = Date.now();
  try {
    // ======================================================
    // 1. NORMALIZA ENTRADA (JSON OU FORM)
    // ======================================================
    params = {};

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
// WEBHOOK ASAAS
// ======================================================

if (raw && raw.startsWith('{')) {
  try {
    const possibleWebhook = JSON.parse(raw);

    if (
      possibleWebhook &&
      possibleWebhook.event &&
      possibleWebhook.payment &&
      String(possibleWebhook.event).startsWith('PAYMENT_')
    ) {
      return processarWebhookAsaas(e);
    }

  } catch (err) {}
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

    action = params.action;
    email  = params.email;

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
  return json(
    executarComIdempotenciaFinanceira_(
      { action: action, email: email, params: params },
      function () {
        return apiRegistrarRecebimento(params);
      }
    )
  );
}

if (action === 'apiEstornarRecebimento') {
  exigirAcao('eventos:estornarRecebimento');
  return json(
    executarComIdempotenciaFinanceira_(
      { action: action, email: email, params: params },
      function () {
        return apiEstornarRecebimento(params);
      }
    )
  );
}

if (action === 'apiRegistrarSaidaEvento') {
  exigirAcao('eventos:registrarSaida');
  return json(
    executarComIdempotenciaFinanceira_(
      { action: action, email: email, params: params },
      function () {
        return apiRegistrarSaidaEvento(params);
      }
    )
  );
}

if (action === 'apiUploadComprovante') {
  // Upload de comprovante é usado nas operações financeiras da Central.
  exigirAcao('eventos:registrarRecebimento');
  return json(apiUploadComprovante(params));
}

if (action === 'visualizarPreviewFechamento') {
  exigirAcao('comissao:fechar');
  return json(visualizarPreviewFechamento(params.idVendedor));
}

if (action === 'fecharComissaoVendedor') {
  exigirAcao('comissao:fechar');
  const ajusteCredito = Number(params.ajusteCredito);
  const ajusteDebito = Number(params.ajusteDebito);

  return json(
    executarComIdempotenciaFinanceira_(
      { action: action, email: email, params: params },
      function () {
        return fecharComissaoVendedor(
          params.idVendedor,
          null,
          null,
          isNaN(ajusteCredito) ? 0 : ajusteCredito,
          isNaN(ajusteDebito) ? 0 : ajusteDebito,
          params.linkComprovante || ''
        );
      }
    )
  );
}

if (action === 'listarEventosFinanceiros') {
  exigirAcao('eventos:visualizarFinanceiro');
  return json(listarEventosFinanceiros());
}

if (action === 'diagnosticarIntegridadeFinanceira') {
  exigirAcao('eventos:visualizarFinanceiro');
  return json(diagnosticarIntegridadeFinanceira(params));
}

    // ======================================================
    // FALLBACK
    // ======================================================
    return json({ error: 'AÇÃO_INVALIDA', action });

  } catch (err) {
  const msg = String(err.message || err);
  const stack = err && err.stack ? String(err.stack) : '';

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

  // Observabilidade determinística para rastrear falhas de produção
  Logger.log(
    '[API_AUTH_ERRO] requestId=' + requestId +
    ' action=' + String(action || '') +
    ' email=' + String(email || '') +
    ' codigo=' + codigo +
    ' msg=' + msg +
    (stack ? ' stack=' + stack : '')
  );

  // Log persistente e enxuto (apenas erro) na planilha para troubleshooting.
  try {
    registrarErroApiDoPost_({
      requestId: requestId,
      action: action,
      email: email,
      codigo: codigo,
      mensagem: msg,
      stack: stack,
      duracaoMs: Date.now() - startedAt
    });
  } catch (logErr) {
    Logger.log('[API_AUTH_ERRO_LOG_FALHA] requestId=' + requestId + ' erro=' + String(logErr));
  }

  // Para comissão, devolve a mensagem técnica para diagnóstico rápido no frontend.
  if (action === 'fecharComissaoVendedor' || action === 'visualizarPreviewFechamento') {
    mensagem = msg || mensagem;
  }

  return json({
    sucesso: false,
    codigo,
    mensagem,
    requestId
  });
}
}

/**
 * Log persistente de erros da API (erro-only) com retenção automática leve.
 * Usa somente a aba LOGS para centralizar auditoria.
 */
function registrarErroApiDoPost_(ctx) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('LOGS');

  if (!sh) {
    sh = ss.insertSheet('LOGS');
    sh.getRange(1, 1, 1, 7).setValues([[
      'ID_LOG',
      'DATA_HORA',
      'USUARIO',
      'ACAO',
      'TABELA',
      'ID_REGISTRO',
      'DETALHES'
    ]]);
  }

  const idLog = 'ERR-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const userKey = mascararUsuarioLog_(ctx.email);
  const acao = String(ctx.action || 'doPost');
  const detalhes = JSON.stringify({
    tipo: 'API_ERRO',
    codigo: String(ctx.codigo || ''),
    mensagem: String(ctx.mensagem || ''),
    requestId: String(ctx.requestId || ''),
    duracaoMs: Number(ctx.duracaoMs || 0),
    stackTop: String(ctx.stack || '').split('\n').slice(0, 3).join(' | ')
  });

  sh.appendRow([
    idLog,
    new Date(),
    userKey,
    acao,
    'API_AUTH',
    String(ctx.requestId || ''),
    detalhes
  ]);

  // Retenção ocasional para evitar crescimento infinito (erro-only + limpeza probabilística).
  if (Math.random() < 0.05) {
    limparLogsAntigos_(sh, 45);
  }
}

function mascararUsuarioLog_(email) {
  const raw = String(email || '').trim().toLowerCase();
  if (!raw) return 'ANON';

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    raw
  );
  const hex = digest
    .map(b => ((b + 256) % 256).toString(16).padStart(2, '0'))
    .join('');
  return 'USR#' + hex.slice(0, 12);
}

function limparLogsAntigos_(sheet, dias) {
  const limite = new Date(Date.now() - (Number(dias || 45) * 24 * 60 * 60 * 1000));
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  // DATA_HORA é a coluna 2 na estrutura padrão da aba LOG/LOGS
  for (let i = data.length - 1; i >= 1; i--) {
    const dt = data[i][1];
    const d = dt instanceof Date ? dt : new Date(dt);
    if (!isNaN(d.getTime()) && d < limite) {
      sheet.deleteRow(i + 1);
    }
  }
}

function executarComIdempotenciaFinanceira_(ctx, executor) {
  const action = String((ctx && ctx.action) || '').trim();
  const email = String((ctx && ctx.email) || '').trim().toLowerCase();
  const params = (ctx && ctx.params) || {};
  const operationKey = String(params.operationKey || '').trim();

  // Backward compatible: se o frontend antigo não enviar operationKey, mantém fluxo atual.
  if (!acaoPermiteIdempotencia_(action) || !operationKey) {
    return executor();
  }

  const cache = CacheService.getScriptCache();
  const key = montarChaveIdempotencia_(action, email, operationKey);
  const fingerprint = gerarFingerprintIdempotencia_(params);
  const ttlSeconds = 6 * 60 * 60; // 6h

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw new Error('Sistema ocupado. Tente novamente em alguns segundos.');
  }

  try {
    const estadoExistente = lerEstadoIdempotencia_(cache, key);
    if (estadoExistente) {
      if (estadoExistente.fingerprint !== fingerprint) {
        throw new Error('Esta chave de operação foi reutilizada com dados diferentes.');
      }

      if (estadoExistente.status === 'DONE') {
        return estadoExistente.response || { sucesso: true };
      }

      if (estadoExistente.status === 'IN_PROGRESS') {
        throw new Error('Operação em processamento. Aguarde a conclusão antes de tentar novamente.');
      }
    }

    cache.put(
      key,
      JSON.stringify({
        status: 'IN_PROGRESS',
        fingerprint: fingerprint,
        ts: Date.now()
      }),
      ttlSeconds
    );
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }

  try {
    const response = executor();
    if (response && response.sucesso === false) {
      cache.remove(key);
      return response;
    }

    const doneLock = LockService.getScriptLock();
    if (doneLock.tryLock(5000)) {
      try {
        cache.put(
          key,
          JSON.stringify({
            status: 'DONE',
            fingerprint: fingerprint,
            ts: Date.now(),
            response: response
          }),
          ttlSeconds
        );
      } finally {
        try { doneLock.releaseLock(); } catch (_) {}
      }
    }
    return response;
  } catch (err) {
    // Em erro, remove marcador para permitir retry legítimo com a mesma operationKey.
    try {
      const clearLock = LockService.getScriptLock();
      if (clearLock.tryLock(3000)) {
        try {
          cache.remove(key);
        } finally {
          try { clearLock.releaseLock(); } catch (_) {}
        }
      }
    } catch (_) {}
    throw err;
  }
}

function acaoPermiteIdempotencia_(action) {
  const acao = String(action || '').trim();
  return (
    acao === 'apiRegistrarRecebimento' ||
    acao === 'apiRegistrarSaidaEvento' ||
    acao === 'apiEstornarRecebimento' ||
    acao === 'fecharComissaoVendedor'
  );
}

function montarChaveIdempotencia_(action, email, operationKey) {
  const material =
    String(action || '') + '|' +
    String(email || '') + '|' +
    String(operationKey || '');

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    material
  );
  const hash = digest
    .map(function (b) {
      return ((b + 256) % 256).toString(16).padStart(2, '0');
    })
    .join('')
    .slice(0, 40);

  return 'IDEMP:' + hash;
}

function lerEstadoIdempotencia_(cache, key) {
  const raw = cache.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function gerarFingerprintIdempotencia_(params) {
  const normalizado = normalizarParaFingerprint_(params || {});
  return JSON.stringify(normalizado);
}

function normalizarParaFingerprint_(valor) {
  if (valor === null || typeof valor === 'undefined') return null;

  if (Array.isArray(valor)) {
    return valor.map(function (item) {
      return normalizarParaFingerprint_(item);
    });
  }

  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return valor.toISOString();
  }

  if (typeof valor === 'object') {
    const out = {};
    Object.keys(valor)
      .filter(function (k) {
        return k !== 'operationKey' && k !== 'action' && k !== 'email';
      })
      .sort()
      .forEach(function (k) {
        out[k] = normalizarParaFingerprint_(valor[k]);
      });
    return out;
  }

  if (typeof valor === 'number') {
    if (isNaN(valor)) return 'NaN';
    return Number(valor.toFixed(6));
  }

  return String(valor);
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
    'eventos:estornarRecebimento',
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
