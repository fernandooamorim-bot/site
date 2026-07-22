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
    'getFolhasCusto',
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
  const ttlSegundos = 45;

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
        criadoEm: String((f && f.criadoEm) || '').trim()
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
  salvarCachePendenciasFolhaCusto_(payload, pendentes.length ? ttlSegundos : 10);
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
    textosReferenciaPorEvento: Object.create(null)
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
    }
  } catch (e) {
    Logger.log('Falha ao construir índice financeiro de folhas: ' + e.message);
  }

  return indice;
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
