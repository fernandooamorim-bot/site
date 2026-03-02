

/**
 * =====================================================
 * CÁLCULO DE AJUSTES DE COMISSÃO POR ESTORNO (SEGURANÇA)
 * =====================================================
 * Percorre estornos, localiza comissão já paga, calcula ajuste devido.
 */
/**
 * =====================================================
 * REGRA:
 * Estorno de recebimento SEMPRE impacta comissão.
 * Se comissão não foi paga → desconto ocorre no fechamento atual.
 * Se comissão já foi paga → desconto ocorre no próximo fechamento.
 * Nenhum valor é apagado. Tudo é registrado como novo movimento.
 * =====================================================
 */
function extrairIdRecebimentoDaObservacao(obs) {
  if (!obs || typeof obs !== 'string') return null;
  const texto = obs.replace(/\s+/g, ' ').trim();
  const match = texto.match(/MOV-\d{8}-\d{3}(?![\d-])/);
  return match ? match[0] : null;
}

function executarComLockFinanceiro_(nomeOperacao, fn) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Não foi possível obter lock financeiro para: ' + String(nomeOperacao || 'OPERACAO'));
  }
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function appendRowComVerificacao_(sheet, linha, contexto) {
  const before = sheet.getLastRow();
  sheet.appendRow(linha);
  SpreadsheetApp.flush();

  const after = sheet.getLastRow();
  if (after !== before + 1) {
    throw new Error('Falha de persistência ao inserir linha em ' + String(contexto || sheet.getName()));
  }

  const gravada = sheet.getRange(after, 1, 1, linha.length).getValues()[0];
  if (!valoresEquivalentes_(gravada[0], linha[0])) {
    throw new Error('Falha de verificação do ID gravado em ' + String(contexto || sheet.getName()));
  }

  return after;
}

function setValueComVerificacao_(sheet, row, col, value, contexto) {
  sheet.getRange(row, col).setValue(value);
  SpreadsheetApp.flush();
  const lido = sheet.getRange(row, col).getValue();
  if (!valoresEquivalentes_(lido, value)) {
    throw new Error(
      'Falha de persistência ao atualizar célula em ' +
      String(contexto || sheet.getName()) +
      ' [r=' + row + ', c=' + col + ']'
    );
  }
}

function valoresEquivalentes_(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!isNaN(na) && !isNaN(nb)) {
    return Math.abs(na - nb) < 0.000001;
  }
  return String(a) === String(b);
}

function determinarStatusComissao_(esperado, gerado, pago, pendente) {
  if (esperado === 0) return 'NA';
  if (gerado === 0) return 'AGUARDANDO';
  if (gerado < esperado) return 'PARCIAL';
  if (gerado === esperado && pendente > 0) return 'PENDENTE';
  if (pago === esperado) return 'QUITADO';
  if (pago > esperado || gerado > esperado) return 'ERRO';
  return 'PENDENTE';
}

function calcularAjustesComissaoPorEstorno(idVendedor) {
  const ss = SpreadsheetApp.getActive();
  const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  const movData = shMov.getDataRange().getValues();
  const movHead = movData[0];
  const m = c => movHead.indexOf(c);
  if (m('ID_CONTRAPARTE') === -1) {
    throw new Error('Coluna ID_CONTRAPARTE não encontrada na aba MOVIMENTACOES_FINANCEIRAS');
  }
  const ajustes = [];
  // Para blindagem de duplicidade, coletar todos os ajustes já existentes
  const ajustesExistentes = {};
  for (let i = 1; i < movData.length; i++) {
    if (
      movData[i][m('TIPO_MOVIMENTACAO')] === 'AJUSTE_COMISSAO_ESTORNO' &&
      typeof movData[i][m('OBSERVACOES')] === 'string'
    ) {
      const idRec = extrairIdRecebimentoDaObservacao(
        movData[i][m('OBSERVACOES')]
      );
      if (idRec) {
        ajustesExistentes[idRec] = true;
      }
    }
  }
  // BLINDAGEM: se existir AJUSTE_COMISSAO_ESTORNO para o recebimento,
  // o estorno é considerado resolvido e ignorado nos próximos fechamentos.

  for (let i = 1; i < movData.length; i++) {
    const row = movData[i];
    // Só estornos válidos (não cancelados)
    if (
      row[m('TIPO_MOVIMENTACAO')] === 'ESTORNO_RECEBIMENTO' &&
      row[m('STATUS')] !== 'CANCELADO'
    ) {
      // Extrai idRecebimento estornado da OBSERVACOES via regex
      const obs = row[m('OBSERVACOES')] || '';
      const match = obs.match(/MOV-\d{8}-\d{3}(?![\d-])/);
      const idRecebimento = match ? match[0] : null;
      if (!idRecebimento) continue;
      // Blindagem: ajuste já existe para esse recebimento?
      if (ajustesExistentes[idRecebimento]) continue;
      // Busca a comissão gerada vinculada a esse recebimento, para este vendedor
      let comissao = null;
      for (let j = 1; j < movData.length; j++) {
        const r = movData[j];
        if (
          r[m('TIPO_MOVIMENTACAO')] === 'COMISSAO_GERADA' &&
          (r[m('STATUS')] === 'PROCESSADO' || r[m('STATUS')] === 'PENDENTE') &&
          String(r[m('ID_CONTRAPARTE')]) === String(idVendedor) &&
          typeof r[m('OBSERVACOES')] === 'string' &&
          extrairIdRecebimentoDaObservacao(r[m('OBSERVACOES')]) === idRecebimento
        ) {
          comissao = r;
          break;
        }
      }
      // Não gera ajuste se não achou comissão
      if (!comissao) continue;
      // Valor do recebimento original
      let valorRecebimentoOriginal = 0;
      for (let k = 1; k < movData.length; k++) {
        if (
          movData[k][m('TIPO_MOVIMENTACAO')] === 'RECEBIMENTO_CLIENTE' &&
          String(movData[k][m('ID_MOVIMENTACAO')]) === String(idRecebimento)
        ) {
          valorRecebimentoOriginal = Number(movData[k][m('VALOR')]) || 0;
          break;
        }
      }
      if (valorRecebimentoOriginal <= 0) continue;
      // Somatório de estornos vinculados a esse recebimento
      let totalEstornado = 0;
      for (let k = 1; k < movData.length; k++) {
        if (
          movData[k][m('TIPO_MOVIMENTACAO')] === 'ESTORNO_RECEBIMENTO' &&
          movData[k][m('STATUS')] !== 'CANCELADO' &&
          typeof movData[k][m('OBSERVACOES')] === 'string' &&
          extrairIdRecebimentoDaObservacao(movData[k][m('OBSERVACOES')]) === idRecebimento
        ) {
          totalEstornado += Number(movData[k][m('VALOR')]) || 0;
        }
      }
      // Proporção
      let proporcao = 0;
      if (valorRecebimentoOriginal > 0 && totalEstornado > 0) {
        proporcao = totalEstornado / valorRecebimentoOriginal;
        if (proporcao > 1) proporcao = 1;
      }
      // Valor da comissão original
      const valorComissaoOriginal = Number(comissao[m('VALOR')]) || 0;
      // valorAjuste proporcional
      let valorAjuste = Number((valorComissaoOriginal * proporcao).toFixed(2));
      // Garante que nunca ultrapassa o valor da comissão original
      if (valorAjuste > valorComissaoOriginal) valorAjuste = valorComissaoOriginal;
      if (valorAjuste <= 0) continue;
      // Monta ajuste
      ajustes.push({
        idEvento: row[m('ID_EVENTO')],
        nomeEvento: row[m('NOME_EVENTO')],
        valorAjuste: valorAjuste,
        idRecebimento: idRecebimento,
        observacoes: `Ajuste por estorno do recebimento ${idRecebimento}`
      });
    }
  }
  return ajustes;
}
/**
 * ========================================
 * CALCULOS PARA CRIAÇAO E EDIÇAO DE EVENTOS
 * ========================================
 *//**
 * Normaliza datas vindas do Sheets ou frontend
 * Sempre retorna Date ao meio-dia (evita bugs de fuso)
 */


function calcularFinanceiroEvento(dados) {
  const arred = 2;

  const valorTotal = Number(dados.valorTotal) || 0;
  const temNF = dados.temNF === true;
  const valorBV = Number(dados.valorBV) || 0;

  const percentualNF = Number(dados.percentualNF) || 0;
  const percentualComissaoPadrao = Number(dados.comissaoValor) || 0;

  // ───────── NF ─────────
  const valorNF = temNF
    ? Number((valorTotal * percentualNF / 100).toFixed(arred))
    : 0;

  // ───────── BASE DE COMISSÃO ─────────
  let baseComissao = valorTotal;

  if (valorNF > 0) baseComissao -= valorNF;
  if (valorBV > 0) baseComissao -= valorBV;

  if (baseComissao < 0) baseComissao = 0;

  // ───────── COMISSÃO ─────────
  let valorComissaoCalculado = 0;

  switch (dados.comissaoTipo) {
    case 'Padrão':
      valorComissaoCalculado =
        baseComissao * percentualComissaoPadrao / 100;
      break;

    case 'Percentual':
      valorComissaoCalculado =
        baseComissao * (Number(dados.comissaoValor) || 0) / 100;
      break;

    case 'Fixo':
      valorComissaoCalculado = Number(dados.comissaoValor) || 0;
      break;

    case 'Sem Comissão':
    default:
      valorComissaoCalculado = 0;
  }

  valorComissaoCalculado = Number(valorComissaoCalculado.toFixed(arred));

  // ───────── STATUS FINANCEIROS ─────────
  const statusNF = temNF ? 'PROCESSADO' : 'N/A';
  const statusBV = valorBV > 0 ? 'PENDENTE' : 'N/A';
  const statusComissao =
    valorComissaoCalculado > 0 ? 'PENDENTE' : 'N/A';

  return {
    valorNF,
    baseComissao,
    valorComissaoCalculado,
    statusNF,
    statusBV,
    statusComissao
  };
}

/**
 * =====================================================
 * AUDITORIA / RECÁLCULO FINANCEIRO DE EVENTO
 * USO MANUAL — NÃO É TRIGGER
 * =====================================================
 * Recalcula apenas o financeiro estrutural do evento
 * NÃO altera recebimentos, parcelas ou histórico
 */
function recalcularFinanceiroEvento(idEvento) {
  exigirAcao('eventos:editar');
  if (!idEvento) {
    throw new Error('ID do evento é obrigatório');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('EVENTOS');
  if (!sheet) {
    throw new Error('Aba EVENTOS não encontrada');
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getDataRange().getValues();

  const idx = (name) => headers.indexOf(name);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idx('ID_EVENTO')]) !== String(idEvento)) continue;

    const tipoRegistro = data[i][idx('TIPO_REGISTRO')] || 'Evento';
    if (tipoRegistro !== 'Evento') {
      throw new Error('Recálculo permitido apenas para tipo EVENTO');
    }

    // Lê dados estruturais
    const valorTotal = Number(data[i][idx('VALOR_TOTAL')]) || 0;
    const valorBV = Number(data[i][idx('VALOR_BV')]) || 0;
    const temNF = data[i][idx('TEM_NF')] === true || data[i][idx('TEM_NF')] === 'TRUE';
    const comissaoTipo = data[i][idx('COMISSAO_TIPO')] || 'Padrão';
    const comissaoValor = Number(data[i][idx('COMISSAO_VALOR')]) || 0;

    // Recalcula usando motor oficial
    const financeiro = calcularFinanceiroEvento({
      valorTotal,
      temNF,
      valorBV,
      comissaoTipo,
      comissaoValor
    });

    // Atualiza SOMENTE campos estruturais
    if (idx('VALOR_NF') >= 0) {
      sheet.getRange(i + 1, idx('VALOR_NF') + 1).setValue(financeiro.valorNF);
    }

    if (idx('STATUS_NF') >= 0) {
      sheet.getRange(i + 1, idx('STATUS_NF') + 1).setValue(financeiro.statusNF);
    }

    if (idx('VALOR_COMISSAO_CALCULADO') >= 0) {
      sheet.getRange(i + 1, idx('VALOR_COMISSAO_CALCULADO') + 1)
        .setValue(financeiro.valorComissaoCalculado);
    }

    if (idx('STATUS_COMISSAO') >= 0) {
      sheet.getRange(i + 1, idx('STATUS_COMISSAO') + 1)
        .setValue(financeiro.statusComissao);
    }

    if (idx('STATUS_BV') >= 0) {
      sheet.getRange(i + 1, idx('STATUS_BV') + 1)
        .setValue(financeiro.statusBV);
    }

    // Atualiza metadados
    if (idx('ULTIMA_EDICAO') >= 0) {
      sheet.getRange(i + 1, idx('ULTIMA_EDICAO') + 1).setValue(new Date());
    }

    if (idx('EDITADO_POR') >= 0) {
      sheet.getRange(i + 1, idx('EDITADO_POR') + 1)
        .setValue(getUsuarioAtual().email);
    }

    registrarLog(
      'AUDITORIA_FINANCEIRA',
      'EVENTOS',
      idEvento,
      'Recálculo financeiro estrutural executado'
    );

    Logger.log('✅ Financeiro recalculado com sucesso para o evento ' + idEvento);
    return;
  }

  throw new Error('Evento não encontrado: ' + idEvento);
}


/**
 * ========================================
 * GESTÃO FINANCEIRA E COMISSÕES
 * ========================================
 */

/* =====================================================
 * REGISTRO DE SAÍDAS DO EVENTO (NF / BV / FOLHA)
 * BACKEND ULTRA SEGURO — NÃO DUPLICA, NÃO REPROCESSA
 * ===================================================== */

/**
 * Registro de NF do evento (valor vem do EVENTO)
 */
function registrarNFEvento(idEvento, meta) {
  exigirAcao('eventos:registrarSaida');
  return executarComLockFinanceiro_('NF_EVENTO', function () {
    const ss = SpreadsheetApp.getActive();
    const shEvt = ss.getSheetByName('EVENTOS');
    const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    const usuario = getUsuarioAtual().email;
    const linkComprovante = String((meta && meta.linkComprovante) || '').trim();
    const observacoesExtra = String((meta && meta.observacoes) || '').trim();

    const evt = shEvt.getDataRange().getValues();
    const head = evt[0];
    const e = c => head.indexOf(c);

    for (let i = 1; i < evt.length; i++) {
      if (evt[i][e('ID_EVENTO')] !== idEvento) continue;

      if (evt[i][e('STATUS_NF')] === 'PROCESSADO') {
        throw new Error('NF já processada para este evento');
      }

      const valorNF = Number(evt[i][e('VALOR_NF')]) || 0;
      if (valorNF <= 0) throw new Error('Evento não possui NF válida');

      const idMovimentacao = gerarIDMovimentacao();
      const linhaMov = [
        idMovimentacao,
        'NF_EVENTO',
        'SAÍDA',
        idEvento,
        evt[i][e('NOME_EVENTO')],
        normalizarData(new Date()),
        valorNF,
        '',
        'Nota Fiscal',
        '',
        linkComprovante,
        observacoesExtra || 'NF gerada automaticamente pelo sistema',
        usuario,
        new Date(),
        '',
        'PROCESSADO'
      ];

      appendRowComVerificacao_(shMov, linhaMov, 'MOVIMENTACOES_FINANCEIRAS/NF_EVENTO');
      setValueComVerificacao_(shEvt, i + 1, e('STATUS_NF') + 1, 'PROCESSADO', 'EVENTOS/STATUS_NF');
      return { sucesso: true, idMovimentacao: idMovimentacao };
    }

    throw new Error('Evento não encontrado');
  });
}

/**
 * Registro de BV do evento (valor vem do EVENTO)
 */
function registrarBVEvento(idEvento, meta) {
  exigirAcao('eventos:registrarSaida');
  return executarComLockFinanceiro_('BV_EVENTO', function () {
    const ss = SpreadsheetApp.getActive();
    const shEvt = ss.getSheetByName('EVENTOS');
    const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    const usuario = getUsuarioAtual().email;
    const linkComprovante = String((meta && meta.linkComprovante) || '').trim();
    const observacoesExtra = String((meta && meta.observacoes) || '').trim();

    const evt = shEvt.getDataRange().getValues();
    const head = evt[0];
    const e = c => head.indexOf(c);

    for (let i = 1; i < evt.length; i++) {
      if (evt[i][e('ID_EVENTO')] !== idEvento) continue;

      if (evt[i][e('STATUS_BV')] === 'PROCESSADO') {
        throw new Error('BV já processado para este evento');
      }

      const valorBV = Number(evt[i][e('VALOR_BV')]) || 0;
      if (valorBV <= 0) throw new Error('Evento não possui BV válido');

      const idMovimentacao = gerarIDMovimentacao();
      const linhaMov = [
        idMovimentacao,
        'BV_EVENTO',
        'SAÍDA',
        idEvento,
        evt[i][e('NOME_EVENTO')],
        normalizarData(new Date()),
        valorBV,
        '',
        'BV',
        '',
        linkComprovante,
        observacoesExtra || 'BV registrada automaticamente pelo sistema',
        usuario,
        new Date(),
        '',
        'PROCESSADO'
      ];

      appendRowComVerificacao_(shMov, linhaMov, 'MOVIMENTACOES_FINANCEIRAS/BV_EVENTO');
      setValueComVerificacao_(shEvt, i + 1, e('STATUS_BV') + 1, 'PROCESSADO', 'EVENTOS/STATUS_BV');
      return { sucesso: true, idMovimentacao: idMovimentacao };
    }

    throw new Error('Evento não encontrado');
  });
}

/**
 * Registro de folha de custo do evento
 * Pode ocorrer múltiplas vezes
 */
function registrarFolhaEvento(idEvento, valor, descricao) {
  exigirAcao('eventos:registrarSaida');
  if (!valor || valor <= 0) throw new Error('Valor inválido para folha');

  return executarComLockFinanceiro_('FOLHA_EVENTO', function () {
    const ss = SpreadsheetApp.getActive();
    const shEvt = ss.getSheetByName('EVENTOS');
    const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    const usuario = getUsuarioAtual().email;

    const evt = shEvt.getDataRange().getValues();
    const head = evt[0];
    const e = c => head.indexOf(c);

    for (let i = 1; i < evt.length; i++) {
      if (evt[i][e('ID_EVENTO')] !== idEvento) continue;

      // Monta nome padrão do evento: TIPO_EVENTO + ' ' + NOME_CONTRATANTE
      const tipoEvento = evt[i][e('TIPO_EVENTO')] || '';
      const nomeContratante = evt[i][e('NOME_CONTRATANTE')] || '';
      const nomePadraoEvento = (tipoEvento + ' ' + nomeContratante).trim();

      // BLOQUEIO DEFINITIVO: folha é lançamento ÚNICO
      const atual = Number(evt[i][e('FOLHA_CUSTO_VALOR')]) || 0;
      if (atual > 0) {
        throw new Error('Folha de custos já registrada para este evento');
      }

      const idMovimentacao = gerarIDMovimentacao();
      const linhaMov = [
        idMovimentacao,
        'FOLHA_EVENTO',
        'SAÍDA',
        idEvento,
        nomePadraoEvento,
        normalizarData(new Date()),
        Number(valor),
        '',
        'Folha',
        '',
        '',
        descricao || 'Custo operacional do evento',
        usuario,
        new Date(),
        '',
        'PROCESSADO'
      ];

      appendRowComVerificacao_(shMov, linhaMov, 'MOVIMENTACOES_FINANCEIRAS/FOLHA_EVENTO');
      setValueComVerificacao_(
        shEvt,
        i + 1,
        e('FOLHA_CUSTO_VALOR') + 1,
        Number(Number(valor).toFixed(2)),
        'EVENTOS/FOLHA_CUSTO_VALOR'
      );
      setValueComVerificacao_(
        shEvt,
        i + 1,
        e('FOLHA_CUSTO_DESCRICAO') + 1,
        descricao || '',
        'EVENTOS/FOLHA_CUSTO_DESCRICAO'
      );

      return { sucesso: true, idMovimentacao: idMovimentacao };
    }

    throw new Error('Evento não encontrado');
  });
}

function apiRegistrarSaidaEvento(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload inválido');
  }
  if (!payload.tipoSaida || !payload.idEvento) {
    throw new Error('Payload deve conter tipoSaida e idEvento');
  }

  if (payload.tipoSaida === 'NF_EVENTO') {
    return registrarNFEvento(payload.idEvento, payload);
  }

  if (payload.tipoSaida === 'BV_EVENTO') {
    return registrarBVEvento(payload.idEvento, payload);
  }

  if (payload.tipoSaida === 'FOLHA_EVENTO') {
    if (typeof payload.valor === 'undefined' || payload.valor === null) {
      throw new Error('Para FOLHA_EVENTO é obrigatório informar valor');
    }
    return registrarFolhaEvento(
      payload.idEvento,
      Number(payload.valor),
      payload.observacoes
    );
  }

  throw new Error('Tipo de saída não suportado: ' + payload.tipoSaida);
}




/* =====================================================
 * REGISTRO DE RECEBIMENTO
 * ===================================================== */

function registrarRecebimento(dados) {
  exigirAcao('eventos:registrarRecebimento');
  return executarComLockFinanceiro_('RECEBIMENTO_CLIENTE', function () {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    const usuario = getUsuarioAtual().email;

    const evento = buscarEvento(dados.idEvento);
    if (!evento) throw new Error('Evento não encontrado');

    const idRecebimento = gerarIDMovimentacao();

    const linha = [
      idRecebimento,
      'RECEBIMENTO_CLIENTE',
      'ENTRADA',
      dados.idEvento,
      buscarNomeEventoPorID(dados.idEvento),
      normalizarData(dados.dataRecebimento),
      Number(dados.valor),
      dados.formaPagamento || '',
      buscarContratantePorEvento(dados.idEvento),
      evento.idContratante,
      dados.linkComprovante || '',
      dados.observacoes || '',
      usuario,
      new Date(),
      '',
      'PROCESSADO'
    ];

    appendRowComVerificacao_(sh, linha, 'MOVIMENTACOES_FINANCEIRAS/RECEBIMENTO_CLIENTE');

    // comissão automática
    const resultadoComissao = gerarComissaoAutomatica(
      dados.idEvento,
      idRecebimento,
      Number(dados.valor),
      dados.dataRecebimento
    );

    atualizarResumoFinanceiroEvento(dados.idEvento);

    return {
      sucesso: true,
      idRecebimento: idRecebimento,
      idComissaoGerada: resultadoComissao && resultadoComissao.idMovimentacao ? resultadoComissao.idMovimentacao : ''
    };
  });
}

/* =====================================================
 * GERAÇÃO DE COMISSÃO AUTOMÁTICA
 * ===================================================== */

function gerarComissaoAutomatica(idEvento, idRecebimento, valorRecebido, dataRecebimento) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');

  const evento = buscarEvento(idEvento);
  const vendedor = buscarVendedor(evento.idVendedor);

  if (!vendedor) return;

  const valorTotal = Number(evento.valorTotal) || 0;
  const valorBV = Number(evento.valorBV) || 0;
  const valorNF = Number(evento.valorNF) || 0;

  const baseLiquida = valorTotal - valorBV - valorNF;
  if (baseLiquida <= 0) return;

  const proporcao = valorRecebido / valorTotal;

  let valorComissao = 0;

  if (evento.comissaoTipo === 'Fixo') {
    valorComissao = evento.comissaoValor * proporcao;
  } else {
    const percentual = evento.comissaoTipo === 'Percentual'
      ? evento.comissaoValor
      : vendedor.comissaoPadrao;
    valorComissao = baseLiquida * proporcao * (percentual / 100);
  }
// 🔒 REGRA FINANCEIRA — NÃO MEXER
// Comissão sempre em moeda (2 casas decimais)
valorComissao = Math.round(valorComissao * 100) / 100;

  if (valorComissao <= 0) return;

  const linha = [
    gerarIDMovimentacao(),
    'COMISSAO_GERADA',
    'SAÍDA',
    idEvento,
    buscarNomeEventoPorID(idEvento),
    normalizarData(dataRecebimento),
    Number(valorComissao),
    '',
    vendedor.nome,
    evento.idVendedor,
    '',
    `Ref: ${idRecebimento}`,
    'SYSTEM',
    new Date(),
    '',
    'PENDENTE'
  ];

  appendRowComVerificacao_(sh, linha, 'MOVIMENTACOES_FINANCEIRAS/COMISSAO_GERADA');
  return { sucesso: true, idMovimentacao: linha[0] };
}

/**
 * Busca contratante por evento
 */
function buscarContratantePorEvento(idEvento) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('EVENTOS');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.ID_EVENTO] === idEvento) {
      return data[i][COL.NOME_CONTRATANTE]; // Col 10 (antes 9)
    }
  }
  return '';
}

/**
 * Busca nome do evento por ID
 */
function buscarNomeEventoPorID(idEvento) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('EVENTOS');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.ID_EVENTO] === idEvento) {
      const tipo = data[i][COL.TIPO_EVENTO]; // Col 7 (antes 6)
      const contratante = data[i][COL.NOME_CONTRATANTE]; // Col 10 (antes 9)
      return `${tipo} ${contratante}`;
    }
  }
  return '';
}

/**
 * Calcula estatísticas de comissão de um evento
 * Retorna: total esperado, total pago, % conclusão
 */
function calcularEstatisticasComissaoEvento(idEvento) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  const data = sheet.getDataRange().getValues();
  
  const evento = buscarEvento(idEvento);
  const vendedor = buscarVendedor(evento.idVendedor);
  
  // Calcula comissão total esperada
  const baseCalculo = evento.valorTotal - (evento.valorBV || 0) - (evento.valorNF || 0);
  let comissaoTotalEsperada = 0;
  
  if (evento.comissaoTipo === 'Fixo') {
    comissaoTotalEsperada = evento.comissaoValor;
  } else if (evento.comissaoTipo === 'Sem Comissão') {
    comissaoTotalEsperada = 0;
  } else {
    const percentual = evento.comissaoTipo === 'Percentual' ? evento.comissaoValor : vendedor.comissaoPadrao;
    comissaoTotalEsperada = baseCalculo * (percentual / 100);
  }
  
  // Soma todas as comissões já geradas (pagas ou pendentes)
  let totalComissaoGerada = 0;
  let totalComissaoPaga = 0;
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === 'COMISSAO_GERADA' && data[i][3] === idEvento) {
      const valorComissao = data[i][6];
      totalComissaoGerada += valorComissao;
      
      if (data[i][15] === 'PROCESSADO') {
        totalComissaoPaga += valorComissao;
      }
    }
  }
  
  // Calcula % de conclusão
  const percentualConclusao = comissaoTotalEsperada > 0 ? 
    (totalComissaoGerada / comissaoTotalEsperada) : 0;
  
  return {
    comissaoTotalEsperada: comissaoTotalEsperada,
    totalComissaoGerada: totalComissaoGerada,
    totalComissaoPaga: totalComissaoPaga,
    percentualConclusao: percentualConclusao
  };
}

/* =====================================================
 * BUSCA DE COMISSÕES (REGRA OFICIAL)
 * ===================================================== */


function buscarComissoesPendentes(idVendedor) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  const dados = sh.getDataRange().getValues();
  const colTipoMovimentacao = 1;
  const colStatus = 15;
  const colIdVendedor = 9;
  const colIncluidoEmFechamento = 14;

  const comissoes = [];

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    // Excluir qualquer linha do tipo AJUSTE_COMISSAO_ESTORNO
    if (linha[colTipoMovimentacao] === 'AJUSTE_COMISSAO_ESTORNO') continue;
    if (
      linha[colTipoMovimentacao] === 'COMISSAO_GERADA' &&
      String(linha[colIdVendedor]) === String(idVendedor)
    ) {
      const status = linha[colStatus];
      const incluidoEmFechamento = linha[colIncluidoEmFechamento];
      const elegivel =
        status === 'PENDENTE' &&
        !incluidoEmFechamento;
      if (elegivel) {
        comissoes.push({
          idMovimentacao: linha[0],
          idEvento: linha[3],
          nomeEvento: linha[4],
          dataMovimentacao: normalizarData(linha[5]),
          valorComissao: Number(linha[6]) || 0,
          observacoes: linha[11] || ''
        });
      }
    }
  }

  return comissoes;
}

/**
 * Busca resumo financeiro de um evento (valor total, recebido, pendente, status)
 * Não altera planilha, apenas retorna objeto resumo.
 */
function buscarResumoFinanceiroEvento(idEvento) {
  exigirAcao('eventos:visualizarFinanceiro');
  const ss = SpreadsheetApp.getActive();
  const shEvt = ss.getSheetByName('EVENTOS');
  const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');

  if (!shEvt || !shMov) return null;

  const evt = shEvt.getDataRange().getValues();
  const evtHead = evt.shift();
  const e = c => evtHead.indexOf(c);

  const evtIdx = evt.findIndex(r => String(r[e('ID_EVENTO')]) === String(idEvento));
  if (evtIdx === -1) return null;

  const mov = shMov.getDataRange().getValues();
  const movHead = mov.shift();
  const m = c => movHead.indexOf(c);

  const recebimentos = mov.filter(r =>
    String(r[m('ID_EVENTO')]) === String(idEvento) &&
    r[m('NATUREZA')] === 'ENTRADA' &&
    r[m('STATUS')] !== 'CANCELADO'
  );

  const valorRecebidoAteAgora = recebimentos.reduce((s, r) => {
    const raw = r[m('VALOR')];
    if (raw === null || raw === undefined || raw === '') return s;

    const normalizado =
      typeof raw === 'string'
        ? Number(raw.replace(/\./g, '').replace(',', '.'))
        : Number(raw);

    return s + (isNaN(normalizado) ? 0 : normalizado);
  }, 0);

  const valorTotal = Number(evt[evtIdx][e('VALOR_TOTAL')]) || 0;
  const valorPendente = valorTotal - valorRecebidoAteAgora;

  let statusRecebimento = 'EM_ABERTO';
  if (valorRecebidoAteAgora > 0 && valorPendente > 0) statusRecebimento = 'PARCIAL';
  if (valorPendente <= 0) statusRecebimento = 'QUITADO';

  return {
    valorTotal,
    valorRecebidoAteAgora,
    valorPendente,
    statusRecebimento
  };
}

/**
 * =====================================================
 * LISTAGEM DE RECEBIMENTOS POR EVENTO
 * USADO NO FRONTEND DE ESTORNO
 * =====================================================
 * Retorna apenas RECEBIMENTOS válidos (ENTRADA)
 * Ignora estornos, comissões e movimentos cancelados
 */
function listarRecebimentosPorEvento(idEvento) {
  exigirAcao('eventos:visualizarFinanceiro');
  if (!idEvento) return [];

  // 🔒 BLINDAGEM: extrai ID_EVENTO real mesmo se vier com texto extra
  if (typeof idEvento === 'string') {
    const match = idEvento.match(/AG-\d{8}-\d{3}/);
    if (match) {
      idEvento = match[0];
    }
  }

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  if (!sh) return [];

  const data = sh.getDataRange().getValues();

  const recebimentos = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    const ID_MOVIMENTACAO   = row[0];
    const TIPO_MOVIMENTACAO = row[1];
    const NATUREZA          = row[2];
    const ID_EVENTO_ROW     = row[3];
    const DATA              = row[5];
    const VALOR             = row[6];
    const FORMA             = row[7];
    const STATUS            = row[15];
    const NOME_EVENTO       = row[4];

    if (
      String(ID_EVENTO_ROW) === String(idEvento) &&
      NATUREZA === 'ENTRADA' &&
      TIPO_MOVIMENTACAO === 'RECEBIMENTO_CLIENTE' &&
      STATUS !== 'CANCELADO'
    ) {
      const valorNum = Number(
        typeof VALOR === 'string'
          ? VALOR.replace(/\./g, '').replace(',', '.')
          : VALOR
      );

      recebimentos.push({
        id: ID_MOVIMENTACAO,
        valor: isNaN(valorNum) ? 0 : Number(valorNum.toFixed(2)),
        ddata: Utilities.formatDate(
  normalizarData(DATA),
  Session.getScriptTimeZone(),
  'yyyy-MM-dd'
),
        dataFormatada: Utilities.formatDate(
          normalizarData(DATA),
          Session.getScriptTimeZone(),
          'dd/MM/yyyy'
        ),
        formaPagamento: FORMA || '',
        nomeEvento: NOME_EVENTO || ''
      });
    }
  }

  return recebimentos;
}

/* =====================================================
 * PREVIEW DO FECHAMENTO (USADO PELO FRONTEND)
 * ===================================================== */

/*
function extrairIdRecebimentoDaObservacao(obs) {
  if (!obs || typeof obs !== 'string') return null;

  const texto = obs.replace(/\s+/g, ' ').trim();

  const match = texto.match(/MOV-\d{8}-\d{3}(?![\d-])/);
  return match ? match[0] : null;
}
*/

function visualizarPreviewFechamento(idVendedor) {
  // Mantém alinhamento com a ACL e com o roteador da API.
  exigirAcao('comissao:fechar');
  // Buscar todas as comissões (pendentes e processadas) do vendedor
  const ss = SpreadsheetApp.getActive();
  const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  const movData = shMov.getDataRange().getValues();
  const movHead = movData[0];
  const m = c => movHead.indexOf(c);
  if (m('ID_CONTRAPARTE') === -1) {
    throw new Error('Coluna ID_CONTRAPARTE não encontrada na aba MOVIMENTACOES_FINANCEIRAS');
  }
  // Carrega eventos para buscar regras de comissão
  const shEvt = ss.getSheetByName('EVENTOS');
  const evtData = shEvt.getDataRange().getValues();
  const evtHead = evtData[0];
  const e = c => evtHead.indexOf(c);

  // Função para buscar evento por id
  function getEventoPorId(idEvento) {
    for (let i = 1; i < evtData.length; i++) {
      if (String(evtData[i][e('ID_EVENTO')]) === String(idEvento)) {
        // Retorna objeto do evento
        return evtData[i];
      }
    }
    return null;
  }

  // Busca o valor do recebimento original pelo idRecebimento
  function buscarValorRecebimentoOriginal(idRecebimento) {
    for (let i = 1; i < movData.length; i++) {
      if (
        movData[i][m('TIPO_MOVIMENTACAO')] === 'RECEBIMENTO_CLIENTE' &&
        String(movData[i][m('ID_MOVIMENTACAO')]) === String(idRecebimento)
      ) {
        return Number(movData[i][m('VALOR')]) || 0;
      }
    }
    return 0;
  }

  // Busca estornos vinculados a um recebimento (por idRecebimento)
  function buscarEstornosPorRecebimento(idRecebimento) {
    const estornos = [];
    for (let i = 1; i < movData.length; i++) {
      if (
        movData[i][m('TIPO_MOVIMENTACAO')] === 'ESTORNO_RECEBIMENTO' &&
        movData[i][m('STATUS')] !== 'CANCELADO' &&
        typeof movData[i][m('OBSERVACOES')] === 'string' &&
        extrairIdRecebimentoDaObservacao(movData[i][m('OBSERVACOES')]) === idRecebimento
      ) {
        estornos.push(movData[i]);
      }
    }
    return estornos;
  }

  // Busca recebimento por ID
  function buscarRecebimentoPorIdInterno(idMov) {
    if (!idMov) return null;
    for (let i = 1; i < movData.length; i++) {
      if (
        String(movData[i][m('ID_MOVIMENTACAO')]) === String(idMov) &&
        movData[i][m('NATUREZA')] === 'ENTRADA'
      ) {
        const valor = Number(movData[i][m('VALOR')]);
        return {
          data: normalizarData(movData[i][m('DATA_MOVIMENTACAO')]),
          valor: isNaN(valor) ? 0 : valor
        };
      }
    }
    return null;
  }

  // Buscar comissões do vendedor (todas COMISSAO_GERADA para o vendedor)
  const comissoes = [];
  for (let i = 1; i < movData.length; i++) {
    if (
      movData[i][m('TIPO_MOVIMENTACAO')] === 'COMISSAO_GERADA' &&
      String(movData[i][m('ID_CONTRAPARTE')]) === String(idVendedor)
    ) {
      comissoes.push({
        idMovimentacao: movData[i][m('ID_MOVIMENTACAO')],
        idEvento: movData[i][m('ID_EVENTO')],
        nomeEvento: movData[i][m('NOME_EVENTO')],
        dataMovimentacao: normalizarData(movData[i][m('DATA_MOVIMENTACAO')]),
        valorComissao: Number(movData[i][m('VALOR')]) || 0,
        observacoes: movData[i][m('OBSERVACOES')] || '',
        status: movData[i][m('STATUS')]
      });
    }
  }
  if (!comissoes.length) {
    return { sucesso: false, mensagem: 'Nenhuma comissão encontrada para o vendedor' };
  }

  const vendedor = buscarVendedor(idVendedor);

  // Para blindagem de ajuste já resolvido, coletar todos os ajustes já existentes
  const ajustesExistentes = {};
  for (let i = 1; i < movData.length; i++) {
    if (
      movData[i][m('TIPO_MOVIMENTACAO')] === 'AJUSTE_COMISSAO_ESTORNO' &&
      typeof movData[i][m('OBSERVACOES')] === 'string'
    ) {
      const idRec = extrairIdRecebimentoDaObservacao(
        movData[i][m('OBSERVACOES')]
      );
      if (idRec) {
        ajustesExistentes[idRec] = true;
      }
    }
  }

  const eventos = comissoes.map(c => {
    const idRecebimento = extrairIdRecebimentoDaObservacao(c.observacoes);
    let recebimento = null;
    if (idRecebimento) {
      recebimento = buscarRecebimentoPorIdInterno(idRecebimento);
    }

    let statusOrigem = 'OK';
    if (!idRecebimento) {
      statusOrigem = 'ID_NAO_IDENTIFICADO';
    } else if (!recebimento) {
      statusOrigem = 'RECEBIMENTO_NAO_LOCALIZADO';
    }

    // Lógica real de cálculo proporcional de ajuste por estorno
    let ajusteNecessario = false;
    let valorAjuste = 0;
    let ajusteComissao = 0;
    if (idRecebimento && recebimento) {
      // Se já existe ajuste para esse recebimento, não sinaliza ajuste
      if (ajustesExistentes[idRecebimento]) {
        ajusteNecessario = false;
        valorAjuste = 0;
        ajusteComissao = 0;
      } else {
        // 1. localizar valor original do recebimento
        const valorRecebidoOriginal = buscarValorRecebimentoOriginal(idRecebimento);
        // 2. localizar todos estornos vinculados a esse recebimento
        const estornosVinculados = buscarEstornosPorRecebimento(idRecebimento);
        // 3. somar valores estornados
        const totalEstornado = estornosVinculados.reduce((s, r) => {
          const v = Number(r[m('VALOR')]) || 0;
          return s + v;
        }, 0);
        // 4. calcular proporção
        let proporcaoEstorno = 0;
        if (valorRecebidoOriginal > 0 && totalEstornado > 0) {
          proporcaoEstorno = totalEstornado / valorRecebidoOriginal;
          if (proporcaoEstorno > 1) proporcaoEstorno = 1;
        }
        // 5. calcular valor do ajuste
        valorAjuste = Number((c.valorComissao * proporcaoEstorno).toFixed(2));
        // Garante que não ultrapasse a comissão original
        if (valorAjuste > c.valorComissao) valorAjuste = c.valorComissao;
        // 6. só sinaliza ajuste se houver estorno
        ajusteNecessario = totalEstornado > 0;
        ajusteComissao = valorAjuste > 0 ? -valorAjuste : 0;
      }
    } else {
      ajusteNecessario = false;
      valorAjuste = 0;
      ajusteComissao = 0;
    }

    // Para preview: ajusteNecessario deve ser true para comissão pendente OU processada,
    // desde que haja estorno e ainda não haja ajuste registrado.
    return {
      nomeEvento: c.nomeEvento,
      valorComissao: c.valorComissao, // valor original
      ajusteComissao: ajusteComissao,
      dataRecebimento: recebimento
        ? Utilities.formatDate(
            new Date(recebimento.data),
            Session.getScriptTimeZone(),
            'dd/MM/yyyy'
          )
        : null,
      valorRecebido: recebimento ? recebimento.valor : 0,
      statusOrigem,
      ajusteNecessario,
      valorAjuste,
      idEvento: c.idEvento,
      idMovimentacao: c.idMovimentacao,
      statusComissao: c.status
    };
  });

  // 🔒 REGRA FINAL DO PREVIEW (LEGADO SAFE)
  // Exibe:
  // - Comissões pendentes
  // - Comissões já pagas QUE POSSUEM ajusteNecessario = true
  const eventosFiltrados = eventos.filter(e =>
    e.statusComissao === 'PENDENTE' || e.ajusteNecessario === true
  );

  // Novo: totalComissao = soma(valorComissao + ajusteComissao) apenas para exibição
  const totalComissao = eventosFiltrados.reduce(
    (s, e) => s + (e.valorComissao + (e.ajusteComissao || 0)),
    0
  );
  const existeExcecao = eventosFiltrados.some(e => e.statusOrigem !== 'OK');
  const totalAjuste = eventosFiltrados.reduce((s, e) => s + (e.ajusteComissao || 0), 0);
  const existeAjustePendentes = eventosFiltrados.some(e => e.ajusteNecessario === true);

  // Total estornado ao cliente (valor bruto do estorno, não comissão)
  let totalEstornoCliente = 0;
  for (let i = 1; i < movData.length; i++) {
    if (
      movData[i][m('TIPO_MOVIMENTACAO')] === 'ESTORNO_RECEBIMENTO' &&
      movData[i][m('STATUS')] !== 'CANCELADO'
    ) {
      const idRec = extrairIdRecebimentoDaObservacao(
        movData[i][m('OBSERVACOES')]
      );
      // Só soma estorno que AINDA NÃO POSSUI AJUSTE
      if (idRec && !ajustesExistentes[idRec]) {
        totalEstornoCliente += Number(movData[i][m('VALOR')]) || 0;
      }
    }
  }

  return {
    sucesso: true,
    vendedor,
    totalEventos: eventosFiltrados.length,
    totalComissao,
    existeExcecao,
    existeAjustePendentes,
    totalAjuste,
    totalEstornoCliente,
    eventos: eventosFiltrados
  };
}


/* =====================================================
 * FECHAMENTO DE COMISSÃO
 * ===================================================== */

/**
 * 🔒 REGRA CRÍTICA DE SEGURANÇA FINANCEIRA
 * Ajustes de comissão por estorno são calculados APENAS no preview.
 * O fechamento NUNCA recalcula ou reaplica ajustes.
 * Qualquer alteração nessa regra gera DESCONTO DUPLO e PREJUÍZO.
 */
function fecharComissaoVendedor(idVendedor, _, __, ajusteCredito, ajusteDebito, linkComprovante) {
  exigirAcao('comissao:fechar');
  let etapa = 'inicio';
  const logPrefix = '[FECHAMENTO_COMISSAO][idVendedor=' + String(idVendedor) + '] ';
  const log = texto => Logger.log(logPrefix + texto);
  let lock = null;
  try {
  log('Iniciando fechamento');
  lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Não foi possível obter lock para fechamento de comissão');
  }
  // =====================================================
  // REGRA:
  // Estorno de recebimento SEMPRE impacta comissão.
  // Se comissão não foi paga → desconto ocorre no fechamento atual.
  // Se comissão já foi paga → desconto ocorre no próximo fechamento.
  // Nenhum valor é apagado. Tudo é registrado como novo movimento.
  // =====================================================
  etapa = 'abrir_planilhas';
  const ss = SpreadsheetApp.getActive();
  const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  const shFech = ss.getSheetByName('FECHAMENTOS_COMISSAO');
  const usuario = getUsuarioAtual().email;
  if (!shMov || !shFech) {
    throw new Error('Abas MOVIMENTACOES_FINANCEIRAS ou FECHAMENTOS_COMISSAO não encontradas');
  }

  // Para ajustes, precisamos do preview detalhado
  etapa = 'gerar_preview';
  const preview = visualizarPreviewFechamento(idVendedor);
  if (!preview.sucesso || !preview.eventos.length) throw new Error('Nada a fechar');
  const eventos = preview.eventos;
  log('Preview OK: eventos=' + eventos.length);

  // Buscar todas as comissões GERADAS (pendentes e processadas) do vendedor
  etapa = 'carregar_movimentacoes';
  const movData = shMov.getDataRange().getValues();
  const movHead = movData[0];
  const m = c => movHead.indexOf(c);
  if (m('ID_CONTRAPARTE') === -1) {
    throw new Error('Coluna ID_CONTRAPARTE não encontrada na aba MOVIMENTACOES_FINANCEIRAS');
  }
  const colTipoMovimentacao = m('TIPO_MOVIMENTACAO');
  const colStatus = m('STATUS');
  const colIdVendedor = m('ID_CONTRAPARTE');
  const colIncluidoEmFechamento = m('INCLUIDO_EM_FECHAMENTO');
  const colIdMovimentacao = m('ID_MOVIMENTACAO');
  etapa = 'filtrar_comissoes';
  const comissoes = [];
  for (let i = 1; i < movData.length; i++) {
    const linha = movData[i];
    // Não processar ajustes de estorno
    if (linha[colTipoMovimentacao] === 'AJUSTE_COMISSAO_ESTORNO') continue;
    if (
      linha[colTipoMovimentacao] === 'COMISSAO_GERADA' &&
      (linha[colStatus] === 'PENDENTE' || linha[colStatus] === 'PROCESSADO') &&
      String(linha[colIdVendedor]) === String(idVendedor)
    ) {
      // Proteção contra reprocessamento: pula comissão já fechada
      if (linha[colIncluidoEmFechamento]) {
        continue;
      }
      comissoes.push({
        idMovimentacao: linha[colIdMovimentacao],
        status: linha[colStatus]
      });
    }
  }

  log('Comissões elegíveis para snapshot=' + comissoes.length);

  // 🔒 REGRA FINAL:
  // O ajuste por estorno JÁ está aplicado em `ajusteComissao` vindo do preview.
  // NUNCA recalcular ou subtrair ajuste novamente aqui.

  etapa = 'calcular_ajustes';
  const ajustesEstorno = calcularAjustesComissaoPorEstorno(idVendedor);
  log('Ajustes por estorno=' + ajustesEstorno.length);

  const total = eventos.reduce(
    (s, e) => s + (e.valorComissao + (e.ajusteComissao || 0)),
    0
  );

  const ajusteCreditoNum = Number(ajusteCredito) || 0;
  const ajusteDebitoNum = Number(ajusteDebito) || 0;
  const valorFinal =
    total +
    ajusteCreditoNum -
    ajusteDebitoNum;

  etapa = 'validar_vendedor';
  const idFechamento = gerarIDFechamento(idVendedor);
  const vendedor = buscarVendedor(idVendedor);
  if (!vendedor || !vendedor.nome) {
    throw new Error('Vendedor não encontrado para fechamento. Verifique o ID_VENDEDOR selecionado.');
  }

  // ===============================
  // SNAPSHOT IMUTÁVEL DO FECHAMENTO
  // ===============================
  const snapshotComissoes = eventos.map(e => ({
    idEvento: e.idEvento,
    nomeEvento: e.nomeEvento,
    valorComissaoNesteFechamento: Number(e.valorComissao || 0),
    ajusteComissao: Number(e.ajusteComissao || 0),
    valorFinalEvento: Number((e.valorComissao + (e.ajusteComissao || 0)).toFixed(2))
  }));

  const snapshotJson = JSON.stringify({
    idFechamento,
    idVendedor,
    vendedor: vendedor.nome,
    dataFechamento: new Date(),
    comissoes: snapshotComissoes,
    ajustesEstorno: ajustesEstorno.map(a => ({
      idEvento: a.idEvento,
      nomeEvento: a.nomeEvento,
      valorAjuste: Number(a.valorAjuste || 0),
      observacoes: String(a.observacoes || '')
    })),
    totalComissoes: total,
    ajusteCredito: ajusteCreditoNum,
    ajusteDebito: ajusteDebitoNum,
    linkComprovante: String(linkComprovante || '').trim(),
    valorFinal: valorFinal
  });

  etapa = 'registrar_fechamento';
  const linhaFechamento = [
    idFechamento,
    idVendedor,
    vendedor.nome,
    null,
    null,
    total,
    total,
    ajusteCreditoNum,
    ajusteDebitoNum,
    '',
    valorFinal,
    'CONFIRMADO',
    new Date(),
    usuario,
    String(linkComprovante || '').trim(),
    '',
    snapshotJson
  ];
  appendRowComVerificacao_(shFech, linhaFechamento, 'FECHAMENTOS_COMISSAO/FECHAMENTO');
  log('Fechamento registrado. ID=' + idFechamento);

  // Atualiza status das comissões (SOMENTE snapshot atual do fechamento)
  etapa = 'atualizar_status_comissoes';
  const dados = shMov.getDataRange().getValues();
  const colIdMovimentacao2 = m('ID_MOVIMENTACAO');
  // ids do snapshot do fechamento
  const idsSnapshot = comissoes.map(c => c.idMovimentacao);
  let totalComissoesAtualizadas = 0;
  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    if (idsSnapshot.includes(linha[colIdMovimentacao2])) {
      setValueComVerificacao_(shMov, i + 1, colIncluidoEmFechamento + 1, idFechamento, 'MOVIMENTACOES_FINANCEIRAS/INCLUIDO_EM_FECHAMENTO');
      setValueComVerificacao_(shMov, i + 1, colStatus + 1, 'PROCESSADO', 'MOVIMENTACOES_FINANCEIRAS/STATUS');
      totalComissoesAtualizadas++;
    }
  }
  if (totalComissoesAtualizadas !== idsSnapshot.length) {
    throw new Error(
      'Falha de consistência ao atualizar comissões no fechamento. Esperado=' +
      idsSnapshot.length +
      ', atualizado=' +
      totalComissoesAtualizadas
    );
  }

  // Criar movimentos AJUSTE_COMISSAO_ESTORNO APENAS para ajustes ainda não existentes
  // (Blindagem já feita em calcularAjustesComissaoPorEstorno)
  etapa = 'registrar_ajustes';
  for (let i = 0; i < ajustesEstorno.length; i++) {
    const a = ajustesEstorno[i];
    // Usar timestamp real para auditoria
    const dataMov = new Date(); // timestamp real para auditoria
    const linhaAjuste = [
      gerarIDMovimentacao(),
      'AJUSTE_COMISSAO_ESTORNO',
      'SAÍDA',
      a.idEvento,
      a.nomeEvento,
      normalizarData(dataMov), // DATA_MOVIMENTACAO normalizada (sem hora)
      a.valorAjuste,
      '',
      vendedor.nome,
      idVendedor,
      '',
      a.observacoes,
      usuario,
      new Date(), // TIMESTAMP real do registro
      '',
      'PROCESSADO'
    ];
    appendRowComVerificacao_(shMov, linhaAjuste, 'MOVIMENTACOES_FINANCEIRAS/AJUSTE_COMISSAO_ESTORNO');
  }

  etapa = 'gerar_pdf';
  const linkPdf = gerarPdfFechamentoComissao(idFechamento);
  atualizarLinkPdfNoFechamento_(shFech, idFechamento, linkPdf);
  log('PDF gerado com sucesso');

  // =====================================================
  // ESPELHO FINANCEIRO — VALOR_COMISSAO_PAGO (PÓS-FECHAMENTO)
  // =====================================================
  etapa = 'atualizar_espelho_eventos';
  const shEvtEspelho = ss.getSheetByName('EVENTOS');
  if (!shEvtEspelho) {
    throw new Error('Aba EVENTOS não encontrada');
  }
  const evtDataEspelho = shEvtEspelho.getDataRange().getValues();
  const evtHeadEspelho = evtDataEspelho[0];
  const eEsp = c => evtHeadEspelho.indexOf(c);
  if (
    eEsp('ID_EVENTO') === -1 ||
    eEsp('VALOR_COMISSAO_PAGO') === -1 ||
    eEsp('VALOR_COMISSAO_CALCULADO') === -1 ||
    eEsp('STATUS_COMISSAO') === -1
  ) {
    throw new Error('Colunas obrigatórias de espelho de comissão não encontradas na aba EVENTOS');
  }

  // Releitura após persistência para evitar espelho defasado.
  const movDataAtual = shMov.getDataRange().getValues();
  const movHeadAtual = movDataAtual[0];
  const mAtual = c => movHeadAtual.indexOf(c);
  if (
    mAtual('TIPO_MOVIMENTACAO') === -1 ||
    mAtual('STATUS') === -1 ||
    mAtual('ID_EVENTO') === -1 ||
    mAtual('ID_CONTRAPARTE') === -1 ||
    mAtual('VALOR') === -1
  ) {
    throw new Error('Colunas obrigatórias não encontradas na aba MOVIMENTACOES_FINANCEIRAS');
  }

  // Identifica eventos únicos envolvidos neste fechamento
  const eventosFechados = [...new Set(eventos.map(e => e.idEvento))];

  eventosFechados.forEach(idEvento => {
    let totalPagoEvento = 0;
    let totalGeradoEvento = 0;

    // Soma TODAS as comissões do vendedor para este evento (geradas e processadas)
    for (let i = 1; i < movDataAtual.length; i++) {
      if (
        movDataAtual[i][mAtual('TIPO_MOVIMENTACAO')] === 'COMISSAO_GERADA' &&
        String(movDataAtual[i][mAtual('ID_EVENTO')]) === String(idEvento) &&
        String(movDataAtual[i][mAtual('ID_CONTRAPARTE')]) === String(idVendedor) &&
        movDataAtual[i][mAtual('STATUS')] !== 'CANCELADO'
      ) {
        const valorMov = Number(movDataAtual[i][mAtual('VALOR')]) || 0;
        totalGeradoEvento += valorMov;
        if (movDataAtual[i][mAtual('STATUS')] === 'PROCESSADO') {
          totalPagoEvento += valorMov;
        }
      }
    }

    totalGeradoEvento = Number(totalGeradoEvento.toFixed(2));
    totalPagoEvento = Number(totalPagoEvento.toFixed(2));
    const totalEsperadoEvento = Number(
      evtDataEspelho.find(r => String(r[eEsp('ID_EVENTO')]) === String(idEvento))?.[eEsp('VALOR_COMISSAO_CALCULADO')] || 0
    );
    const totalPendenteEvento = Number(Math.max(totalGeradoEvento - totalPagoEvento, 0).toFixed(2));
    const statusComissaoEvento = determinarStatusComissao_(
      totalEsperadoEvento,
      totalGeradoEvento,
      totalPagoEvento,
      totalPendenteEvento
    );

    // Atualiza EVENTOS.VALOR_COMISSAO_PAGO
    for (let r = 1; r < evtDataEspelho.length; r++) {
      if (String(evtDataEspelho[r][eEsp('ID_EVENTO')]) === String(idEvento)) {
        setValueComVerificacao_(
          shEvtEspelho,
          r + 1,
          eEsp('VALOR_COMISSAO_PAGO') + 1,
          totalPagoEvento,
          'EVENTOS/VALOR_COMISSAO_PAGO'
        );
        setValueComVerificacao_(
          shEvtEspelho,
          r + 1,
          eEsp('STATUS_COMISSAO') + 1,
          statusComissaoEvento,
          'EVENTOS/STATUS_COMISSAO'
        );
        break;
      }
    }
  });

  return {
    sucesso: true,
    idFechamento,
    valorFinal,
    linkPdf,
    mensagem: 'Fechamento realizado com sucesso'
  };
  } catch (err) {
    const detalhe = String(err && err.message ? err.message : err);
    const stack = err && err.stack ? String(err.stack) : '';
    Logger.log(logPrefix + 'ERRO etapa=' + etapa + ' detalhe=' + detalhe + (stack ? ' stack=' + stack : ''));
    throw new Error('Falha no fechamento (etapa: ' + etapa + '): ' + detalhe);
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
}

/**
 * =====================================================
 * GERAÇÃO DE PDF DE FECHAMENTO DE COMISSÃO (inclui AJUSTES)
 * =====================================================
 */

function gerarPdfFechamentoComissaoSnapshot_legacy(idFechamento) {
  // Carrega dados do fechamento e vendedor
  const ss = SpreadsheetApp.getActive();
  const shFech = ss.getSheetByName('FECHAMENTOS_COMISSAO');
  const fechData = shFech.getDataRange().getValues();
  const fechHead = fechData[0];
  const f = c => fechHead.indexOf(c);
  let rowFech = null;
  for (let i = 1; i < fechData.length; i++) {
    if (String(fechData[i][f('ID_FECHAMENTO')]) === String(idFechamento)) {
      rowFech = fechData[i];
      break;
    }
  }
  if (!rowFech) return '';

  // ================================
  // CARREGA SNAPSHOT DO FECHAMENTO
  // ================================
  const snapshotIdx = f('SNAPSHOT_FECHAMENTO');
  if (snapshotIdx === -1) {
    throw new Error('Snapshot do fechamento não encontrado');
  }

  const snapshot = JSON.parse(rowFech[snapshotIdx]);

  const comissoesFechamento = snapshot.comissoes || [];
  if (!comissoesFechamento.length) {
    throw new Error('Snapshot vazio — fechamento inválido');
  }

  // Geração do PDF (conteúdo como string para exemplo)
  let pdfContent = '';
  pdfContent += 'FECHAMENTO DE COMISSÃO\n';
  pdfContent += 'ID do Fechamento: ' + idFechamento + '\n';
  pdfContent += 'Vendedor: ' + snapshot.vendedor + '\n\n';

  pdfContent += 'COMISSÕES DESTE FECHAMENTO\n';

  comissoesFechamento.forEach(ev => {
    pdfContent +=
      (ev.nomeEvento || ev.idEvento || '-') +
      ' | Comissão: R$ ' + ev.valorComissaoNesteFechamento.toFixed(2) +
      (ev.ajusteComissao ? ' | Ajuste: R$ ' + ev.ajusteComissao.toFixed(2) : '') +
      ' | Total: R$ ' + ev.valorFinalEvento.toFixed(2) +
      '\n';
  });

  pdfContent += '\nTOTAL COMISSÕES: R$ ' + snapshot.totalComissoes.toFixed(2) + '\n';
  pdfContent += 'AJUSTE CRÉDITO: R$ ' + snapshot.ajusteCredito.toFixed(2) + '\n';
  pdfContent += 'AJUSTE DÉBITO: R$ ' + snapshot.ajusteDebito.toFixed(2) + '\n';
  pdfContent += 'VALOR FINAL: R$ ' + snapshot.valorFinal.toFixed(2) + '\n';

  // ... retornar link do PDF gerado ...
  // (Aqui, apenas para manter compatibilidade, pode-se retornar o conteúdo como string, mas no sistema real, gerar PDF e retornar o link.)
  return pdfContent;
}


function apiRegistrarRecebimento(payload) {
  if (!payload || !payload.idEvento) {
    throw new Error('Payload inválido');
  }

  if (typeof registrarRecebimento !== 'function') {
    throw new Error('Função registrarRecebimento não encontrada');
  }

  payload.idMovimentacao = 'MOV-REC-' + Utilities.getUuid();
  const resultado = registrarRecebimento(payload);
  return {
    sucesso: true,
    status: 'OK',
    idRecebimento: resultado && resultado.idRecebimento ? resultado.idRecebimento : '',
    idComissaoGerada: resultado && resultado.idComissaoGerada ? resultado.idComissaoGerada : ''
  };
}

function apiUploadComprovante(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload inválido para upload de comprovante');
  }

  const base64Raw = String(payload.arquivoBase64 || '').trim();
  const mimeType = String(payload.mimeType || '').toLowerCase().trim();
  const nomeOriginal = String(payload.nomeArquivo || 'comprovante').trim();
  const categoria = String(payload.categoria || 'GERAL').toUpperCase().trim();
  const referencia = String(payload.referencia || '').trim();

  if (!base64Raw) {
    throw new Error('Arquivo do comprovante não informado');
  }

  const tiposPermitidos = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
  if (!tiposPermitidos.includes(mimeType)) {
    throw new Error('Tipo de arquivo não suportado. Use PNG, JPG ou PDF.');
  }

  const base64Normalizada = base64Raw.replace(/\s/g, '+');
  let bytes = null;
  try {
    bytes = Utilities.base64Decode(base64Normalizada);
  } catch (_) {
    throw new Error('Arquivo inválido (base64 corrompido)');
  }

  if (!bytes || !bytes.length) {
    throw new Error('Arquivo vazio');
  }

  const maxBytes = 2 * 1024 * 1024; // 2 MB
  if (bytes.length > maxBytes) {
    throw new Error('Arquivo maior que 2MB. Reduza o comprovante e tente novamente.');
  }

  const pasta = obterPastaComprovantesFinanceiros_();
  const usuario = getUsuarioAtual().email;
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const ext = mimeType === 'application/pdf' ? 'pdf' : (mimeType.indexOf('png') !== -1 ? 'png' : 'jpg');
  const nomeBase = obterNomeBaseComprovante_(categoria, referencia, nomeOriginal);
  const sufixoUnico = Utilities.getUuid().slice(0, 8).toUpperCase();
  const nomeArquivoFinal = `COMP-${categoria}-${nomeBase}-${ts}-${sufixoUnico}.${ext}`;

  const blob = Utilities.newBlob(bytes, mimeType === 'image/jpg' ? 'image/jpeg' : mimeType, nomeArquivoFinal);
  const file = pasta.createFile(blob);
  file.setDescription(`Comprovante financeiro | categoria=${categoria} | usuario=${usuario}`);

  return {
    sucesso: true,
    idArquivo: file.getId(),
    nomeArquivo: file.getName(),
    linkArquivo: file.getUrl(),
    pastaId: pasta.getId()
  };
}

function obterPastaComprovantesFinanceiros_() {
  const chaveConfig = 'PASTA_COMPROVANTES_FINANCEIRO_ID';
  const folderId = (typeof obterConfig === 'function'
    ? String(obterConfig(chaveConfig) || '').trim()
    : '');

  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (_) {
      throw new Error('ID de pasta de comprovantes inválido em CONFIG.PASTA_COMPROVANTES_FINANCEIRO_ID');
    }
  }

  // Fallback seguro sem configuração prévia.
  const root = DriveApp.getRootFolder();
  const pastaCentral = getOrCreateFolderFinanceiro_(root, 'Central Financeira');
  return getOrCreateFolderFinanceiro_(pastaCentral, 'Comprovantes');
}

function getOrCreateFolderFinanceiro_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function atualizarLinkPdfNoFechamento_(shFech, idFechamento, linkPdf) {
  const valores = shFech.getDataRange().getValues();
  if (!valores.length) return;

  const head = valores[0];
  const c = nome => head.indexOf(nome);
  const idxId = c('ID_FECHAMENTO');
  const idxLinkPdf = c('LINK_PDF_FECHAMENTO');
  if (idxId === -1 || idxLinkPdf === -1) return;

  for (let i = 1; i < valores.length; i++) {
    if (String(valores[i][idxId]) === String(idFechamento)) {
      shFech.getRange(i + 1, idxLinkPdf + 1).setValue(String(linkPdf || '').trim());
      return;
    }
  }
}

function obterNomeBaseComprovante_(categoria, referencia, nomeOriginal) {
  let label = '';

  try {
    if ((categoria === 'RECEBIMENTO' || categoria === 'SAIDA_EVENTO') && referencia) {
      label = String(buscarNomeEventoPorID(referencia) || '');
    }

    if (categoria === 'FECHAMENTO_COMISSAO' && referencia) {
      const v = buscarVendedor(referencia);
      if (v && v.nome) label = 'VEND-' + String(v.nome);
    }
  } catch (_) {}

  if (!label) {
    label = String(nomeOriginal || 'comprovante').replace(/\.[a-zA-Z0-9]+$/, '');
  }

  return slugArquivoSeguro_(label, 40) || 'COMPROVANTE';
}

function slugArquivoSeguro_(texto, maxLen) {
  const raw = String(texto || '');
  const ascii = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();

  const limite = Number(maxLen || 40);
  return ascii.slice(0, limite);
}

/**
 * =====================================================
 * ESTORNO DE RECEBIMENTO (OPÇÃO B — VIA OBSERVAÇÕES)
 * =====================================================
 * Cria um novo movimento financeiro de SAÍDA
 * NÃO altera o recebimento original
 * Totalmente auditável e reversível
 */

function apiEstornarRecebimento(payload) {
  if (!payload || !payload.idRecebimento || !payload.valor) {
    throw new Error('Payload inválido para estorno');
  }

  return estornarRecebimento(
    payload.idRecebimento,
    Number(payload.valor),
    payload.motivo || 'Estorno manual'
  );
}

function estornarRecebimento(idRecebimento, valorEstorno, motivo) {
  exigirAcao('eventos:estornarRecebimento');
  return executarComLockFinanceiro_('ESTORNO_RECEBIMENTO', function () {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    const usuario = getUsuarioAtual().email;

    if (!idRecebimento || valorEstorno <= 0) {
      throw new Error('Dados inválidos para estorno');
    }

    const data = sh.getDataRange().getValues();
    const head = data.shift();
    const c = name => head.indexOf(name);

    const receb = data.find(r =>
      String(r[c('ID_MOVIMENTACAO')]) === String(idRecebimento) &&
      r[c('NATUREZA')] === 'ENTRADA'
    );

    if (!receb) {
      throw new Error('Recebimento não encontrado ou inválido');
    }

    const idEvento = receb[c('ID_EVENTO')];
    const valorOriginal = Number(receb[c('VALOR')]) || 0;

    if (valorEstorno > valorOriginal) {
      throw new Error('Valor de estorno maior que o valor recebido');
    }

    const linhaEstorno = [
      gerarIDMovimentacao(),
      'ESTORNO_RECEBIMENTO',
      'SAÍDA',
      idEvento,
      receb[c('NOME_EVENTO')],
      normalizarData(new Date()),
      valorEstorno,
      '',
      receb[c('CONTRAPARTE')],
      receb[c('ID_CONTRAPARTE')],
      '',
      `Estorno de ${idRecebimento} | Motivo: ${motivo}`,
      usuario,
      new Date(),
      '',
      'PROCESSADO'
    ];

    appendRowComVerificacao_(sh, linhaEstorno, 'MOVIMENTACOES_FINANCEIRAS/ESTORNO_RECEBIMENTO');

    // Atualiza resumo financeiro do evento
    atualizarResumoFinanceiroEvento(idEvento);

    return {
      sucesso: true,
      mensagem: 'Estorno registrado com sucesso',
      idEstorno: linhaEstorno[0]
    };
  });
}

function atualizarResumoFinanceiroEvento(idEvento) {
  const ss = SpreadsheetApp.getActive();
  const shEvt = ss.getSheetByName('EVENTOS');
  const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');

  const evt = shEvt.getDataRange().getValues();
  const evtHead = evt.shift();
  const e = c => evtHead.indexOf(c);

  const evtIdx = evt.findIndex(r => r[e('ID_EVENTO')] === idEvento);
  if (evtIdx === -1) return;

  const mov = shMov.getDataRange().getValues();
  const movHead = mov.shift();
  const m = c => movHead.indexOf(c);

  const receb = mov.filter(r =>
    r[m('ID_EVENTO')] === idEvento &&
    r[m('NATUREZA')] === 'ENTRADA' &&
    r[m('STATUS')] !== 'CANCELADO'
  );

  const totalRecebido = receb.reduce((s, r) => s + (Number(r[m('VALOR')]) || 0), 0);
  const valorTotal = Number(evt[evtIdx][e('VALOR_TOTAL')]) || 0;
  const pendente = valorTotal - totalRecebido;

  let status = 'EM_ABERTO';
  if (totalRecebido > 0 && pendente > 0) status = 'PARCIAL';
  if (pendente <= 0) status = 'QUITADO';

  const row = evtIdx + 2;
  shEvt.getRange(row, e('VALOR_RECEBIDO') + 1).setValue(totalRecebido);
  shEvt.getRange(row, e('VALOR_PENDENTE') + 1).setValue(pendente);
  shEvt.getRange(row, e('STATUS_RECEBIMENTO') + 1).setValue(status);
}

/**
 * Busca recebimento pelo ID_MOVIMENTACAO
 * USADO NO PREVIEW DO FECHAMENTO
 * 🔒 NÃO MEXER — função crítica de auditoria
 */
function buscarRecebimentoPorId_(idMov) {
  if (!idMov) return null;

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  if (!sh) return null;

  const data = sh.getDataRange().getValues();
  const head = data.shift();

  const c = name => head.indexOf(name);

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][c('ID_MOVIMENTACAO')]) === String(idMov)) {

  // Garante que é recebimento válido
  if (data[i][c('NATUREZA')] !== 'ENTRADA') return null;

  const valor = Number(data[i][c('VALOR')]);

  return {
    data: normalizarData(data[i][c('DATA_MOVIMENTACAO')]),
    valor: isNaN(valor) ? 0 : valor
  };
}
  }

  return null;
}

function lerSaudeFinanceiraEvento(idEvento) {
  exigirAcao('eventos:visualizarFinanceiro');
  if (!idEvento) throw new Error('ID do evento não informado');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetEventos = ss.getSheetByName('EVENTOS');
  const sheetMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');

  if (!sheetEventos || !sheetMov) {
    throw new Error('Planilhas necessárias não encontradas');
  }

  // =========================
  // 1) BUSCAR EVENTO
  // =========================
  const eventos = sheetEventos.getDataRange().getValues();
  let evento = null;

  for (let i = 1; i < eventos.length; i++) {
    if (String(eventos[i][COL.ID_EVENTO]) === String(idEvento)) {
      evento = eventos[i];
      break;
    }
  }

  if (!evento) throw new Error('Evento não encontrado');

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  // DATA_EVENTO vem como DD/MM/YYYY
  let dataEvento = null;
  const rawDataEvento = evento[COL.DATA_EVENTO];

  if (rawDataEvento instanceof Date) {
    dataEvento = normalizarData(rawDataEvento);
  } else if (typeof rawDataEvento === 'string' && rawDataEvento.includes('/')) {
    const partes = rawDataEvento.split('/');
    const dia = Number(partes[0]);
    const mes = Number(partes[1]) - 1;
    const ano = Number(partes[2]);
    dataEvento = normalizarData(new Date(ano, mes, dia));
  }

  const eventoJaOcorreu = dataEvento ? dataEvento < hoje : false;

  const valorTotal = Number(evento[COL.VALOR_TOTAL]) || 0;
  const valorRecebidoEvento = Number(evento[COL.VALOR_RECEBIDO]) || 0;
  const valorBV = Number(evento[COL.VALOR_BV]) || 0;
  const valorNF = Number(evento[COL.VALOR_NF]) || 0;
  const temNF = evento[COL.TEM_NF] === true;
  const statusEvento = evento[COL.STATUS_GERAL] || 'ATIVO';

  // =========================
  // 2) LER MOVIMENTAÇÕES
  // =========================
  const movs = sheetMov.getDataRange().getValues();

  let totalRecebido = 0;
  let bvPago = false;
  let folhaExiste = false;

  for (let i = 1; i < movs.length; i++) {
    if (String(movs[i][3]) !== String(idEvento)) continue;

    const tipo = movs[i][1];
    const status = movs[i][15];
    const valor = Number(movs[i][6]) || 0;

    if (tipo === 'RECEBIMENTO_CLIENTE' && status === 'PROCESSADO') {
      totalRecebido += valor;
    }

    if (tipo === 'BV_EVENTO' && status === 'PROCESSADO') {
      bvPago = true;
    }

    if (tipo === 'FOLHA_EVENTO') {
      folhaExiste = true;
    }
  }

  const valorPendenteReceber = Math.max(0, valorTotal - totalRecebido);

  // =========================
  // 3) ALERTAS
  // =========================
  const alertas = [];

  // Inconsistência grave
  if (totalRecebido > valorTotal) {
    alertas.push('INCONSISTENCIA_RECEBIDO_MAIOR_QUE_CONTRATO');
  }

  if (statusEvento === 'CANCELADO' && totalRecebido > 0) {
    alertas.push('EVENTO_CANCELADO_COM_RECEBIMENTO');
  }

  // Pendências
  if (eventoJaOcorreu && totalRecebido === 0 && valorTotal > 0) {
    alertas.push('EVENTO_OCORREU_SEM_RECEBIMENTO');
  }

  if (eventoJaOcorreu && totalRecebido > 0 && valorPendenteReceber > 0) {
    alertas.push('EVENTO_OCORREU_RECEBIMENTO_PARCIAL');
  }

  if (valorBV > 0 && !bvPago) {
    alertas.push('BV_PENDENTE');
  }

  if (eventoJaOcorreu && !folhaExiste) {
    alertas.push('FOLHA_NAO_REGISTRADA');
  }

  // =========================
  // 3.1) COMISSÃO DO VENDEDOR
  // =========================
  let comissao = null;
  try {
    comissao = lerComissaoEvento(idEvento);
  } catch (e) {
    comissao = null;
  }

  if (comissao && comissao.existe) {
    // Comissão gerada mas não totalmente paga
    if (['AGUARDANDO', 'PARCIAL', 'PENDENTE'].includes(comissao.status)) {
      alertas.push('COMISSAO_PENDENTE');
    }

    // Inconsistência grave de comissão
    if (comissao.status === 'ERRO') {
      alertas.push('COMISSAO_INCONSISTENTE');
    }
  }

  // =========================
  // 4) CLASSIFICAÇÃO FINAL
  // =========================
  let status = 'ok';

  const errosCriticos = [
    'INCONSISTENCIA_RECEBIDO_MAIOR_QUE_CONTRATO',
    'EVENTO_CANCELADO_COM_RECEBIMENTO',
    'COMISSAO_INCONSISTENTE'
  ];

  if (alertas.some(a => errosCriticos.includes(a))) {
    status = 'erro';
  } else if (alertas.length > 0) {
    status = 'alerta';
  }

  // =========================
  // 5) AÇÕES
  // =========================
  const acoes = {
    podeReceber: valorPendenteReceber > 0 && statusEvento === 'ATIVO',
    podePagarBV: valorBV > 0 && !bvPago,
    podeRegistrarFolha: eventoJaOcorreu && !folhaExiste
  };

  // =========================
  // 6) RETORNO
  // =========================
  return {
    idEvento: evento[COL.ID_EVENTO],
    nomeEvento: `${evento[COL.TIPO_EVENTO]} - ${evento[COL.NOME_CONTRATANTE]}`,
    dataEvento: evento[COL.DATA_EVENTO],
    statusEvento,

    status, // ok | alerta | erro
    alertas,

    resumoFinanceiro: {
      valorContrato: valorTotal,
      totalRecebido,
      valorPendente: valorPendenteReceber,
      statusRecebimento:
        totalRecebido === 0
          ? 'ABERTO'
          : totalRecebido < valorTotal
          ? 'PARCIAL'
          : 'QUITADO'
    },

    custos: {
      nf: {
        existe: temNF,
        valor: valorNF,
        status: temNF ? 'PROCESSADO' : 'NA'
      },
      bv: {
        existe: valorBV > 0,
        valor: valorBV,
        status: valorBV > 0 ? (bvPago ? 'PROCESSADO' : 'PENDENTE') : 'NA'
      },
      folha: {
        existe: folhaExiste
      }
    },

    acoes
  };
}

function listarEventosFinanceiros() {
  exigirAcao('eventos:visualizarFinanceiro');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetEventos = ss.getSheetByName('EVENTOS');
  const sheetMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');

  if (!sheetEventos || !sheetMov) {
    throw new Error('Aba EVENTOS ou MOVIMENTACOES_FINANCEIRAS não encontrada');
  }

  // 🔹 Leitura ÚNICA das planilhas
  const eventosData = sheetEventos.getDataRange().getValues();
  const movData = sheetMov.getDataRange().getValues();

  const lista = [];

  for (let i = 1; i < eventosData.length; i++) {
    const linha = eventosData[i];
    const idEvento = linha[COL.ID_EVENTO];
    const statusEvento = linha[COL.STATUS_GERAL];
    const tipoRegistro = linha[COL.TIPO_REGISTRO];

    // 🔒 Apenas eventos reais
    if (tipoRegistro !== 'Evento') continue;
    if (!idEvento) continue;
    if (!['ATIVO', 'CANCELADO'].includes(statusEvento)) continue;

    try {
      // =========================
      // SAÚDE FINANCEIRA (IN-MEMORY)
      // =========================
      const leitura = lerSaudeFinanceiraEvento_(
        idEvento,
        eventosData,
        movData
      );

      if (!leitura || !leitura.resumoFinanceiro) continue;

      // =========================
      // COMISSÃO (IN-MEMORY)
      // =========================
      let comissao = null;
      try {
        comissao = lerComissaoEvento_(
          idEvento,
          eventosData,
          movData
        );
      } catch (e) {
        Logger.log(`⚠️ Comissão não lida para ${idEvento}: ${e.message}`);
      }

      lista.push({
        idEvento: leitura.idEvento,
        nomeEvento: leitura.nomeEvento,
        dataEvento: leitura.dataEvento,
        statusEvento: leitura.statusEvento,

        // 🔍 Resumo financeiro
        valorContrato: leitura.resumoFinanceiro.valorContrato,
        totalRecebido: leitura.resumoFinanceiro.totalRecebido,
        valorPendente: leitura.resumoFinanceiro.valorPendente,
        statusRecebimento: leitura.resumoFinanceiro.statusRecebimento,

        // 💸 Custos
        nf: leitura.custos.nf,
        bv: leitura.custos.bv,
        folha: leitura.custos.folha,

        // 🚨 Alertas & ações
        alertas: leitura.alertas,
        acoes: leitura.acoes,
        status: leitura.status,
        comissao
      });

    } catch (erro) {
      Logger.log(`⚠️ Erro ao ler evento ${idEvento}: ${erro.message}`);
      lista.push({
        idEvento,
        erro: true,
        mensagemErro: erro.message
      });
    }
  }

  // =========================
  // ORDENAÇÃO
  // =========================
  lista.sort((a, b) => {
    const aAlertas = a.alertas?.length || 0;
    const bAlertas = b.alertas?.length || 0;

    if (aAlertas !== bAlertas) {
      return bAlertas - aAlertas;
    }

    const dataA = normalizarData(a.dataEvento);
    const dataB = normalizarData(b.dataEvento);

    if (dataA && dataB) {
      return dataA - dataB;
    }

    return 0;
  });

  return lista;
}

function lerSaudeFinanceiraEvento_(idEvento, eventosData, movData) {
  const evento = eventosData.find(r => String(r[COL.ID_EVENTO]) === String(idEvento));
  if (!evento) throw new Error('Evento não encontrado');

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  let dataEvento = null;
  const rawDataEvento = evento[COL.DATA_EVENTO];

  if (rawDataEvento instanceof Date) {
    dataEvento = normalizarData(rawDataEvento);
  } else if (typeof rawDataEvento === 'string' && rawDataEvento.includes('/')) {
    const [d, m, a] = rawDataEvento.split('/');
    dataEvento = normalizarData(new Date(a, m - 1, d));
  }

  const eventoJaOcorreu = dataEvento ? dataEvento < hoje : false;

  const valorTotal = Number(evento[COL.VALOR_TOTAL]) || 0;
  const valorBV = Number(evento[COL.VALOR_BV]) || 0;
  const valorNF = Number(evento[COL.VALOR_NF]) || 0;
  const temNF = evento[COL.TEM_NF] === true;
  const statusEvento = evento[COL.STATUS_GERAL] || 'ATIVO';

  let totalRecebido = 0;
  let bvPago = false;
  let folhaExiste = false;

  for (let i = 1; i < movData.length; i++) {
    if (String(movData[i][3]) !== String(idEvento)) continue;

    const tipo = movData[i][1];
    const status = movData[i][15];
    const valor = Number(movData[i][6]) || 0;

    if (tipo === 'RECEBIMENTO_CLIENTE' && status === 'PROCESSADO') {
      totalRecebido += valor;
    }
    if (tipo === 'BV_EVENTO' && status === 'PROCESSADO') {
      bvPago = true;
    }
    if (tipo === 'FOLHA_EVENTO') {
      folhaExiste = true;
    }
  }

  const pendente = Math.max(0, valorTotal - totalRecebido);

  const alertas = [];
  if (eventoJaOcorreu && totalRecebido === 0 && valorTotal > 0) {
    alertas.push('EVENTO_OCORREU_SEM_RECEBIMENTO');
  }
  if (valorBV > 0 && !bvPago) {
    alertas.push('BV_PENDENTE');
  }
  if (eventoJaOcorreu && !folhaExiste) {
    alertas.push('FOLHA_NAO_REGISTRADA');
  }

  let status = 'ok';
  if (alertas.length > 0) status = 'alerta';

  return {
    idEvento: evento[COL.ID_EVENTO],
    nomeEvento: `${evento[COL.TIPO_EVENTO]} - ${evento[COL.NOME_CONTRATANTE]}`,
    dataEvento: evento[COL.DATA_EVENTO],
    statusEvento,
    status,
    alertas,
    resumoFinanceiro: {
      valorContrato: valorTotal,
      totalRecebido,
      valorPendente: pendente,
      statusRecebimento:
        totalRecebido === 0 ? 'ABERTO' :
        totalRecebido < valorTotal ? 'PARCIAL' : 'QUITADO'
    },
    custos: {
      nf: { existe: temNF, valor: valorNF, status: temNF ? 'PROCESSADO' : 'NA' },
      bv: { existe: valorBV > 0, valor: valorBV, status: valorBV > 0 ? (bvPago ? 'PROCESSADO' : 'PENDENTE') : 'NA' },
      folha: { existe: folhaExiste }
    },
    acoes: {
      podeReceber: pendente > 0 && statusEvento === 'ATIVO',
      podePagarBV: valorBV > 0 && !bvPago,
      podeRegistrarFolha: eventoJaOcorreu && !folhaExiste
    }
  };
}

function lerComissaoEvento_(idEvento, eventosData, movData) {
  const evento = eventosData.find(r => String(r[COL.ID_EVENTO]) === String(idEvento));
  if (!evento) throw new Error('Evento não encontrado');

  const esperado = Number(evento[COL.VALOR_COMISSAO_CALCULADO]) || 0;

  let gerado = 0;
  let pago = 0;

  for (let i = 1; i < movData.length; i++) {
    if (
      movData[i][1] === 'COMISSAO_GERADA' &&
      String(movData[i][3]) === String(idEvento) &&
      movData[i][15] !== 'CANCELADO'
    ) {
      const valor = Number(movData[i][6]) || 0;
      gerado += valor;
      if (movData[i][15] === 'PROCESSADO') {
        pago += valor;
      }
    }
  }

  const pendente = Math.max(gerado - pago, 0);

  const status = determinarStatusComissao_(esperado, gerado, pago, pendente);

  return {
    existe: esperado > 0,
    valores: { esperado, gerado, pago, pendente },
    status,
    alertas: [],
    acoes: {
      podeFechar: gerado > pago,
      podeRecalcular: false,
      bloqueiaEdicao: false
    }
  };
}

/**
 * =====================================================
 * LEITURA CONSOLIDADA DA COMISSÃO DO EVENTO
 * NÃO CRIA | NÃO RECALCULA | NÃO ALTERA
 * =====================================================
 */
function lerComissaoEvento(idEvento) {
  if (!idEvento) throw new Error('ID do evento não informado');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shEvt = ss.getSheetByName('EVENTOS');
  const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');

  if (!shEvt || !shMov) {
    throw new Error('Planilhas EVENTOS ou MOVIMENTACOES_FINANCEIRAS não encontradas');
  }

  const evtData = shEvt.getDataRange().getValues();
  const evtHead = evtData[0];
  const e = c => evtHead.indexOf(c);

  const evtRow = evtData.find(r => String(r[e('ID_EVENTO')]) === String(idEvento));
  if (!evtRow) throw new Error('Evento não encontrado');

  const idVendedor = evtRow[e('ID_VENDEDOR')];
  const vendedor = buscarVendedor(idVendedor);

  const esperado = Number(evtRow[e('VALOR_COMISSAO_CALCULADO')]) || 0;
  const statusRecebimento = evtRow[e('STATUS_RECEBIMENTO')] || 'EM_ABERTO';

  // =====================================================
  // LEITURA DAS COMISSÕES GERADAS
  // =====================================================
  const movData = shMov.getDataRange().getValues();
  const movHead = movData[0];
  const m = c => movHead.indexOf(c);

  let gerado = 0;
  let pago = 0;

  for (let i = 1; i < movData.length; i++) {
    const row = movData[i];

    if (
      row[m('TIPO_MOVIMENTACAO')] === 'COMISSAO_GERADA' &&
      String(row[m('ID_EVENTO')]) === String(idEvento) &&
      row[m('STATUS')] !== 'CANCELADO'
    ) {
      const valor = Number(row[m('VALOR')]) || 0;
      gerado += valor;

      if (row[m('STATUS')] === 'PROCESSADO') {
        pago += valor;
      }
    }
  }

  gerado = Number(gerado.toFixed(2));
  pago = Number(pago.toFixed(2));
  const pendente = Number(Math.max(gerado - pago, 0).toFixed(2));

  // =====================================================
  // STATUS DA COMISSÃO
  // =====================================================
  const status = determinarStatusComissao_(esperado, gerado, pago, pendente);

  // =====================================================
  // ALERTAS
  // =====================================================
  const alertas = [];

  if (statusRecebimento === 'QUITADO' && pendente > 0) {
    alertas.push('COMISSAO_NAO_PAGA_APOS_QUITACAO');
  }

  if (pago > esperado) {
    alertas.push('COMISSAO_PAGA_MAIOR_QUE_ESPERADO');
  }

  if (gerado > esperado) {
    alertas.push('COMISSAO_GERADA_MAIOR_QUE_ESPERADO');
  }

  // =====================================================
  // AÇÕES / BLOQUEIOS
  // =====================================================
  const acoes = {
    podeFechar: gerado > pago,
    podeRecalcular: false, // somente auditoria manual
    bloqueiaEdicao:
      statusRecebimento === 'QUITADO' && pendente > 0
  };

  // =====================================================
  // RETORNO FINAL (CONTRATO OFICIAL)
  // =====================================================
  return {
    existe: esperado > 0,

    vendedor: vendedor
      ? { id: idVendedor, nome: vendedor.nome }
      : { id: idVendedor, nome: 'N/A' },

    valores: {
      esperado,
      gerado,
      pago,
      pendente
    },

    status, // NA | AGUARDANDO | PARCIAL | PENDENTE | QUITADO | ERRO

    alertas,

    acoes
  };
}

/**
 * =====================================================
 * DIAGNÓSTICO DE INTEGRIDADE FINANCEIRA (SOMENTE LEITURA)
 * Não altera dados; apenas aponta divergências para reconciliação manual.
 * =====================================================
 */
function diagnosticarIntegridadeFinanceira(params) {
  exigirAcao('eventos:visualizarFinanceiro');

  const limite = Math.max(1, Math.min(Number((params && params.limit) || 200), 2000));
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shEvt = ss.getSheetByName('EVENTOS');
  const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');

  if (!shEvt || !shMov) {
    throw new Error('Planilhas EVENTOS ou MOVIMENTACOES_FINANCEIRAS não encontradas');
  }

  const evtData = shEvt.getDataRange().getValues();
  const movData = shMov.getDataRange().getValues();
  if (evtData.length < 2) {
    return {
      sucesso: true,
      resumo: { eventosAnalisados: 0, divergencias: 0 },
      divergencias: []
    };
  }

  const evtHead = evtData[0];
  const movHead = movData[0];
  const e = function (c) { return evtHead.indexOf(c); };
  const m = function (c) { return movHead.indexOf(c); };

  const colunasObrigatoriasEventos = [
    'ID_EVENTO',
    'VALOR_RECEBIDO',
    'VALOR_PENDENTE',
    'VALOR_TOTAL',
    'VALOR_COMISSAO_PAGO',
    'VALOR_COMISSAO_CALCULADO',
    'STATUS_COMISSAO'
  ];
  const colunasObrigatoriasMov = [
    'TIPO_MOVIMENTACAO',
    'STATUS',
    'ID_EVENTO',
    'ID_CONTRAPARTE',
    'VALOR'
  ];

  for (let i = 0; i < colunasObrigatoriasEventos.length; i++) {
    if (e(colunasObrigatoriasEventos[i]) === -1) {
      throw new Error('Coluna obrigatória não encontrada em EVENTOS: ' + colunasObrigatoriasEventos[i]);
    }
  }
  for (let j = 0; j < colunasObrigatoriasMov.length; j++) {
    if (m(colunasObrigatoriasMov[j]) === -1) {
      throw new Error('Coluna obrigatória não encontrada em MOVIMENTACOES_FINANCEIRAS: ' + colunasObrigatoriasMov[j]);
    }
  }

  const mapaMov = {};
  for (let i = 1; i < movData.length; i++) {
    const row = movData[i];
    const idEvento = String(row[m('ID_EVENTO')] || '').trim();
    if (!idEvento) continue;

    if (!mapaMov[idEvento]) {
      mapaMov[idEvento] = {
        recebidoLiquido: 0,
        comissaoGeradaPorVendedor: {},
        comissaoPagaPorVendedor: {}
      };
    }

    const tipo = String(row[m('TIPO_MOVIMENTACAO')] || '');
    const status = String(row[m('STATUS')] || '');
    const valor = Number(row[m('VALOR')]) || 0;
    const idVendedor = String(row[m('ID_CONTRAPARTE')] || '').trim();

    if (status === 'CANCELADO') continue;

    if (tipo === 'RECEBIMENTO_CLIENTE' && status === 'PROCESSADO') {
      mapaMov[idEvento].recebidoLiquido += valor;
    } else if (tipo === 'ESTORNO_RECEBIMENTO' && status === 'PROCESSADO') {
      mapaMov[idEvento].recebidoLiquido -= valor;
    } else if (tipo === 'COMISSAO_GERADA') {
      if (!mapaMov[idEvento].comissaoGeradaPorVendedor[idVendedor]) {
        mapaMov[idEvento].comissaoGeradaPorVendedor[idVendedor] = 0;
      }
      mapaMov[idEvento].comissaoGeradaPorVendedor[idVendedor] += valor;

      if (status === 'PROCESSADO') {
        if (!mapaMov[idEvento].comissaoPagaPorVendedor[idVendedor]) {
          mapaMov[idEvento].comissaoPagaPorVendedor[idVendedor] = 0;
        }
        mapaMov[idEvento].comissaoPagaPorVendedor[idVendedor] += valor;
      }
    }
  }

  const divergencias = [];
  const tolerancia = 0.01;

  for (let i = 1; i < evtData.length; i++) {
    const row = evtData[i];
    const idEvento = String(row[e('ID_EVENTO')] || '').trim();
    if (!idEvento) continue;

    const idVendedor = String(row[e('ID_VENDEDOR')] || '').trim();
    const valorTotal = Number(row[e('VALOR_TOTAL')]) || 0;
    const valorRecebidoEspelho = Number(row[e('VALOR_RECEBIDO')]) || 0;
    const valorPendenteEspelho = Number(row[e('VALOR_PENDENTE')]) || 0;
    const valorComissaoPagaEspelho = Number(row[e('VALOR_COMISSAO_PAGO')]) || 0;
    const valorComissaoEsperada = Number(row[e('VALOR_COMISSAO_CALCULADO')]) || 0;
    const statusComissaoEspelho = String(row[e('STATUS_COMISSAO')] || '');

    const mov = mapaMov[idEvento] || {
      recebidoLiquido: 0,
      comissaoGeradaPorVendedor: {},
      comissaoPagaPorVendedor: {}
    };

    const recebidoCalculado = Number((mov.recebidoLiquido || 0).toFixed(2));
    const pendenteCalculado = Number(Math.max(valorTotal - recebidoCalculado, 0).toFixed(2));
    const comissaoGerada = Number((mov.comissaoGeradaPorVendedor[idVendedor] || 0).toFixed(2));
    const comissaoPaga = Number((mov.comissaoPagaPorVendedor[idVendedor] || 0).toFixed(2));
    const comissaoPendente = Number(Math.max(comissaoGerada - comissaoPaga, 0).toFixed(2));
    const statusEsperado = determinarStatusComissao_(
      Number(valorComissaoEsperada.toFixed(2)),
      comissaoGerada,
      comissaoPaga,
      comissaoPendente
    );

    if (Math.abs(valorRecebidoEspelho - recebidoCalculado) > tolerancia) {
      divergencias.push({
        idEvento: idEvento,
        tipo: 'VALOR_RECEBIDO_DIVERGENTE',
        esperado: recebidoCalculado,
        atual: Number(valorRecebidoEspelho.toFixed(2))
      });
    }

    if (Math.abs(valorPendenteEspelho - pendenteCalculado) > tolerancia) {
      divergencias.push({
        idEvento: idEvento,
        tipo: 'VALOR_PENDENTE_DIVERGENTE',
        esperado: pendenteCalculado,
        atual: Number(valorPendenteEspelho.toFixed(2))
      });
    }

    if (Math.abs(valorComissaoPagaEspelho - comissaoPaga) > tolerancia) {
      divergencias.push({
        idEvento: idEvento,
        tipo: 'VALOR_COMISSAO_PAGO_DIVERGENTE',
        esperado: comissaoPaga,
        atual: Number(valorComissaoPagaEspelho.toFixed(2))
      });
    }

    if (statusComissaoEspelho !== statusEsperado) {
      divergencias.push({
        idEvento: idEvento,
        tipo: 'STATUS_COMISSAO_DIVERGENTE',
        esperado: statusEsperado,
        atual: statusComissaoEspelho || 'N/A'
      });
    }

    if (divergencias.length >= limite) break;
  }

  return {
    sucesso: true,
    resumo: {
      eventosAnalisados: evtData.length - 1,
      divergencias: divergencias.length,
      truncadoNoLimite: divergencias.length >= limite
    },
    divergencias: divergencias
  };
}
