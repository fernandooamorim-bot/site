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
const AUTH_CONFIG = {
  GOOGLE_CLIENT_ID: '179346910046-ph0lma4i52sc9prtlkfdd63d82m350qj.apps.googleusercontent.com',
  SESSION_TTL_DIAS_PADRAO: 30
};

function doPost(e) {
  let action = '';
  let email = '';
  let emailAutenticado = '';
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
      return verificarUsuario(params);
    }

    // ======================================================
    // 4. CONTEXTO GLOBAL (APÓS LOGIN)
    // ======================================================
    emailAutenticado = autenticarRequisicaoComSessao_(params);
    globalThis.REQUEST_EMAIL = emailAutenticado;

    // ======================================================
    // 5. AGENDA
    // ======================================================
    if (action === 'listarEventos') {
      exigirAcao('eventos:listar');
      return json({
        ok: true,
        eventos: listarEventosPorUsuario(emailAutenticado)
      });
    }

    if (action === 'listarEventosBootstrap') {
      exigirAcao('eventos:listar');
      return json(
        Object.assign({ ok: true }, listarEventosBootstrap(emailAutenticado))
      );
    }

    if (action === 'buscarEventosPorData') {
      exigirAcao('eventos:listar');
      return json(buscarEventosPorData(params.data));
    }

    if (action === 'obterAgendaSyncInfo') {
      exigirAcao('eventos:listar');
      return json(obterAgendaSyncInfo(emailAutenticado));
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
      exigirAcao('eventos:criar');
      return json(criarEvento(params, emailAutenticado));
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
      exigirAcao('eventos:editar');
      return json(salvarEdicaoEvento(params.idEvento, params));
    }

    // ======================================================
// 11. FINANCEIRO — CENTRAL FINANCEIRA
// ======================================================

if (action === 'buscarResumoFinanceiroEvento') {
  exigirAcao('eventos:visualizarFinanceiro');
  return json(buscarResumoFinanceiroEvento(params.idEvento));
}

if (action === 'listarRecebimentosPorEvento') {
  exigirAcao('eventos:visualizarFinanceiro');
  return json(listarRecebimentosPorEvento(params.idEvento));
}

if (action === 'apiRegistrarRecebimento') {
  exigirAcao('eventos:registrarRecebimento');
  return json(
    executarComIdempotenciaFinanceira_(
      { action: action, email: emailAutenticado, params: params },
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
      { action: action, email: emailAutenticado, params: params },
      function () {
        return apiEstornarRecebimento(params);
      }
    )
  );
}

if (action === 'apiRegistrarSaidaEvento') {
  const tipoSaida = String(params.tipoSaida || '').trim();
  if (tipoSaida === 'BV_EVENTO') {
    exigirAcao('eventos:registrarSaidaBV');
  } else {
    exigirAcao('eventos:registrarSaida');
  }
  return json(
    executarComIdempotenciaFinanceira_(
      { action: action, email: emailAutenticado, params: params },
      function () {
        return apiRegistrarSaidaEvento(params);
      }
    )
  );
}

if (action === 'apiUploadComprovante') {
  // Upload de comprovante é usado nas operações financeiras da Central.
  const categoriaComprovante = String(params.categoria || '').toUpperCase().trim();
  if (categoriaComprovante === 'SAIDA_EVENTO') {
    try {
      exigirAcao('eventos:registrarSaidaBV');
    } catch (err) {
      exigirAcao('eventos:registrarSaida');
    }
  } else if (categoriaComprovante === 'FECHAMENTO_COMISSAO') {
    exigirAcao('comissao:fechar');
  } else {
    exigirAcao('eventos:registrarRecebimento');
  }
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
  let ajustesDetalhados = [];
  try {
    const rawAjustes = String(params.ajustesDetalhadosJson || '').trim();
    ajustesDetalhados = rawAjustes ? JSON.parse(rawAjustes) : [];
  } catch (_) {
    ajustesDetalhados = [];
  }

  return json(
    executarComIdempotenciaFinanceira_(
      { action: action, email: emailAutenticado, params: params },
      function () {
        return fecharComissaoVendedor(
          params.idVendedor,
          null,
          null,
          isNaN(ajusteCredito) ? 0 : ajusteCredito,
          isNaN(ajusteDebito) ? 0 : ajusteDebito,
          params.linkComprovante || '',
          ajustesDetalhados
        );
      }
    )
  );
}

if (action === 'regerarPdfFechamentoComissao') {
  exigirAcao('comissao:fechar');
  return json(regerarPdfFechamentoComissao(params.idFechamento));
}

if (action === 'listarEventosFinanceiros') {
  exigirAcao('eventos:visualizarFinanceiro');
  return json(listarEventosFinanceiros());
}

if (action === 'obterDashboardGestao') {
  exigirAcao('eventos:visualizarFinanceiro');
  return json(obterDashboardGestao(params));
}

if (action === 'diagnosticarIntegridadeFinanceira') {
  exigirAcao('eventos:visualizarFinanceiro');
  return json(diagnosticarIntegridadeFinanceira(params));
}

if (action === 'reconciliarResumoFinanceiroEvento') {
  exigirAcao('eventos:editar');
  return json(reconciliarResumoFinanceiroEvento(params.idEvento));
}

if (action === 'migrarSaldoInicialFinanceiro') {
  const usuario = exigirAcao('financeiro:migrarSaldoInicial');
  if (String(usuario.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: financeiro:migrarSaldoInicial');
  }
  return json(migrarSaldoInicialFinanceiro(params));
}

if (action === 'auditarSaldoInicialFinanceiro') {
  const usuario = exigirAcao('financeiro:migrarSaldoInicial');
  if (String(usuario.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: financeiro:migrarSaldoInicial');
  }
  return json(auditarSaldoInicialFinanceiro(params));
}

if (action === 'reconciliarMovimentacoesSaldoInicialPosAuditoria') {
  const usuario = exigirAcao('financeiro:migrarSaldoInicial');
  if (String(usuario.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: financeiro:migrarSaldoInicial');
  }
  return json(reconciliarMovimentacoesSaldoInicialPosAuditoria(params));
}

if (action === 'auditarSaidasLegado2025') {
  const usuario = exigirAcao('financeiro:migrarSaldoInicial');
  if (String(usuario.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: financeiro:migrarSaldoInicial');
  }
  return json(auditarSaidasLegado2025(params));
}

if (action === 'migrarSaidasLegadoNfFolha2025') {
  const usuario = exigirAcao('financeiro:migrarSaldoInicial');
  if (String(usuario.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: financeiro:migrarSaldoInicial');
  }
  return json(migrarSaidasLegadoNfFolha2025(params));
}

if (action === 'auditarBvLegado2025a2027') {
  const usuario = exigirAcao('financeiro:migrarSaldoInicial');
  if (String(usuario.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: financeiro:migrarSaldoInicial');
  }
  return json(auditarBvLegado2025a2027(params));
}

if (action === 'migrarBvLegado2025a2027') {
  const usuario = exigirAcao('financeiro:migrarSaldoInicial');
  if (String(usuario.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: financeiro:migrarSaldoInicial');
  }
  return json(migrarBvLegado2025a2027(params));
}

// ======================================================
// 12. AGENDA SEMANAL (WHATSAPP)
// ======================================================
if (action === 'carregarAgendaSemanalPreview') {
  exigirAcao('agenda:gerarSemanal');
  return json(carregarAgendaSemanalPreview(params));
}

if (action === 'gerarTextoAgendaSemanal') {
  exigirAcao('agenda:gerarSemanal');
  let eventos = [];
  try {
    const eventosJson = String(params.eventosJson || '').trim();
    eventos = eventosJson ? JSON.parse(eventosJson) : [];
  } catch (_) {
    eventos = [];
  }
  return json(gerarTextoAgendaSemanal({
    dataInicio: params.dataInicio,
    dataFim: params.dataFim,
    eventos: eventos,
    incluirLinksCalendario: params.incluirLinksCalendario,
    baseUrlCalendario: params.baseUrlCalendario,
    lembreteCalendarioMinutos: params.lembreteCalendarioMinutos
  }));
}

// ======================================================
// 13. ORÇAMENTO (UTILITÁRIO EXTERNO INTEGRADO)
// ======================================================
if (action === 'gerarOrcamentoInterno') {
  exigirAcao('orcamento:gerar');
  return json(gerarOrcamentoInterno(params, emailAutenticado));
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

  if (msg === 'SESSION_TOKEN_REQUIRED') {
    codigo = 'SESSAO_INVALIDA';
    mensagem = 'Sessão ausente. Faça login novamente.';
  }

  if (msg === 'SESSION_TOKEN_INVALID') {
    codigo = 'SESSAO_INVALIDA';
    mensagem = 'Sessão inválida. Faça login novamente.';
  }

  if (msg === 'SESSION_TOKEN_EXPIRED') {
    codigo = 'SESSAO_EXPIRADA';
    mensagem = 'Sessão expirada. Faça login novamente.';
  }

  if (msg.indexOf('ORCAMENTO_') === 0) {
    codigo = 'ORCAMENTO_ERRO';
    mensagem = msg;
  }

  // Observabilidade determinística para rastrear falhas de produção
  Logger.log(
    '[API_AUTH_ERRO] requestId=' + requestId +
    ' action=' + String(action || '') +
    ' email=' + String(emailAutenticado || email || '') +
    ' codigo=' + codigo +
    ' msg=' + msg +
    (stack ? ' stack=' + stack : '')
  );

  // Log persistente e enxuto (apenas erro) na planilha para troubleshooting.
  try {
    registrarErroApiDoPost_({
      requestId: requestId,
      action: action,
      email: emailAutenticado || email,
      codigo: codigo,
      mensagem: msg,
      stack: stack,
      duracaoMs: Date.now() - startedAt
    });
  } catch (logErr) {
    Logger.log('[API_AUTH_ERRO_LOG_FALHA] requestId=' + requestId + ' erro=' + String(logErr));
  }

  // Para ações críticas, devolve a mensagem técnica para diagnóstico rápido no frontend.
  if (
    action === 'fecharComissaoVendedor' ||
    action === 'visualizarPreviewFechamento' ||
    action === 'reconciliarResumoFinanceiroEvento'
  ) {
    mensagem = msg || mensagem;
  }

  // Para orçamento integrado, também devolve erro técnico para diagnóstico rápido.
  if (action === 'gerarOrcamentoInterno') {
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
function verificarUsuario(params) {
  const idToken = String((params && params.idToken) || '').trim();
  const sessionToken = String((params && params.sessionToken) || '').trim();

  if (!idToken && !sessionToken) {
    return json({ ok: false, error: 'AUTH_REQUIRED' });
  }

  if (sessionToken && !idToken) {
    const sessao = validarSessionToken_(sessionToken);
    const userSessao = requireUserByEmail(sessao.e);
    return json({
      ok: true,
      user: {
        email: userSessao.EMAIL,
        nome: userSessao.NOME,
        perfil: userSessao.PERFIL
      }
    });
  }

  const identidade = validarIdTokenGoogle_(idToken);
  const user = requireUserByEmail(identidade.email);
  const novoSessionToken = criarSessionToken_({
    email: String(user.EMAIL || '').trim().toLowerCase(),
    nome: String(user.NOME || '').trim(),
    perfil: String(user.PERFIL || '').trim()
  });

  return json({
    ok: true,
    sessionToken: novoSessionToken,
    sessionExpiresIn: getSessionTtlSeconds_(),
    user: {
      email: user.EMAIL,
      nome: user.NOME,
      perfil: user.PERFIL
    }
  });
}

function autenticarRequisicaoComSessao_(params) {
  const token = String((params && params.sessionToken) || '').trim();
  if (!token) {
    throw new Error('SESSION_TOKEN_REQUIRED');
  }

  const payload = validarSessionToken_(token);
  if (!payload || !payload.e) {
    throw new Error('SESSION_TOKEN_INVALID');
  }

  return String(payload.e).trim().toLowerCase();
}

function validarIdTokenGoogle_(idToken) {
  const url =
    'https://oauth2.googleapis.com/tokeninfo?id_token=' +
    encodeURIComponent(idToken);

  let response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true
    });
  } catch (_) {
    throw new Error('GOOGLE_TOKENINFO_UNAVAILABLE');
  }

  if (!response || response.getResponseCode() !== 200) {
    throw new Error('GOOGLE_ID_TOKEN_INVALID');
  }

  let data = {};
  try {
    data = JSON.parse(response.getContentText() || '{}');
  } catch (_) {
    throw new Error('GOOGLE_ID_TOKEN_INVALID');
  }

  if (String(data.aud || '').trim() !== AUTH_CONFIG.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_AUDIENCE_MISMATCH');
  }

  if (String(data.email_verified || '').toLowerCase() !== 'true') {
    throw new Error('GOOGLE_EMAIL_NOT_VERIFIED');
  }

  const expSeconds = Number(data.exp || 0);
  if (!expSeconds || (expSeconds * 1000) <= Date.now()) {
    throw new Error('GOOGLE_ID_TOKEN_EXPIRED');
  }

  const email = String(data.email || '').trim().toLowerCase();
  if (!email) {
    throw new Error('GOOGLE_EMAIL_MISSING');
  }

  return {
    email: email,
    sub: String(data.sub || '').trim()
  };
}

function criarSessionToken_(user) {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = getSessionTtlSeconds_();
  const payload = {
    e: String(user.email || '').trim().toLowerCase(),
    n: String(user.nome || ''),
    p: String(user.perfil || ''),
    iat: now,
    exp: now + ttlSeconds,
    jti: Utilities.getUuid().replace(/-/g, '')
  };

  const payloadB64 = base64UrlEncodeString_(JSON.stringify(payload));
  const assinatura = assinarTextoHex_(payloadB64);
  return payloadB64 + '.' + assinatura;
}

function validarSessionToken_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) {
    throw new Error('SESSION_TOKEN_INVALID');
  }

  const payloadB64 = parts[0];
  const assinaturaRecebida = parts[1];
  if (!payloadB64 || !assinaturaRecebida) {
    throw new Error('SESSION_TOKEN_INVALID');
  }

  const assinaturaEsperada = assinarTextoHex_(payloadB64);
  if (assinaturaEsperada !== assinaturaRecebida) {
    throw new Error('SESSION_TOKEN_INVALID');
  }

  let payload = null;
  try {
    payload = JSON.parse(base64UrlDecodeToString_(payloadB64));
  } catch (_) {
    throw new Error('SESSION_TOKEN_INVALID');
  }

  const exp = Number(payload && payload.exp);
  if (!exp || (exp * 1000) <= Date.now()) {
    throw new Error('SESSION_TOKEN_EXPIRED');
  }

  return payload;
}

function assinarTextoHex_(texto) {
  const secret = obterAuthSessionSecret_();
  const bytes = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_256,
    String(texto || ''),
    secret
  );
  return bytes
    .map(function (b) {
      return ((b + 256) % 256).toString(16).padStart(2, '0');
    })
    .join('');
}

function obterAuthSessionSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = String(props.getProperty('AUTH_SESSION_SECRET') || '').trim();
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('AUTH_SESSION_SECRET', secret);
  }
  return secret;
}

function base64UrlEncodeString_(str) {
  return Utilities.base64EncodeWebSafe(String(str || ''), Utilities.Charset.UTF_8)
    .replace(/=+$/g, '');
}

function base64UrlDecodeToString_(b64url) {
  let base = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = base.length % 4;
  if (padding) base += '===='.slice(padding);
  const bytes = Utilities.base64Decode(base);
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}

function getSessionTtlSeconds_() {
  let dias = Number(obterConfig('AUTH_SESSION_TTL_DIAS'));
  if (isNaN(dias) || dias <= 0) {
    dias = AUTH_CONFIG.SESSION_TTL_DIAS_PADRAO;
  }

  // Limites defensivos: mínimo 1 dia, máximo 365 dias.
  dias = Math.max(1, Math.min(365, Math.floor(dias)));
  return dias * 24 * 60 * 60;
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
const SOCIO_RULES = [
  'eventos:criar',
  'eventos:editar',
  'eventos:listar',
  'eventos:visualizarFinanceiro',
  'eventos:registrarSaidaBV',
  'agenda:gerarSemanal',
  'orcamento:gerar'
];

const ACL = {
  'Proprietário': ['*'],
  'Sócio': SOCIO_RULES,
  'Administrador': SOCIO_RULES,
  'Admin': SOCIO_RULES,
  'Músico': ['eventos:listar']
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
