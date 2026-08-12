/**
 * ======================================================
 * VÍNCULO OPCIONAL — PROPOSTA ↔ EVENTO
 * ======================================================
 * Recurso fail-open controlado por PROPOSTA_EVENTO_VINCULO_ATIVO.
 * Consultas nunca participam do caminho crítico de criação/edição.
 */

function propostaEventoVinculoAtivo_() {
  const cfg = getConfig ? (getConfig() || {}) : {};
  const valor = cfg.PROPOSTA_EVENTO_VINCULO_ATIVO;
  if (valor === true || valor === 1) return true;
  return ['true', '1', 'sim', 'yes', 'on'].indexOf(String(valor || '').trim().toLowerCase()) !== -1;
}

function obterStatusVinculoPropostaEvento_() {
  const ativo = propostaEventoVinculoAtivo_();
  if (ativo) garantirEstruturaVinculoPropostaEvento_();
  return {
    ativo: ativo,
    chave: 'PROPOSTA_EVENTO_VINCULO_ATIVO'
  };
}

function consultarPropostasCompativeisEvento_(params, email) {
  if (!propostaEventoVinculoAtivo_()) {
    return { sucesso: true, ativo: false, correspondencias: [] };
  }
  garantirEstruturaVinculoPropostaEvento_();

  const usuario = requireUserByEmail(email);
  const criterios = {
    nome: String(params && params.nome || '').trim(),
    telefone: String(params && params.telefone || '').trim(),
    dataEvento: String(params && params.dataEvento || '').trim(),
    local: String(params && params.local || '').trim(),
    buscaManual: String(params && params.buscaManual || '').trim().slice(0, 120)
  };
  if (!criterios.telefone && params && params.idContratante) {
    criterios.telefone = obterTelefoneContratanteVinculo_(params.idContratante);
  }

  // Sem data e sem identidade mínima, não há consulta útil.
  if (!criterios.buscaManual && !criterios.dataEvento && !criterios.nome && !criterios.telefone) {
    return { sucesso: true, ativo: true, correspondencias: [] };
  }

  const resposta = executarAcaoOrcamento_('listarCandidatosVinculo', {
    buscaManual: criterios.buscaManual
  }, usuario);
  const candidatos = Array.isArray(resposta.candidatos) ? resposta.candidatos : [];
  if (criterios.buscaManual) {
    return {
      sucesso: true,
      ativo: true,
      correspondencias: candidatos.map(function (item) {
        return Object.assign({}, item, {
          pontuacao: 100,
          confianca: 'busca_manual',
          motivos: ['busca manual'],
          alertas: []
        });
      })
    };
  }

  const alvo = {
    nome: normalizarTextoVinculo_(criterios.nome),
    telefone: normalizarTelefoneVinculo_(criterios.telefone),
    data: normalizarDataVinculo_(criterios.dataEvento),
    local: normalizarTextoVinculo_(criterios.local)
  };
  const correspondencias = candidatos.map(function (item) {
    const score = pontuarCorrespondenciaVinculo_(alvo, item);
    return Object.assign({}, item, {
      pontuacao: score.pontos,
      confianca: score.confianca,
      motivos: score.motivos,
      alertas: score.alertas
    });
  }).filter(function (item) {
    return item.pontuacao >= 45;
  }).sort(function (a, b) {
    return b.pontuacao - a.pontuacao;
  }).slice(0, 5);

  return {
    sucesso: true,
    ativo: true,
    correspondencias: correspondencias
  };
}

function vincularPropostaAoEvento_(params, email) {
  if (!propostaEventoVinculoAtivo_()) throw new Error('VINCULO_PROPOSTA_DESATIVADO');
  const numero = String(params && params.numeroOrcamento || '').trim();
  const eventoId = String(params && params.eventoId || '').trim();
  if (!numero || !eventoId) throw new Error('VINCULO_DADOS_OBRIGATORIOS');

  const usuario = requireUserByEmail(email);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('VINCULO_EM_PROCESSAMENTO_TENTE_NOVAMENTE');
  let lockLiberado = false;

  try {
    const estrutura = garantirEstruturaVinculoPropostaEvento_();
    const sheet = estrutura.sheet;
    const dados = sheet.getDataRange().getValues();
    let linhaIndex = -1;
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL.ID_EVENTO] || '').trim() === eventoId) {
        linhaIndex = i;
        break;
      }
    }
    if (linhaIndex < 0) throw new Error('EVENTO_NAO_ENCONTRADO');

    const linhaEvento = dados[linhaIndex];
    if (String(linhaEvento[COL.TIPO_REGISTRO] || '').trim() !== 'Evento') {
      throw new Error('VINCULO_PERMITIDO_APENAS_PARA_EVENTO');
    }
    if (String(linhaEvento[COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase() !== 'ATIVO') {
      throw new Error('EVENTO_NAO_ESTA_ATIVO');
    }

    const atual = String(linhaEvento[COL.NUM_ORCAMENTO_ORIGEM] || '').trim();
    if (atual && atual !== numero) throw new Error('EVENTO_JA_POSSUI_OUTRA_PROPOSTA');

    for (var j = 1; j < dados.length; j++) {
      if (j === linhaIndex) continue;
      if (
        String(dados[j][COL.NUM_ORCAMENTO_ORIGEM] || '').trim() === numero &&
        String(dados[j][COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase() === 'ATIVO'
      ) {
        throw new Error('PROPOSTA_JA_VINCULADA_A_OUTRO_EVENTO');
      }
    }

    const rowNumber = linhaIndex + 1;
    const jaVinculadaLocalmente = atual === numero;
    if (!jaVinculadaLocalmente) {
      sheet.getRange(rowNumber, COLUNA.NUM_ORCAMENTO_ORIGEM).setValue(numero);
      SpreadsheetApp.flush();
    }
    lock.releaseLock();
    lockLiberado = true;

    let confirmacaoPendente = false;
    try {
      executarAcaoOrcamento_('vincularOrcamentoEvento', {
        numeroOrcamento: numero,
        eventoId: eventoId
      }, usuario);
    } catch (erroExterno) {
      const estadoAposFalha = consultarEstadoOrcamentoSeguro_(numero, usuario);
      if (estadoAposFalha && String(estadoAposFalha.eventoVinculadoId || '').trim() === eventoId) {
        // A gravação externa terminou e apenas a resposta se perdeu.
      } else if (estadoAposFalha) {
        if (!jaVinculadaLocalmente) {
          atualizarVinculoLocalCondicional_(eventoId, numero, '');
        }
        throw erroExterno;
      } else {
        // Estado externo desconhecido: mantém o vínculo local, que é a fonte oficial,
        // e sinaliza revisão sem arriscar um rollback incorreto.
        confirmacaoPendente = true;
      }
    }
    if (!confirmacaoPendente) {
      const estadoConfirmado = consultarEstadoOrcamentoSeguro_(numero, usuario);
      if (
        !estadoConfirmado ||
        String(estadoConfirmado.eventoVinculadoId || '').trim() !== eventoId ||
        String(estadoConfirmado.statusComercial || '').trim().toUpperCase() !== 'FECHADA'
      ) {
        confirmacaoPendente = true;
      }
    }

    sheet.getRange(rowNumber, COLUNA.ULTIMA_EDICAO).setValue(new Date());
    sheet.getRange(rowNumber, COLUNA.EDITADO_POR).setValue(String(usuario.EMAIL || usuario.email || email || 'SYSTEM'));
    registrarLog('VINCULAR_PROPOSTA', 'EVENTOS', eventoId, JSON.stringify({
      numeroOrcamento: numero,
      executor: String(usuario.EMAIL || usuario.email || email || '')
    }));
    return {
      sucesso: true,
      eventoId: eventoId,
      numeroOrcamento: numero,
      statusComercial: confirmacaoPendente ? 'REVISAR' : 'FECHADA',
      confirmacaoPendente: confirmacaoPendente,
      jaVinculada: jaVinculadaLocalmente
    };
  } finally {
    if (!lockLiberado) lock.releaseLock();
  }
}

function desvincularPropostaDoEvento_(params, email) {
  if (!propostaEventoVinculoAtivo_()) throw new Error('VINCULO_PROPOSTA_DESATIVADO');
  const eventoId = String(params && params.eventoId || '').trim();
  if (!eventoId) throw new Error('EVENTO_ID_OBRIGATORIO');

  const usuario = requireUserByEmail(email);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('VINCULO_EM_PROCESSAMENTO_TENTE_NOVAMENTE');
  let lockLiberado = false;

  try {
    const estrutura = garantirEstruturaVinculoPropostaEvento_();
    const sheet = estrutura.sheet;
    const dados = sheet.getDataRange().getValues();
    let linhaIndex = -1;
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL.ID_EVENTO] || '').trim() === eventoId) {
        linhaIndex = i;
        break;
      }
    }
    if (linhaIndex < 0) throw new Error('EVENTO_NAO_ENCONTRADO');

    const numero = String(dados[linhaIndex][COL.NUM_ORCAMENTO_ORIGEM] || '').trim();
    if (!numero) return { sucesso: true, jaDesvinculada: true, eventoId: eventoId };

    const rowNumber = linhaIndex + 1;
    sheet.getRange(rowNumber, COLUNA.NUM_ORCAMENTO_ORIGEM).clearContent();
    SpreadsheetApp.flush();
    lock.releaseLock();
    lockLiberado = true;
    try {
      executarAcaoOrcamento_('desvincularOrcamentoEvento', {
        numeroOrcamento: numero,
        eventoId: eventoId
      }, usuario);
    } catch (erroExterno) {
      const estadoAposFalha = consultarEstadoOrcamentoSeguro_(numero, usuario);
      const desvinculadaExternamente = estadoAposFalha &&
        !String(estadoAposFalha.eventoVinculadoId || '').trim() &&
        String(estadoAposFalha.statusComercial || 'ABERTA').trim().toUpperCase() === 'ABERTA';
      if (!desvinculadaExternamente) {
        atualizarVinculoLocalCondicional_(eventoId, '', numero);
        throw erroExterno;
      }
    }

    sheet.getRange(rowNumber, COLUNA.ULTIMA_EDICAO).setValue(new Date());
    sheet.getRange(rowNumber, COLUNA.EDITADO_POR).setValue(String(usuario.EMAIL || usuario.email || email || 'SYSTEM'));
    registrarLog('DESVINCULAR_PROPOSTA', 'EVENTOS', eventoId, JSON.stringify({
      numeroOrcamento: numero,
      executor: String(usuario.EMAIL || usuario.email || email || '')
    }));
    return { sucesso: true, eventoId: eventoId, numeroOrcamento: numero, statusComercial: 'ABERTA' };
  } finally {
    if (!lockLiberado) lock.releaseLock();
  }
}

function atualizarVinculoLocalCondicional_(eventoId, valorEsperado, novoValor) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('VINCULO_ROLLBACK_PENDENTE_REVISAO');
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName('EVENTOS');
    if (!sheet) throw new Error('PLANILHA_EVENTOS_NAO_ENCONTRADA');
    const dados = sheet.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL.ID_EVENTO] || '').trim() !== String(eventoId || '').trim()) continue;
      const atual = String(dados[i][COL.NUM_ORCAMENTO_ORIGEM] || '').trim();
      if (atual !== String(valorEsperado || '').trim()) throw new Error('VINCULO_ALTERADO_DURANTE_OPERACAO');
      const range = sheet.getRange(i + 1, COLUNA.NUM_ORCAMENTO_ORIGEM);
      if (novoValor) range.setValue(String(novoValor));
      else range.clearContent();
      SpreadsheetApp.flush();
      return true;
    }
    throw new Error('EVENTO_NAO_ENCONTRADO');
  } finally {
    lock.releaseLock();
  }
}

function buscarEventosCompativeisParaProposta_(params, email) {
  if (!propostaEventoVinculoAtivo_()) {
    return { sucesso: true, ativo: false, eventos: [] };
  }
  garantirEstruturaVinculoPropostaEvento_();
  const usuario = requireUserByEmail(email);
  const numero = String(params && params.numeroOrcamento || '').trim();
  if (!numero) throw new Error('NUM_ORCAMENTO_OBRIGATORIO');

  const externa = executarAcaoOrcamento_('obterOrcamentoPorNumero', {
    numeroOrcamento: numero
  }, usuario);
  const proposta = externa && externa.orcamento;
  if (!proposta) throw new Error('ORCAMENTO_NAO_ENCONTRADO');

  if (String(proposta.eventoVinculadoId || '').trim()) {
    return {
      sucesso: true,
      ativo: true,
      proposta: proposta,
      eventos: [],
      eventoVinculadoId: String(proposta.eventoVinculadoId)
    };
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName('EVENTOS');
  const dados = sheet ? sheet.getDataRange().getValues() : [];
  const telefonesContratantes = obterMapaTelefonesContratantesVinculo_();
  const alvo = {
    nome: normalizarTextoVinculo_(proposta.nome),
    telefone: normalizarTelefoneVinculo_(proposta.telefone),
    data: normalizarDataVinculo_(proposta.dataEvento),
    local: normalizarTextoVinculo_(proposta.local)
  };
  const candidatos = [];
  for (var i = 1; i < dados.length; i++) {
    const l = dados[i];
    if (String(l[COL.TIPO_REGISTRO] || '').trim() !== 'Evento') continue;
    if (String(l[COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase() !== 'ATIVO') continue;
    if (String(l[COL.NUM_ORCAMENTO_ORIGEM] || '').trim()) continue;

    const telefoneEvento = telefonesContratantes[String(l[COL.ID_CONTRATANTE] || '').trim()] || '';
    const item = {
      id: String(l[COL.ID_EVENTO] || ''),
      nome: String(l[COL.NOME_CONTRATANTE] || ''),
      dataEvento: formatarDataISO(l[COL.DATA_EVENTO]),
      local: String(l[COL.LOCAL] || ''),
      telefone: telefoneEvento
    };
    const score = pontuarCorrespondenciaVinculo_(alvo, item);
    if (score.pontos < 45) continue;
    item.pontuacao = score.pontos;
    item.confianca = score.confianca;
    item.motivos = score.motivos;
    candidatos.push(item);
  }
  candidatos.sort(function (a, b) { return b.pontuacao - a.pontuacao; });
  return {
    sucesso: true,
    ativo: true,
    proposta: proposta,
    eventos: candidatos.slice(0, 5)
  };
}

function consultarEstadoOrcamentoSeguro_(numeroOrcamento, usuario) {
  try {
    const resposta = executarAcaoOrcamento_('obterOrcamentoPorNumero', {
      numeroOrcamento: numeroOrcamento
    }, usuario);
    return resposta && resposta.orcamento ? resposta.orcamento : null;
  } catch (_) {
    return null;
  }
}

function sincronizarCancelamentoPropostaEvento_(eventoId, email) {
  if (!propostaEventoVinculoAtivo_()) return { sucesso: true, ignorado: true };
  const id = String(eventoId || '').trim();
  if (!id) return { sucesso: true, ignorado: true };
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName('EVENTOS');
    if (!sheet) return { sucesso: false, mensagem: 'PLANILHA_EVENTOS_NAO_ENCONTRADA' };
    const dados = sheet.getDataRange().getValues();
    let numero = '';
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL.ID_EVENTO] || '').trim() === id) {
        numero = String(dados[i][COL.NUM_ORCAMENTO_ORIGEM] || '').trim();
        break;
      }
    }
    if (!numero) return { sucesso: true, ignorado: true };
    const usuario = requireUserByEmail(email);
    executarAcaoOrcamento_('marcarOrcamentoEventoCancelado', {
      numeroOrcamento: numero,
      eventoId: id
    }, usuario);
    return { sucesso: true, numeroOrcamento: numero, statusComercial: 'EVENTO_CANCELADO' };
  } catch (erro) {
    Logger.log('[VINCULO_CANCELAMENTO_PENDENTE] evento=' + id + ' erro=' + String(erro));
    return { sucesso: false, pendente: true, mensagem: String(erro && erro.message || erro) };
  }
}

function reconciliarVinculosPropostasEventos_(email) {
  if (!propostaEventoVinculoAtivo_()) {
    return { sucesso: true, ativo: false, resumo: {}, inconsistencias: [] };
  }
  const usuario = requireUserByEmail(email);
  const externa = executarAcaoOrcamento_('listarVinculosOrcamentos', {}, usuario);
  const propostas = Array.isArray(externa.vinculos) ? externa.vinculos : [];
  const sheet = SpreadsheetApp.getActive().getSheetByName('EVENTOS');
  const dados = sheet ? sheet.getDataRange().getValues() : [];
  const eventosPorId = {};
  const eventosPorProposta = {};
  for (var i = 1; i < dados.length; i++) {
    const id = String(dados[i][COL.ID_EVENTO] || '').trim();
    if (!id) continue;
    const numero = String(dados[i][COL.NUM_ORCAMENTO_ORIGEM] || '').trim();
    const status = String(dados[i][COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase();
    eventosPorId[id] = { id: id, numeroOrcamento: numero, statusGeral: status };
    if (numero) {
      if (!eventosPorProposta[numero]) eventosPorProposta[numero] = [];
      eventosPorProposta[numero].push(eventosPorId[id]);
    }
  }

  const propostasPorNumero = {};
  propostas.forEach(function (p) { propostasPorNumero[String(p.numeroOrcamento || '').trim()] = p; });
  const inconsistencias = [];
  propostas.forEach(function (p) {
    const numero = String(p.numeroOrcamento || '').trim();
    const status = String(p.statusComercial || 'ABERTA').trim().toUpperCase();
    const eventoId = String(p.eventoVinculadoId || '').trim();
    const referencias = eventosPorProposta[numero] || [];
    const ativos = referencias.filter(function (e) { return e.statusGeral === 'ATIVO'; });
    if (ativos.length > 1) {
      inconsistencias.push({ tipo: 'PROPOSTA_EM_MULTIPLOS_EVENTOS_ATIVOS', numeroOrcamento: numero, eventos: ativos.map(function (e) { return e.id; }) });
    }
    if (eventoId && !eventosPorId[eventoId]) {
      inconsistencias.push({ tipo: 'EVENTO_VINCULADO_INEXISTENTE', numeroOrcamento: numero, eventoId: eventoId });
    } else if (eventoId && eventosPorId[eventoId].numeroOrcamento !== numero) {
      inconsistencias.push({ tipo: 'VINCULO_DIVERGENTE', numeroOrcamento: numero, eventoId: eventoId });
    }
    if (status === 'FECHADA' && !ativos.length) {
      inconsistencias.push({ tipo: 'PROPOSTA_FECHADA_SEM_EVENTO_ATIVO', numeroOrcamento: numero, eventoId: eventoId });
    }
    if (status === 'ABERTA' && ativos.length) {
      inconsistencias.push({ tipo: 'PROPOSTA_ABERTA_COM_EVENTO_ATIVO', numeroOrcamento: numero, eventoId: ativos[0].id });
    }
    if (status === 'REVISAR') {
      inconsistencias.push({ tipo: 'VINCULO_PENDENTE_DE_REVISAO', numeroOrcamento: numero, eventoId: eventoId });
    }
    if (eventoId && (!String(p.vinculadaEm || '').trim() || !String(p.vinculadaPor || '').trim())) {
      inconsistencias.push({ tipo: 'VINCULO_SEM_AUDITORIA_COMPLETA', numeroOrcamento: numero, eventoId: eventoId });
    }
    if (eventoId && eventosPorId[eventoId] && eventosPorId[eventoId].statusGeral === 'CANCELADO' && status !== 'EVENTO_CANCELADO') {
      inconsistencias.push({ tipo: 'EVENTO_CANCELADO_STATUS_DIVERGENTE', numeroOrcamento: numero, eventoId: eventoId, statusComercial: status });
    }
  });
  Object.keys(eventosPorProposta).forEach(function (numero) {
    if (!propostasPorNumero[numero]) {
      inconsistencias.push({ tipo: 'EVENTO_COM_PROPOSTA_INEXISTENTE', numeroOrcamento: numero, eventos: eventosPorProposta[numero].map(function (e) { return e.id; }) });
    }
  });
  return {
    sucesso: true,
    ativo: true,
    resumo: {
      propostasAnalisadas: propostas.length,
      eventosAnalisados: Math.max(0, dados.length - 1),
      vinculosEncontrados: Object.keys(eventosPorProposta).length,
      inconsistencias: inconsistencias.length
    },
    inconsistencias: inconsistencias.slice(0, 100),
    somenteLeitura: true
  };
}

function garantirEstruturaVinculoPropostaEvento_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('EVENTOS');
  if (!sheet) throw new Error('PLANILHA_EVENTOS_NAO_ENCONTRADA');
  if (sheet.getMaxColumns() < COLUNA.NUM_ORCAMENTO_ORIGEM) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      COLUNA.NUM_ORCAMENTO_ORIGEM - sheet.getMaxColumns()
    );
  }
  const headerAtual = String(sheet.getRange(1, COLUNA.NUM_ORCAMENTO_ORIGEM).getValue() || '').trim();
  if (!headerAtual) {
    sheet.getRange(1, COLUNA.NUM_ORCAMENTO_ORIGEM).setValue('NUM_ORCAMENTO_ORIGEM');
  } else if (headerAtual !== 'NUM_ORCAMENTO_ORIGEM') {
    throw new Error('ESTRUTURA_EVENTOS_COLUNA_44_OCUPADA');
  }
  return { sheet: sheet };
}

function executarAcaoOrcamento_(action, payload, usuario) {
  return executarAcaoOrcamentoInterna_(action, payload || {}, usuario || {});
}

function obterTelefoneContratanteVinculo_(idContratante) {
  const id = String(idContratante || '').trim();
  if (!id) return '';
  return obterMapaTelefonesContratantesVinculo_()[id] || '';
}

function obterMapaTelefonesContratantesVinculo_() {
  const mapa = {};
  const sheet = SpreadsheetApp.getActive().getSheetByName('CONTRATANTES');
  if (!sheet || sheet.getLastRow() < 2) return mapa;
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0].map(function (x) { return normalizarTextoVinculo_(x); });
  const idxId = Math.max(0, headers.indexOf('id contratante'));
  let idxTelefone = headers.indexOf('whatsapp');
  if (idxTelefone < 0) idxTelefone = headers.indexOf('telefone');
  if (idxTelefone < 0) idxTelefone = 2;
  for (var i = 1; i < values.length; i++) {
    const id = String(values[i][idxId] || '').trim();
    if (id) mapa[id] = String(values[i][idxTelefone] || '').trim();
  }
  return mapa;
}

function pontuarCorrespondenciaVinculo_(alvo, item) {
  const nome = normalizarTextoVinculo_(item.nome);
  const telefone = normalizarTelefoneVinculo_(item.telefone);
  const data = normalizarDataVinculo_(item.dataEvento);
  const local = normalizarTextoVinculo_(item.local);
  let pontos = 0;
  const motivos = [];
  const alertas = [];
  if (alvo.telefone && telefone && alvo.telefone === telefone) { pontos += 45; motivos.push('telefone'); }
  if (alvo.data && data && alvo.data === data) { pontos += 30; motivos.push('data'); }
  const sn = similaridadeTokensVinculo_(alvo.nome, nome);
  const tokensAlvo = alvo.nome ? alvo.nome.split(/\s+/).filter(Boolean) : [];
  const tokensItem = nome ? nome.split(/\s+/).filter(Boolean) : [];
  if (sn >= 0.88) { pontos += 30; motivos.push('nome'); }
  else if (sn >= 0.62) { pontos += 15; motivos.push('nome parcial'); }
  const sl = similaridadeTokensVinculo_(alvo.local, local);
  if (sl >= 0.78) { pontos += 20; motivos.push('local'); }
  if (motivos.length === 1 && (motivos[0] === 'data' || motivos[0] === 'local')) pontos = 0;
  if (
    alvo.data && data && alvo.data !== data &&
    (
      (alvo.telefone && telefone && alvo.telefone === telefone) ||
      (sn >= 0.88 && Math.min(tokensAlvo.length, tokensItem.length) >= 2)
    )
  ) {
    pontos = Math.max(pontos, 50);
    alertas.push('data diferente');
  }
  return {
    pontos: Math.min(100, pontos),
    confianca: pontos >= 80 ? 'muito_alta' : (pontos >= 60 ? 'alta' : 'possivel'),
    motivos: motivos,
    alertas: alertas
  };
}

function normalizarTextoVinculo_(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(function (t) { return t && ['de', 'da', 'do', 'das', 'dos', 'e'].indexOf(t) === -1; })
    .join(' ')
    .trim();
}

function normalizarTelefoneVinculo_(valor) {
  let d = String(valor || '').replace(/\D/g, '');
  if (d.length > 11 && d.indexOf('55') === 0) d = d.slice(2);
  return d;
}

function normalizarDataVinculo_(valor) {
  const s = String(valor || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  return '';
}

function similaridadeTokensVinculo_(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aa = a.split(/\s+/).filter(Boolean);
  const bb = b.split(/\s+/).filter(Boolean);
  let comuns = 0;
  aa.forEach(function (ta) {
    if (bb.some(function (tb) {
      return ta === tb || (
        ta.length >= 4 && tb.length >= 4 &&
        (
          ta.indexOf(tb) === 0 ||
          tb.indexOf(ta) === 0 ||
          distanciaEdicaoLimitadaVinculo_(ta, tb) <= (Math.max(ta.length, tb.length) >= 7 ? 2 : 1)
        )
      );
    })) comuns++;
  });
  return aa.length && bb.length ? (2 * comuns) / (aa.length + bb.length) : 0;
}

function distanciaEdicaoLimitadaVinculo_(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (Math.abs(x.length - y.length) > 2) return 99;
  const prev = [];
  const curr = [];
  for (var j = 0; j <= y.length; j++) prev[j] = j;
  for (var i = 1; i <= x.length; i++) {
    curr[0] = i;
    for (var k = 1; k <= y.length; k++) {
      curr[k] = Math.min(
        curr[k - 1] + 1,
        prev[k] + 1,
        prev[k - 1] + (x.charAt(i - 1) === y.charAt(k - 1) ? 0 : 1)
      );
    }
    for (var m = 0; m <= y.length; m++) prev[m] = curr[m];
  }
  return prev[y.length];
}
