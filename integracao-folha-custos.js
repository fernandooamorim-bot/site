/**
 * ======================================================
 * INTEGRAÇÃO — FOLHA DE CUSTOS (UTILITÁRIO EXTERNO)
 * ======================================================
 * Proxy server-side para evitar expor endpoint externo no frontend.
 * Acesso controlado por ACL no api-auth.js.
 */

function folhaCustosProxy(params, email) {
  const cfg = getConfig() || {};
  const endpointDefault = 'https://script.google.com/macros/s/AKfycbz80MmKhqx7DHg2HBWwrznJ4qGHdfWUhCubppjKkxgfbRrjFP5yCCb04J6QJI1sFxrh/exec';
  const endpoint = String(cfg.FOLHA_CUSTOS_WEBHOOK_URL || endpointDefault).trim();

  if (!endpoint) {
    throw new Error('FOLHA_CUSTOS_CONFIG_INCOMPLETA: FOLHA_CUSTOS_WEBHOOK_URL');
  }

  const externalAction = String(params.externalAction || '').trim();
  if (!externalAction) {
    throw new Error('FOLHA_CUSTOS_DADO_OBRIGATORIO: externalAction');
  }
  if (!acaoFolhaCustosPermitida_(externalAction)) {
    throw new Error('FOLHA_CUSTOS_ACAO_INVALIDA: ' + externalAction);
  }

  const usuario = requireUserByEmail(email);
  const payloadEntrada = extrairPayloadFolhaCustos_(params);
  const payload = Object.assign({}, payloadEntrada);
  normalizarPayloadRelatorioFolhaCustos_(externalAction, payload);
  anexarEscopoSeguroRelatorioFolhaCustos_(externalAction, payload, endpoint, usuario);
  payload.action = externalAction;

  // Mantém rastreabilidade e compatibilidade com "verificarUsuario" do utilitário.
  if (!payload.email) payload.email = String(usuario.EMAIL || '');

  let result = chamarEndpointFolhaCustos_(endpoint, payload);
  let status = result.status;
  let text = result.text;
  let data = result.data;

  if (status < 200 || status >= 300) {
    throw new Error('FOLHA_CUSTOS_HTTP_' + status + (text ? (': ' + text.slice(0, 300)) : ''));
  }

  // Fallback seguro:
  // Se o endpoint configurado responder "Nenhum evento encontrado no período"
  // para ações de relatório, tenta o endpoint oficial padrão.
  if (
    endpoint !== endpointDefault &&
    deveTentarFallbackRelatorioFolhaCustos_(externalAction, payload, data)
  ) {
    const fallback = chamarEndpointFolhaCustos_(endpointDefault, payload);
    if (fallback.status >= 200 && fallback.status < 300 && fallback.data) {
      result = fallback;
      status = fallback.status;
      text = fallback.text;
      data = fallback.data;
    }
  }

  if (!data) {
    throw new Error('FOLHA_CUSTOS_RESPOSTA_INVALIDA');
  }

  return {
    sucesso: true,
    externalAction: externalAction,
    data: data,
    debug: {
      endpointUtilizado: result.endpoint
    }
  };
}

function chamarEndpointFolhaCustos_(endpoint, payload) {
  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    followRedirects: true,
    escaping: false,
    validateHttpsCertificates: true
  });

  const status = Number(response.getResponseCode() || 0);
  const text = response.getContentText() || '';
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }

  return {
    endpoint: endpoint,
    status: status,
    text: text,
    data: data
  };
}

function cacheFolhaCustos_() {
  try {
    return CacheService.getScriptCache();
  } catch (_) {
    return null;
  }
}

function cacheKeyPendenciasFolhaCusto_() {
  return 'folha_custos|pendencias_aprovacao|v2';
}

function cacheKeyEventoFolhaProcessada_(idEvento) {
  return 'folha_custos|evento_processado|' + String(idEvento || '').trim();
}

function lerCachePendenciasFolhaCusto_() {
  const cache = cacheFolhaCustos_();
  if (!cache) return null;
  try {
    const raw = cache.get(cacheKeyPendenciasFolhaCusto_());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.pendentes)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function salvarCachePendenciasFolhaCusto_(payload, ttlSegundos) {
  const cache = cacheFolhaCustos_();
  if (!cache || !payload || typeof payload !== 'object') return;
  try {
    cache.put(
      cacheKeyPendenciasFolhaCusto_(),
      JSON.stringify(payload),
      Math.max(10, Math.min(300, Number(ttlSegundos || 45) || 45))
    );
  } catch (_) {}
}

function normalizarPayloadRelatorioFolhaCustos_(action, payload) {
  if (!acaoRelatorioFolhaCustos_(action)) return;
  payload.dataInicio = normalizarDataIsoOuBr_(payload.dataInicio);
  payload.dataFim = normalizarDataIsoOuBr_(payload.dataFim);
}

/**
 * O frontend nunca escolhe quais folhas entram em um relatório. Para ações de
 * relatório, a seleção é recalculada no backend a partir do livro financeiro:
 * apenas referências FOLHA_PROP que seguem PROCESSADAS são encaminhadas ao
 * formatador externo. Isso preserva o histórico cancelado sem que ele possa
 * voltar a compor valores ou contagens.
 */
function anexarEscopoSeguroRelatorioFolhaCustos_(action, payload, endpoint, usuario) {
  if (!acaoRelatorioFolhaCustos_(action)) return;

  const respostaFolhas = chamarEndpointFolhaCustos_(endpoint, {
    action: 'getFolhasCusto',
    email: String((usuario && usuario.EMAIL) || '')
  });
  if (respostaFolhas.status < 200 || respostaFolhas.status >= 300 || !respostaFolhas.data) {
    throw new Error('FOLHA_CUSTOS_NAO_FOI_POSSIVEL_VALIDAR_RELATORIO');
  }

  const indice = construirIndiceFolhasFinanceiro_();
  // Relatórios clássicos e análise usam o mesmo conjunto financeiro seguro.
  // Assim, o legado conciliado não desaparece do PDF, mas canceladas,
  // substituídas e pendências novas continuam fora.
  const idsAutorizados = normalizarFolhasElegiveisParaRelatorio_(
    normalizarListaFolhasCusto_(respostaFolhas.data),
    indice
  )
    .map(function (folha) { return String(folha.id || '').trim(); });

  // Sobrescreve qualquer valor recebido do cliente.
  payload.idsFolhasAutorizadas = idsAutorizados;
}

function normalizarDataIsoOuBr_(valor) {
  const raw = String(valor || '').trim();
  if (!raw) return '';

  // ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // BR: DD/MM/YYYY -> ISO
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const p = raw.split('/');
    return [p[2], p[1], p[0]].join('-');
  }

  return raw;
}

function acaoRelatorioFolhaCustos_(action) {
  const a = String(action || '').trim();
  return a === 'gerarPreviewPDF' || a === 'gerarPDFRelatorio' || a === 'abrirPDFDrive';
}

function deveTentarFallbackRelatorioFolhaCustos_(action, payload, data) {
  if (!acaoRelatorioFolhaCustos_(action)) return false;
  if (!payload || !payload.dataInicio || !payload.dataFim) return false;
  const msg = String((data && (data.message || data.error)) || '').toLowerCase();
  return msg.indexOf('nenhum evento encontrado no período') !== -1;
}

function extrairPayloadFolhaCustos_(params) {
  const p = params && typeof params === 'object' ? params : {};

  // 1) Formato ideal: payload já objeto
  if (p.payload && typeof p.payload === 'object') {
    return Object.assign({}, p.payload);
  }

  // 2) Formato stringificado via formulário (payloadJson)
  if (typeof p.payloadJson === 'string' && p.payloadJson.trim()) {
    try {
      const parsedJson = JSON.parse(p.payloadJson);
      if (parsedJson && typeof parsedJson === 'object') {
        return Object.assign({}, parsedJson);
      }
    } catch (_) {}
  }

  // 3) Formato stringificado em payload
  if (typeof p.payload === 'string' && p.payload.trim()) {
    try {
      const parsedPayload = JSON.parse(p.payload);
      if (parsedPayload && typeof parsedPayload === 'object') {
        return Object.assign({}, parsedPayload);
      }
    } catch (_) {}
  }

  // 4) Fallback: parâmetros achatados do formulário
  const ignorar = {
    action: true,
    externalAction: true,
    sessionToken: true
  };
  const out = {};
  Object.keys(p).forEach(function (k) {
    if (ignorar[k]) return;
    out[k] = p[k];
  });
  return out;
}

function acaoFolhaCustosPermitida_(action) {
  const allow = [
    'verificarUsuario',
    'getConfiguracoes',
    'getMusicos',
    'getPacotes',
    'getServicos',
    'getDadosBaseFolha',
    'getFolhasCusto',
    'getResumoFolhasCusto',
    'getFolhasCustoPorEvento',
    'getFolhaCusto',
    'salvarFolhaCusto',
    'atualizarStatusAgendaFolhaCusto',
    'salvarNovoServico',
    'gerarPreviewPDF',
    'gerarPDFRelatorio',
    'abrirPDFDrive'
  ];
  return allow.indexOf(String(action || '').trim()) !== -1;
}

function listarPendenciasFolhaCustoAprovacao(params, email) {
  const p = (params && typeof params === 'object') ? params : {};
  const forceRefresh = p.forceRefresh === true || String(p.forceRefresh || '').trim().toLowerCase() === 'true';
  const ttlSegundos = 120;

  if (!forceRefresh) {
    const cached = lerCachePendenciasFolhaCusto_();
    if (cached) {
      return Object.assign({}, cached, {
        fromCache: true
      });
    }
  }

  const resp = folhaCustosProxy({
    externalAction: 'getFolhasCusto',
    payload: {}
  }, email);
  const lista = normalizarListaFolhasCusto_(resp && resp.data);
  const candidatos = lista
    .filter(function (f) {
      const meta = extrairMetaAgendaFolha_(f);
      const status = String((meta.statusAprovacao || f.statusAprovacao) || '').trim().toUpperCase();
      const idEvento = String((meta.idEvento || f.idEvento || f.idEventoAgenda) || '').trim();
      return idEvento && (status === 'PENDENTE_APROVACAO' || status === 'PENDENTE' || status === 'SOLICITADO');
    })
    .sort(function (a, b) {
      const ta = new Date(a && (a.criadoEm || a.dataCriacao || a.data) || 0).getTime() || 0;
      const tb = new Date(b && (b.criadoEm || b.dataCriacao || b.data) || 0).getTime() || 0;
      return tb - ta;
    })
    .map(function (f) {
      const meta = extrairMetaAgendaFolha_(f);
      const totais = extrairTotaisFolha_(f);
      const valor = Number(totais.geral || 0) || 0;
      return {
        _raw: f,
        id: String((f && f.id) || '').trim(),
        idEvento: String((meta.idEvento || f.idEvento || f.idEventoAgenda) || '').trim(),
        nomeEvento: String((f && f.nomeEvento) || '').trim(),
        data: formatarDataPendenciaFolha_(f && f.data),
        valorTotal: Number(valor.toFixed(2)),
        resumoCompacto: compactarResumoFolhaCusto_(f),
        statusAprovacao: String((meta.statusAprovacao || f.statusAprovacao || 'PENDENTE_APROVACAO')).trim(),
        tipoSolicitacao: String((meta.tipoSolicitacao || f.tipoSolicitacao || '')).trim().toUpperCase(),
        criadoPor: String((f && f.criadoPor) || '').trim(),
        criadoEm: String((f && f.criadoEm) || '').trim(),
        musicos: (f && f.musicos) || [],
        terceirizados: (f && f.terceirizados) || []
      };
    });

  const pendentes = [];
  const indiceFinanceiro = construirIndiceFolhasFinanceiro_();
  const reconciliarAutomatico = p.reconciliarAutomatico === true || String(p.reconciliarAutomatico || '').trim().toLowerCase() === 'true';
  const limiteRecon = 8;
  const inicioReconMs = Date.now();
  const orcamentoReconMs = 1200;
  for (var i = 0; i < candidatos.length; i++) {
    var item = candidatos[i];
    var idEvento = String(item.idEvento || '').trim();
    if (!idEvento) continue;

    // Regra de consistência: se já foi processada no financeiro, não deve aparecer como pendência.
    var jaProcessadaAgenda = eventoTemFolhaProcessadaNoIndice_(indiceFinanceiro, idEvento);
    var folhaJaAplicadaPorReferencia = folhaJaAplicadaNoIndice_(indiceFinanceiro, idEvento, item.id);
    var ehRevisaoFolhaAtiva = String(item.tipoSolicitacao || '').trim().toUpperCase() === 'REVISAO_FOLHA_ATIVA';
    if (folhaJaAplicadaPorReferencia) {
      // A referência da própria folha já está PROCESSADA no financeiro. Mesmo que
      // o utilitário externo ainda retorne PENDENTE por cache/falha de sync, não
      // devemos reapresentar nem permitir reprocessar a mesma folha.
      if (reconciliarAutomatico && i < limiteRecon && (Date.now() - inicioReconMs) <= orcamentoReconMs) {
        try {
          sincronizarFolhaPendenteComoAprovada_(item._raw, idEvento, email);
        } catch (eSyncRef) {
          Logger.log('Falha ao auto-sincronizar folha já aplicada por referência: ' + eSyncRef.message);
        }
      }
      continue;
    }
    if (jaProcessadaAgenda && !ehRevisaoFolhaAtiva) {
      // Reconciliação automática segue opcional e limitada por tempo para não degradar o carregamento.
      if (reconciliarAutomatico && i < limiteRecon && (Date.now() - inicioReconMs) <= orcamentoReconMs) {
        try {
          sincronizarFolhaPendenteComoAprovada_(item._raw, idEvento, email);
        } catch (eSync) {
          Logger.log('Falha ao auto-sincronizar folha aprovada no utilitário: ' + eSync.message);
        }
      }
      continue;
    }

    var out = Object.assign({}, item);
    delete out._raw;
    pendentes.push(out);
  }

  const payload = {
    sucesso: true,
    total: pendentes.length,
    pendentes: pendentes,
    updatedAt: new Date().toISOString(),
    fromCache: false
  };
  salvarCachePendenciasFolhaCusto_(payload, pendentes.length ? ttlSegundos : 60);
  return payload;
}

/**
 * Lê MOVIMENTACOES_FINANCEIRAS uma única vez para a listagem de pendências.
 * Mantém os mesmos critérios das verificações individuais anteriores.
 */
function construirIndiceFolhasFinanceiro_() {
  const indice = {
    valorProcessadoPorEvento: Object.create(null),
    referenciasProcessadas: Object.create(null),
    textosReferenciaPorEvento: Object.create(null),
    movimentosLegadosProcessados: []
  };

  try {
    const ss = SpreadsheetApp.getActive();
    const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    if (!shMov) return indice;

    const data = shMov.getDataRange().getValues();
    if (!data || data.length < 2) return indice;

    const head = data[0].map(function (h) { return String(h || '').trim(); });
    const idxTipo = head.indexOf('TIPO_MOVIMENTACAO');
    const idxIdEvento = head.indexOf('ID_EVENTO');
    const idxStatus = head.indexOf('STATUS');
    const idxValor = head.indexOf('VALOR');
    const idxRef = head.indexOf('REFERENCIA');
    const idxObs = head.indexOf('OBSERVACOES');
    if (idxTipo === -1 || idxIdEvento === -1 || idxStatus === -1) return indice;

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (String(row[idxTipo] || '').trim() !== 'FOLHA_EVENTO') continue;
      if (statusFinanceiroNormalizado_(row[idxStatus]) !== 'PROCESSADO') continue;

      var idEvento = String(row[idxIdEvento] || '').trim();
      if (!idEvento) continue;

      var rawValor = idxValor !== -1 ? row[idxValor] : 0;
      var valor = typeof rawValor === 'string'
        ? Number(rawValor.replace(/\./g, '').replace(',', '.'))
        : Number(rawValor);
      var valorSeguro = isNaN(valor) ? 0 : valor;
      indice.valorProcessadoPorEvento[idEvento] =
        Number(indice.valorProcessadoPorEvento[idEvento] || 0) + valorSeguro;

      var refMov = idxRef !== -1 ? String(row[idxRef] || '').trim() : '';
      var obsMov = idxObs !== -1 ? String(row[idxObs] || '') : '';
      if (!indice.textosReferenciaPorEvento[idEvento]) {
        indice.textosReferenciaPorEvento[idEvento] = [];
      }
      indice.textosReferenciaPorEvento[idEvento].push(refMov + '\n' + obsMov);
      var refs = extrairReferenciasFolhaProcessada_(refMov, obsMov);
      for (var j = 0; j < refs.length; j++) {
        indice.referenciasProcessadas[idEvento + '|' + refs[j]] = true;
      }
      if (!refs.length) {
        indice.movimentosLegadosProcessados.push({
          idMovimentacao: String(row[0] || '').trim(),
          idEvento: idEvento,
          nomeEvento: String(row[head.indexOf('NOME_EVENTO')] || '').trim(),
          data: head.indexOf('DATA_MOVIMENTACAO') !== -1 ? row[head.indexOf('DATA_MOVIMENTACAO')] : '',
          valor: valorSeguro
        });
      }
    }
  } catch (e) {
    Logger.log('Falha ao construir índice financeiro de folhas: ' + e.message);
  }

  return indice;
}

/**
 * Fonte segura para relatório de pagamento: uma folha só entra quando sua
 * referência ainda está PROCESSADA no livro financeiro. O fluxo atual exige
 * aprovação na folha; folhas legadas (anteriores a esse fluxo), que ficaram
 * como PENDENTE_APROVACAO apesar de já terem sido aplicadas no financeiro,
 * entram pelo vínculo financeiro exato. Isso exclui propostas novas sem
 * lançamento e versões substituídas/canceladas.
 */
function listarFolhasCustoAprovadasParaPagamento(params, email) {
  const resp = folhaCustosProxy({ externalAction: 'getFolhasCusto', payload: {} }, email);
  const indice = construirIndiceFolhasFinanceiro_();
  const folhas = normalizarListaFolhasCusto_(resp && resp.data);
  const aprovadas = normalizarFolhasElegiveisParaRelatorio_(folhas, indice).map(function (folha) {
    const meta = extrairMetaAgendaFolha_(folha);
    const totais = extrairTotaisFolha_(folha);
    return {
      id: String(folha.id || '').trim(),
      idEvento: String((meta.idEvento || folha.idEvento || folha.idEventoAgenda) || '').trim(),
      nomeEvento: String(folha.nomeEvento || '').trim(),
      data: String(folha.data || '').trim(),
      aprovadoEm: String(folha.aprovadoEm || '').trim(),
      totais: totais,
      musicos: folha.musicos || [],
      terceirizados: folha.terceirizados || []
    };
  });
  return { sucesso: true, folhas: aprovadas, geradoEm: new Date().toISOString() };
}

/**
 * Consulta somente leitura para análise de custos/ganhos. Reusa o mesmo
 * critério financeiro dos relatórios: versões canceladas ou substituídas não
 * chegam ao resultado, ainda que existam no histórico da folha externa.
 */
function analisarCustosFolhaPorPeriodo(params, email) {
  const p = params && typeof params === 'object' ? params : {};
  const resp = folhaCustosProxy({ externalAction: 'getFolhasCusto', payload: {} }, email);
  const indice = construirIndiceFolhasFinanceiro_();
  const folhas = normalizarFolhasElegiveisParaRelatorio_(normalizarListaFolhasCusto_(resp && resp.data), indice);
  return construirAnaliseCustosFolhas_(folhas, p);
}

/**
 * A referência financeira exata é a evidência autoritativa de que uma folha
 * foi aplicada. Antes da implantação de aprovação, algumas folhas ficaram
 * registradas como pendentes no utilitário externo; elas são legadas, não
 * solicitações novas. Status explicitamente cancelados/rejeitados nunca entram.
 */
function folhaCustoElegivelParaRelatorioFinanceiro_(folha, indice) {
  const meta = extrairMetaAgendaFolha_(folha);
  const idFolha = String((folha && folha.id) || '').trim();
  const idEvento = String((meta.idEvento || folha.idEvento || folha.idEventoAgenda) || '').trim();
  const status = String((meta.statusAprovacao || folha.statusAprovacao) || '').trim().toUpperCase();
  if (!idFolha || !idEvento) return false;
  if (status === 'CANCELADO' || status === 'REJEITADO') return false;
  if (!folhaJaAplicadaNoIndice_(indice, idEvento, idFolha)) return false;
  return status === 'APROVADO' || status === 'PENDENTE_APROVACAO' || !status;
}

/**
 * Concilia o fluxo atual e o legado. No legado, não há ID_EVENTO gravado na
 * folha: só aceita uma correspondência única por data, total financeiro e
 * similaridade de título, depois de validar o resumo detalhado contra os
 * totais da própria folha. Nenhum item é criado a partir de total agregado.
 */
function normalizarFolhasElegiveisParaRelatorio_(folhas, indice) {
  const saida = [];
  const movimentosUsados = Object.create(null);
  (Array.isArray(folhas) ? folhas : []).forEach(function (folha) {
    if (folhaCustoElegivelParaRelatorioFinanceiro_(folha, indice)) {
      saida.push(folha);
      return;
    }
    const legado = adaptarFolhaLegadaProcessada_(folha, indice, movimentosUsados);
    if (legado) saida.push(legado);
  });
  return saida;
}

// Equivalências revisadas manualmente para folhas criadas antes do vínculo por
// ID_EVENTO. Elas não substituem a conciliação: ainda exigem data e total
// financeiro exatos, além do resumo detalhado validado abaixo.
const EQUIVALENCIAS_FOLHAS_LEGADAS_CONFIRMADAS_ = {
  '1769958695875': 'LG-2026-AGENDA2026-0011', // 15 anos NERISSA ESPAÇO LÔ → Filha Nelida Cervantes
  '1770488353898': 'LG-2026-AGENDA2026-0013', // 15 ANOS MARIA BEATRIZ → Erika Figueiredo
  '1772990143011': 'LG-2026-AGENDA2026-0026'  // Aniversário taís sombra → Niver Thais Sombra
};

function adaptarFolhaLegadaProcessada_(folha, indice, movimentosUsados) {
  const meta = extrairMetaAgendaFolha_(folha);
  const idExistente = String((meta.idEvento || folha.idEvento || folha.idEventoAgenda) || '').trim();
  if (idExistente) return null;
  const detalhe = extrairDetalheResumoFolhaLegada_(folha);
  if (!detalhe) return null;

  const dataFolha = normalizarDataChaveAnaliseFolha_(folha.data);
  const tituloFolha = String(folha.nomeEvento || '').trim();
  const idFolha = String((folha && folha.id) || '').trim();
  const idEventoConfirmado = EQUIVALENCIAS_FOLHAS_LEGADAS_CONFIRMADAS_[idFolha] || '';
  const candidatos = (indice && indice.movimentosLegadosProcessados || []).filter(function (mov) {
    if (movimentosUsados[mov.idMovimentacao]) return false;
    if (normalizarDataChaveAnaliseFolha_(mov.data) !== dataFolha) return false;
    if (Math.abs(Number(mov.valor || 0) - detalhe.totalGeral) > 0.02) return false;
    if (idEventoConfirmado) return mov.idEvento === idEventoConfirmado;
    return similaridadeTituloFolhaLegada_(tituloFolha, mov.nomeEvento) >= 0.5;
  });
  if (candidatos.length !== 1) return null;

  const mov = candidatos[0];
  movimentosUsados[mov.idMovimentacao] = true;
  const adaptada = Object.assign({}, folha, {
    idEvento: mov.idEvento,
    idEventoAgenda: mov.idEvento,
    statusAprovacao: 'LEGADO_PROCESSADO',
    agendaSincronizado: true,
    agendaReferencia: 'LEGADO:' + mov.idMovimentacao,
    agendaMovimentacao: mov.idMovimentacao,
    musicos: detalhe.musicos,
    terceirizados: detalhe.terceirizados,
    totais: {
      musicos: Number(folha.totalMusicos || 0) || 0,
      adicionais: Number(folha.totalAdicionais || 0) || 0,
      terceirizados: Number(folha.totalTerceirizados || 0) || 0,
      geral: detalhe.totalGeral
    }
  });
  adaptada.Folhas_Custo = Object.assign({}, folha.Folhas_Custo || {}, {
    agenda: Object.assign({}, meta, { idEvento: mov.idEvento, statusAprovacao: 'LEGADO_PROCESSADO' })
  });
  return adaptada;
}

function extrairDetalheResumoFolhaLegada_(folha) {
  const resumo = String((folha && (folha.resumo || folha.resumoCompacto)) || '');
  if (!resumo) return null;
  const musicos = extrairItensResumoFolhaLegada_(resumo, /(?:👥\s*)?MÚSICOS\s*\(\s*\d+\s*\)\s*:?/gi, /\n(?:CUSTOS TERCEIRIZADOS|CUSTOS OPERACIONAIS|━━━━━━━━)/i, 'musico');
  const terceirizados = extrairItensResumoFolhaLegada_(resumo, /(?:CUSTOS TERCEIRIZADOS|CUSTOS OPERACIONAIS)(?:\s*\(\s*\d+\s*\))?\s*:?/gi, /\n(?:CUSTO TOTAL|👥\s*MÚSICOS|━━━━━━━━)/i, 'terceirizado');
  const totalMusicos = Number(folha.totalMusicos || 0) || 0;
  const totalAdicionais = Number(folha.totalAdicionais || 0) || 0;
  const totalTerceiros = Number(folha.totalTerceirizados || 0) || 0;
  const totalGeral = Number(folha.custoTotal || (totalMusicos + totalAdicionais + totalTerceiros)) || 0;
  const somaMusicos = musicos.reduce(function (s, item) { return s + Number(item.total || 0); }, 0);
  const somaTerceiros = terceirizados.reduce(function (s, item) { return s + Number(item.valor || 0); }, 0);
  if (!musicos.length || Math.abs(somaMusicos - (totalMusicos + totalAdicionais)) > 0.02) return null;
  if (Math.abs(somaTerceiros - totalTerceiros) > 0.02) return null;
  if (Math.abs((somaMusicos + somaTerceiros) - totalGeral) > 0.02) return null;
  return { musicos: musicos, terceirizados: terceirizados, totalGeral: totalGeral };
}

function extrairItensResumoFolhaLegada_(resumo, marcador, fim, tipo) {
  let achado = null;
  let match;
  marcador.lastIndex = 0;
  while ((match = marcador.exec(resumo)) !== null) achado = match;
  if (!achado) return [];
  let bloco = resumo.slice(achado.index + achado[0].length);
  const fimMatch = fim.exec(bloco);
  if (fimMatch) bloco = bloco.slice(0, fimMatch.index);
  const itens = [];
  const linha = /^[•-]\s*(.+?)\s+\(([^)]+)\)\s*(?:–|:)\s*R\$\s*(-?[\d.,]+)/gm;
  let item;
  while ((item = linha.exec(bloco)) !== null) {
    const valor = numeroResumoFolhaLegada_(item[3]);
    // O legado pode registrar ajuste operacional negativo para reconciliar o
    // total histórico à movimentação financeira, sem alterar cachês pagos.
    if (!isFinite(valor) || (tipo === 'musico' && valor < 0)) return [];
    if (tipo === 'musico') {
      itens.push({ nome: String(item[1] || '').trim(), funcao: String(item[2] || '').trim(), total: valor });
    } else {
      itens.push({ nome: String(item[1] || '').trim(), categoria: String(item[2] || '').trim(), valor: valor });
    }
  }
  return itens;
}

function numeroResumoFolhaLegada_(valor) {
  const raw = String(valor || '').trim();
  if (!raw) return 0;
  if (raw.indexOf(',') !== -1 && raw.indexOf('.') !== -1) return Number(raw.replace(/\./g, '').replace(',', '.')) || 0;
  return Number(raw.replace(',', '.')) || 0;
}

function similaridadeTituloFolhaLegada_(a, b) {
  const limpar = function (valor) {
    return normalizarTextoAnaliseFolha_(valor)
      .replace(/\b(evento|casamento|aniversario|15 anos|xv anos)\b/g, ' ')
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/).filter(function (token) { return token.length > 2; });
  };
  const ta = limpar(a);
  const tb = limpar(b);
  if (!ta.length || !tb.length) return 0;
  const indice = Object.create(null);
  tb.forEach(function (token) { indice[token] = true; });
  let comum = 0;
  ta.forEach(function (token) { if (indice[token]) comum++; });
  return comum / Math.max(ta.length, tb.length);
}

function construirAnaliseCustosFolhas_(folhas, params) {
  const p = params && typeof params === 'object' ? params : {};
  const visao = ['INTEGRANTES', 'SERVICOS', 'EVENTOS'].indexOf(String(p.visao || '').toUpperCase()) >= 0
    ? String(p.visao).toUpperCase()
    : 'INTEGRANTES';
  const baseData = String(p.baseData || '').toUpperCase() === 'APROVACAO' ? 'APROVACAO' : 'EVENTO';
  const inicio = normalizarDataChaveAnaliseFolha_(p.dataInicio);
  const fim = normalizarDataChaveAnaliseFolha_(p.dataFim);
  const filtro = normalizarTextoAnaliseFolha_(p.filtro || '');
  const filtroServico = normalizarTextoAnaliseFolha_(p.filtroServico || '');
  const grupos = Object.create(null);
  const eventos = [];
  let total = 0;
  let folhasIncluidas = 0;

  (Array.isArray(folhas) ? folhas : []).forEach(function (folha) {
    const dataRef = baseData === 'APROVACAO' ? (folha.aprovadoEm || folha.criadoEm) : folha.data;
    const dataChave = normalizarDataChaveAnaliseFolha_(dataRef);
    if ((inicio && (!dataChave || dataChave < inicio)) || (fim && (!dataChave || dataChave > fim))) return;

    const musicos = normalizarItensAnaliseFolha_(folha.musicos);
    const servicos = normalizarItensAnaliseFolha_(folha.terceirizados);
    let linhas = [];
    if (visao === 'INTEGRANTES') {
      linhas = musicos.filter(function (item) {
        return !filtro || normalizarTextoAnaliseFolha_(item.nome || item.funcao || '').indexOf(filtro) !== -1;
      }).map(function (item) {
        return {
          chave: String(item.nome || 'Sem nome').trim() || 'Sem nome',
          rotulo: String(item.nome || 'Sem nome').trim() || 'Sem nome',
          categoria: String(item.funcao || 'Integrante').trim() || 'Integrante',
          valor: valorIntegranteAnaliseFolha_(item)
        };
      });
    } else if (visao === 'SERVICOS') {
      linhas = servicos.filter(function (item) {
        const texto = [item.nome, item.servico, item.descricao, item.categoria].join(' ');
        return !filtroServico || normalizarTextoAnaliseFolha_(texto).indexOf(filtroServico) !== -1;
      }).map(function (item) {
        const nome = String(item.nome || item.servico || item.descricao || item.categoria || 'Serviço não identificado').trim();
        return {
          chave: nome,
          rotulo: nome,
          categoria: String(item.categoria || 'Terceirizado').trim() || 'Terceirizado',
          valor: Number(item.valor || item.total || 0) || 0
        };
      });
    } else {
      const atendeIntegrante = !filtro || musicos.some(function (item) {
        return normalizarTextoAnaliseFolha_(item.nome || item.funcao || '').indexOf(filtro) !== -1;
      });
      const atendeServico = !filtroServico || servicos.some(function (item) {
        return normalizarTextoAnaliseFolha_([item.nome, item.servico, item.descricao, item.categoria].join(' ')).indexOf(filtroServico) !== -1;
      });
      if (!atendeIntegrante || !atendeServico) return;
      linhas = [{
        chave: String(folha.idEvento || folha.id || ''),
        rotulo: String(folha.nomeEvento || 'Evento').trim() || 'Evento',
        categoria: formatarDataPendenciaFolha_(folha.data),
        valor: Number(extrairTotaisFolha_(folha).geral || 0) || 0
      }];
    }

    if (!linhas.length) return;
    folhasIncluidas++;
    linhas.forEach(function (linha) {
      const chave = linha.chave + '|' + linha.categoria;
      if (!grupos[chave]) {
        grupos[chave] = { nome: linha.rotulo, categoria: linha.categoria, valor: 0, quantidade: 0 };
      }
      grupos[chave].valor += Number(linha.valor || 0) || 0;
      grupos[chave].quantidade++;
      total += Number(linha.valor || 0) || 0;
      eventos.push({
        evento: String(folha.nomeEvento || 'Evento').trim() || 'Evento',
        data: formatarDataPendenciaFolha_(folha.data),
        item: linha.rotulo,
        categoria: linha.categoria,
        valor: Number(linha.valor || 0) || 0
      });
    });
  });

  const gruposOrdenados = Object.keys(grupos).map(function (chave) {
    const grupo = grupos[chave];
    return { nome: grupo.nome, categoria: grupo.categoria, valor: Number(grupo.valor.toFixed(2)), quantidade: grupo.quantidade };
  }).sort(function (a, b) { return b.valor - a.valor || a.nome.localeCompare(b.nome); });

  return {
    sucesso: true,
    visao: visao,
    baseData: baseData,
    total: Number(total.toFixed(2)),
    folhasIncluidas: folhasIncluidas,
    grupos: gruposOrdenados,
    detalhes: eventos.sort(function (a, b) { return b.valor - a.valor; }),
    geradoEm: new Date().toISOString()
  };
}

function normalizarItensAnaliseFolha_(valor) {
  if (Array.isArray(valor)) return valor;
  if (typeof valor === 'string' && valor.trim()) {
    try { return JSON.parse(valor); } catch (_) {}
  }
  return [];
}

function valorIntegranteAnaliseFolha_(item) {
  const i = item && typeof item === 'object' ? item : {};
  if (Number(i.total || 0) > 0) return Number(i.total || 0);
  return Number(i.valorBase || 0) + Number(i.adicionalAutomatico || 0) +
    Number(i.ajusteLiquido || i.adicionalExtra || 0) + Number(i.adicionalPassagem || 0);
}

function normalizarTextoAnaliseFolha_(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function normalizarDataChaveAnaliseFolha_(valor) {
  const raw = String(valor || '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return br[3] + '-' + br[2] + '-' + br[1];
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function extrairReferenciasFolhaProcessada_(referencia, observacoes) {
  const encontrados = [];
  const vistos = Object.create(null);
  const textos = [String(referencia || ''), String(observacoes || '')];
  for (var i = 0; i < textos.length; i++) {
    var re = /FOLHA_PROP:([^\s|;,]+)/g;
    var match;
    while ((match = re.exec(textos[i])) !== null) {
      var idFolha = String(match[1] || '').trim();
      if (idFolha && !vistos[idFolha]) {
        vistos[idFolha] = true;
        encontrados.push(idFolha);
      }
    }
  }
  return encontrados;
}

function eventoTemFolhaProcessadaNoIndice_(indice, idEvento) {
  const id = String(idEvento || '').trim();
  if (!id || !indice) return false;
  return Number(indice.valorProcessadoPorEvento[id] || 0) > 0;
}

function folhaJaAplicadaNoIndice_(indice, idEvento, idFolha) {
  const idEvt = String(idEvento || '').trim();
  const id = String(idFolha || '').trim();
  if (!indice || !idEvt || !id) return false;
  if (indice.referenciasProcessadas[idEvt + '|' + id] === true) return true;

  // Preserva a compatibilidade exata com a regra anterior, que aceitava a
  // referência em qualquer trecho de REFERENCIA ou OBSERVACOES.
  const alvo = 'FOLHA_PROP:' + id;
  const textos = indice.textosReferenciaPorEvento[idEvt] || [];
  for (var i = 0; i < textos.length; i++) {
    if (String(textos[i] || '').indexOf(alvo) !== -1) return true;
  }
  return false;
}

function aprovarPendenciaFolhaCusto(params, email) {
  const idFolha = String((params && params.idFolha) || '').trim();
  if (!idFolha) throw new Error('FOLHA_ID_OBRIGATORIO');

  const folha = obterFolhaCustoPorId_(idFolha, email);
  if (!folha) throw new Error('FOLHA_NAO_ENCONTRADA');

  const metaAtual = extrairMetaAgendaFolha_(folha);
  const statusAtual = String((metaAtual.statusAprovacao || folha.statusAprovacao || '')).trim().toUpperCase();
  const jaSincronizado = (metaAtual.agendaSincronizado === true) ||
    folha.agendaSincronizado === true ||
    String(metaAtual.agendaSincronizado || '').trim().toLowerCase() === 'true' ||
    String(folha.agendaSincronizado || '').trim().toLowerCase() === 'true';
  if (statusAtual === 'APROVADO' && jaSincronizado) {
    return {
      sucesso: true,
      idFolha: idFolha,
      idEvento: String((metaAtual.idEvento || folha.idEvento || folha.idEventoAgenda) || '').trim(),
      valorTotal: Number((extrairTotaisFolha_(folha).geral || 0).toFixed(2)),
      idMovimentacao: String(folha.agendaMovimentacao || '').trim(),
      folhasSubstituidas: Number(folha.agendaFolhasSubstituidas || 0),
      reprocessado: false
    };
  }

  const idEvento = String((metaAtual.idEvento || folha.idEvento || folha.idEventoAgenda) || '').trim();
  if (!idEvento) throw new Error('FOLHA_SEM_ID_EVENTO');

  const totais = extrairTotaisFolha_(folha);
  const valorTotal = Number(totais.geral || 0);
  if (!(valorTotal > 0)) throw new Error('FOLHA_VALOR_INVALIDO');

  const resumoCompacto = compactarResumoFolhaCusto_(folha);
  const referencia = 'FOLHA_PROP:' + idFolha;
  const aplicacaoExistente = buscarFolhaAplicadaNoFinanceiroPorReferencia_(idEvento, idFolha);
  if (aplicacaoExistente && aplicacaoExistente.processada) {
    folha.idEvento = idEvento;
    folha.idEventoAgenda = idEvento;
    folha.statusAprovacao = 'APROVADO';
    folha.aprovadoPor = String(email || '').trim();
    folha.aprovadoEm = new Date().toISOString();
    folha.agendaSincronizado = true;
    folha.agendaReferencia = referencia;
    folha.agendaMovimentacao = String(aplicacaoExistente.idMovimentacao || '').trim();
    folha.agendaFolhasSubstituidas = Number(folha.agendaFolhasSubstituidas || 0);
    folha.resumoCompacto = resumoCompacto;
    folha.ultimaAtualizacao = new Date().toISOString();
    aplicarMetaAgendaFolha_(folha, {
      idEvento: idEvento,
      statusAprovacao: 'APROVADO',
      agendaSincronizado: true,
      aprovadoPor: String(email || '').trim(),
      aprovadoEm: folha.aprovadoEm,
      agendaReferencia: referencia,
      agendaMovimentacao: folha.agendaMovimentacao,
      agendaFolhasSubstituidas: folha.agendaFolhasSubstituidas
    });

    atualizarStatusAgendaFolhaCustoNoUtilitario_(folha, idFolha, {
      idEvento: idEvento,
      statusAprovacao: 'APROVADO',
      agendaSincronizado: true,
      tipoSolicitacao: String((metaAtual.tipoSolicitacao || folha.tipoSolicitacao || '')).trim().toUpperCase(),
      aprovadoPor: String(email || '').trim(),
      aprovadoEm: folha.aprovadoEm,
      agendaReferencia: referencia,
      agendaMovimentacao: folha.agendaMovimentacao,
      agendaFolhasSubstituidas: folha.agendaFolhasSubstituidas
    }, email);
    limparCacheFolhaCustoAprovacao_(idEvento);

    return {
      sucesso: true,
      idFolha: idFolha,
      idEvento: idEvento,
      valorTotal: Number(valorTotal.toFixed(2)),
      idMovimentacao: folha.agendaMovimentacao,
      folhasSubstituidas: folha.agendaFolhasSubstituidas,
      reprocessado: false,
      jaAplicada: true
    };
  }

  const resultadoAgenda = aprovarFolhaEventoComRevisao({
    idEvento: idEvento,
    valor: valorTotal,
    descricao: resumoCompacto,
    referencia: referencia
  });

  folha.idEvento = idEvento;
  folha.idEventoAgenda = idEvento;
  folha.statusAprovacao = 'APROVADO';
  folha.aprovadoPor = String(email || '').trim();
  folha.aprovadoEm = new Date().toISOString();
  folha.agendaSincronizado = true;
  folha.agendaReferencia = referencia;
  folha.agendaMovimentacao = String((resultadoAgenda && resultadoAgenda.idMovimentacao) || '').trim();
  folha.agendaFolhasSubstituidas = Number((resultadoAgenda && resultadoAgenda.folhasSubstituidas) || 0);
  folha.resumoCompacto = resumoCompacto;
  folha.ultimaAtualizacao = new Date().toISOString();
  aplicarMetaAgendaFolha_(folha, {
    idEvento: idEvento,
    statusAprovacao: 'APROVADO',
    agendaSincronizado: true,
    aprovadoPor: String(email || '').trim(),
    aprovadoEm: folha.aprovadoEm,
    agendaReferencia: referencia,
    agendaMovimentacao: folha.agendaMovimentacao,
    agendaFolhasSubstituidas: folha.agendaFolhasSubstituidas
  });

  atualizarStatusAgendaFolhaCustoNoUtilitario_(folha, idFolha, {
    idEvento: idEvento,
    statusAprovacao: 'APROVADO',
    agendaSincronizado: true,
    tipoSolicitacao: String((metaAtual.tipoSolicitacao || folha.tipoSolicitacao || '')).trim().toUpperCase(),
    aprovadoPor: String(email || '').trim(),
    aprovadoEm: folha.aprovadoEm,
    agendaReferencia: referencia,
    agendaMovimentacao: folha.agendaMovimentacao,
    agendaFolhasSubstituidas: folha.agendaFolhasSubstituidas
  }, email);
  limparCacheFolhaCustoAprovacao_(idEvento);

  return {
    sucesso: true,
    idFolha: idFolha,
    idEvento: idEvento,
    valorTotal: Number(valorTotal.toFixed(2)),
    idMovimentacao: folha.agendaMovimentacao,
    folhasSubstituidas: folha.agendaFolhasSubstituidas
  };
}

function limparCacheFolhaCustoAprovacao_(idEvento) {
  try {
    const cache = cacheFolhaCustos_();
    if (cache) {
      cache.remove(cacheKeyPendenciasFolhaCusto_());
      cache.remove(cacheKeyEventoFolhaProcessada_(idEvento));
    }
  } catch (_) {}
}

function atualizarStatusAgendaFolhaCustoNoUtilitario_(folha, idFolha, dadosAgenda, email) {
  const id = String(idFolha || (folha && folha.id) || '').trim();
  if (!id) throw new Error('FOLHA_ID_OBRIGATORIO');

  try {
    const resp = folhaCustosProxy({
      externalAction: 'atualizarStatusAgendaFolhaCusto',
      payload: {
        id: id,
        agenda: dadosAgenda || {}
      }
    }, email);
    const data = resp && resp.data;
    if (data && data.success === false) {
      throw new Error(data.message || 'Falha ao atualizar status agenda da folha');
    }
    return data || { success: true };
  } catch (err) {
    Logger.log('Atualização direta do status da folha falhou; tentando fallback salvarFolhaCusto: ' + err.message);
    folhaCustosProxy({
      externalAction: 'salvarFolhaCusto',
      payload: { data: folha }
    }, email);
    return { success: true, fallback: true };
  }
}

function folhaJaAplicadaNoFinanceiroPorReferencia_(idEvento, idFolha) {
  const achado = buscarFolhaAplicadaNoFinanceiroPorReferencia_(idEvento, idFolha);
  return !!(achado && achado.processada);
}

function buscarFolhaAplicadaNoFinanceiroPorReferencia_(idEvento, idFolha) {
  const idEvt = String(idEvento || '').trim();
  const id = String(idFolha || '').trim();
  if (!idEvt || !id) return null;
  const ref = 'FOLHA_PROP:' + id;

  try {
    const ss = SpreadsheetApp.getActive();
    const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    if (!shMov) return null;
    const data = shMov.getDataRange().getValues();
    if (!data || data.length < 2) return null;
    const head = data[0].map(function (h) { return String(h || '').trim(); });
    const idxIdMov = head.indexOf('ID_MOVIMENTACAO');
    const idxTipo = head.indexOf('TIPO_MOVIMENTACAO');
    const idxIdEvento = head.indexOf('ID_EVENTO');
    const idxStatus = head.indexOf('STATUS');
    const idxRef = head.indexOf('REFERENCIA');
    const idxObs = head.indexOf('OBSERVACOES');
    if (idxTipo === -1 || idxIdEvento === -1 || idxStatus === -1) return null;

    for (var i = data.length - 1; i >= 1; i--) {
      const row = data[i];
      if (String(row[idxIdEvento] || '').trim() !== idEvt) continue;
      if (String(row[idxTipo] || '').trim() !== 'FOLHA_EVENTO') continue;
      const status = statusFinanceiroNormalizado_(row[idxStatus]);
      if (status !== 'PROCESSADO') continue;
      const refMov = idxRef !== -1 ? String(row[idxRef] || '').trim() : '';
      const obsMov = idxObs !== -1 ? String(row[idxObs] || '') : '';
      if (refMov === ref || obsMov.indexOf(ref) !== -1) {
        return {
          processada: true,
          idMovimentacao: idxIdMov !== -1 ? String(row[idxIdMov] || '').trim() : '',
          linha: i + 1
        };
      }
    }
  } catch (e) {
    Logger.log('Falha ao verificar referência de folha aplicada: ' + e.message);
  }
  return null;
}

function obterFolhaCustoPorId_(idFolha, email) {
  const id = String(idFolha || '').trim();
  if (!id) return null;

  try {
    const direto = folhaCustosProxy({
      externalAction: 'getFolhaCusto',
      payload: { id: id }
    }, email);
    const data = direto && direto.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (String(data.id || '').trim() === id) return data;
      if (data.folha && String(data.folha.id || '').trim() === id) return data.folha;
    }
  } catch (_) {}

  const listaResp = folhaCustosProxy({
    externalAction: 'getFolhasCusto',
    payload: {}
  }, email);
  const lista = normalizarListaFolhasCusto_(listaResp && listaResp.data);
  for (var i = 0; i < lista.length; i++) {
    if (String(lista[i].id || '').trim() === id) return lista[i];
  }
  return null;
}

function normalizarListaFolhasCusto_(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.folhas)) return data.folhas;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function compactarResumoFolhaCusto_(folha) {
  const f = folha || {};
  const totais = extrairTotaisFolha_(f);
  const tm = Number(totais.musicos || 0);
  const ta = Number(totais.adicionais || 0);
  const tt = Number(totais.terceirizados || 0);
  const tg = Number(totais.geral || 0);
  const partes = [
    'Musicos: ' + tm.toFixed(2),
    'Adicionais: ' + ta.toFixed(2),
    'Terceiros: ' + tt.toFixed(2),
    'Total: ' + tg.toFixed(2)
  ];
  const resumoLivre = String(f.resumoCompacto || '').trim();
  if (resumoLivre) partes.push('Obs: ' + resumoLivre);
  return partes.join(' | ').slice(0, 480);
}

function extrairTotaisFolha_(folha) {
  const f = folha || {};
  const t = (f.totais && typeof f.totais === 'object') ? f.totais : {};
  const musicos = Number(t.musicos || f.totalMusicos || 0) || 0;
  const adicionais = Number(t.adicionais || f.totalAdicionais || 0) || 0;
  const terceirizados = Number(t.terceirizados || f.totalTerceirizados || 0) || 0;
  let geral = Number(t.geral || f.valorTotal || f.custoTotal || 0) || 0;
  if (!(geral > 0)) {
    geral = Number((musicos + adicionais + terceirizados).toFixed(2));
  }
  return {
    musicos: musicos,
    adicionais: adicionais,
    terceirizados: terceirizados,
    geral: geral
  };
}

function formatarDataPendenciaFolha_(valor) {
  const raw = String(valor || '').trim();
  if (!raw) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;

  let d = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const p = raw.split('-');
    d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  } else {
    d = new Date(raw);
  }
  if (!d || isNaN(d.getTime())) return raw;
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy');
}

function eventoTemFolhaProcessadaNoFinanceiro_(idEvento) {
  const id = String(idEvento || '').trim();
  if (!id) return false;
  try {
    const cache = cacheFolhaCustos_();
    if (cache) {
      const cached = cache.get(cacheKeyEventoFolhaProcessada_(id));
      if (cached === '1') return true;
      if (cached === '0') return false;
    }
  } catch (_) {}
  try {
    const resumo = buscarResumoFinanceiroEvento(id);
    const valor = Number((resumo && resumo.folhaCustoValor) || 0) || 0;
    const pendente = !!(resumo && resumo.folhaPendente);
    const processada = valor > 0 && !pendente;
    try {
      const cache = cacheFolhaCustos_();
      if (cache) cache.put(cacheKeyEventoFolhaProcessada_(id), processada ? '1' : '0', 120);
    } catch (_) {}
    return processada;
  } catch (e) {
    Logger.log('Falha ao verificar folha no financeiro para ' + id + ': ' + e.message);
    return false;
  }
}

function sincronizarFolhaPendenteComoAprovada_(folha, idEvento, email) {
  if (!folha || typeof folha !== 'object') return;
  const idEvt = String(idEvento || '').trim();
  if (!idEvt) return;

  folha.idEvento = idEvt;
  folha.idEventoAgenda = idEvt;
  folha.statusAprovacao = 'APROVADO';
  folha.agendaSincronizado = true;
  folha.aprovadoPor = String(email || '').trim();
  folha.aprovadoEm = new Date().toISOString();
  folha.ultimaAtualizacao = new Date().toISOString();
  aplicarMetaAgendaFolha_(folha, {
    idEvento: idEvt,
    statusAprovacao: 'APROVADO',
    agendaSincronizado: true,
    aprovadoPor: folha.aprovadoPor,
    aprovadoEm: folha.aprovadoEm
  });

  atualizarStatusAgendaFolhaCustoNoUtilitario_(folha, folha.id, {
    idEvento: idEvt,
    statusAprovacao: 'APROVADO',
    agendaSincronizado: true,
    tipoSolicitacao: String((extrairMetaAgendaFolha_(folha).tipoSolicitacao || folha.tipoSolicitacao || '')).trim().toUpperCase(),
    aprovadoPor: folha.aprovadoPor,
    aprovadoEm: folha.aprovadoEm
  }, email);
}

function extrairMetaAgendaFolha_(folha) {
  const f = folha || {};
  const candidatos = [
    f.Folhas_Custo,
    f.folhas_custo,
    f.folhasCusto,
    f.folhaMeta,
    f.metaAgenda
  ];

  for (var i = 0; i < candidatos.length; i++) {
    var raw = candidatos[i];
    if (!raw) continue;
    var obj = raw;
    if (typeof raw === 'string') {
      try { obj = JSON.parse(raw); } catch (_) { obj = null; }
    }
    if (!obj || typeof obj !== 'object') continue;
    var agenda = obj.agenda && typeof obj.agenda === 'object' ? obj.agenda : obj;
    return {
      idEvento: String((agenda.idEvento || agenda.idEventoAgenda || '')).trim(),
      statusAprovacao: String((agenda.statusAprovacao || '')).trim(),
      agendaSincronizado: agenda.agendaSincronizado,
      agendaMovimentacao: String((agenda.agendaMovimentacao || '')).trim(),
      agendaFolhasSubstituidas: Number(agenda.agendaFolhasSubstituidas || 0),
      tipoSolicitacao: String((agenda.tipoSolicitacao || '')).trim()
    };
  }

  return {
    idEvento: '',
    statusAprovacao: '',
    agendaSincronizado: false,
    agendaMovimentacao: '',
    agendaFolhasSubstituidas: 0,
    tipoSolicitacao: ''
  };
}

function aplicarMetaAgendaFolha_(folha, dadosAgenda) {
  const f = folha || {};
  const metaExistente = extrairMetaAgendaFolha_(f);
  const mergedAgenda = Object.assign({}, metaExistente, dadosAgenda || {});
  let base = {};
  if (f.Folhas_Custo && typeof f.Folhas_Custo === 'object') {
    base = Object.assign({}, f.Folhas_Custo);
  } else if (typeof f.Folhas_Custo === 'string') {
    try { base = JSON.parse(f.Folhas_Custo) || {}; } catch (_) { base = {}; }
  }
  base.agenda = Object.assign({}, base.agenda || {}, mergedAgenda);
  f.Folhas_Custo = base;
}
