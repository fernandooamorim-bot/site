

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

function alertaEhSomenteInformativo_(codigo) {
  return String(codigo || '').trim() === 'INCONSISTENCIA_RECEBIDO_MAIOR_QUE_CONTRATO';
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

  const valorTotal = normalizarValorMonetario_(dados.valorTotal, { allowZero: true }) || 0;
  const temNF = dados.temNF === true;
  const valorBV = normalizarValorMonetario_(dados.valorBV, { allowZero: true }) || 0;

  const percentualNF = normalizarNumeroEntrada_(dados.percentualNF, { decimals: 4, allowNegative: false, allowZero: true }) || 0;
  const percentualComissaoPadrao = normalizarNumeroEntrada_(dados.comissaoValor, { decimals: 4, allowNegative: false, allowZero: true }) || 0;

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
  // Comissão de evento novo só vira PENDENTE após existir COMISSAO_GERADA.
  const statusComissao =
    valorComissaoCalculado > 0 ? 'AGUARDANDO' : 'N/A';

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

function statusFinanceiroNormalizado_(status) {
  return String(status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function resolverProcessadoPorFinanceiro_(origemSistema) {
  try {
    const usuario = getUsuarioAtual();
    const email = String(
      (usuario && (usuario.email || usuario.EMAIL)) ||
      globalThis.REQUEST_EMAIL ||
      ''
    ).trim().toLowerCase();
    if (email) return email;
  } catch (_) {}

  const requestEmail = String(globalThis.REQUEST_EMAIL || '').trim().toLowerCase();
  if (requestEmail) return requestEmail;

  const origem = String(origemSistema || '').trim().toUpperCase();
  if (!origem) return 'SISTEMA:AUTOMACAO';
  if (origem.indexOf('ASAAS') !== -1) return 'SISTEMA:ASAAS_WEBHOOK';
  if (origem.indexOf('WOOVI') !== -1 || origem.indexOf('OPENPIX') !== -1) return 'SISTEMA:WOOVI_WEBHOOK';
  if (origem.indexOf('RECONCILI') !== -1) return 'SISTEMA:RECONCILIACAO';
  return 'SISTEMA:' + origem.replace(/[^A-Z0-9_]+/g, '_');
}

function resumirSaidasMovEvento_(movData, m, idEvento) {
  const resumo = {
    bv: { processado: 0, pendente: 0, total: 0 },
    nf: { processado: 0, pendente: 0, total: 0 },
    folha: { processado: 0, total: 0 }
  };

  for (let i = 1; i < movData.length; i++) {
    if (String(movData[i][m('ID_EVENTO')] || '').trim() !== String(idEvento)) continue;

    const tipo = String(movData[i][m('TIPO_MOVIMENTACAO')] || '').trim();
    const status = statusFinanceiroNormalizado_(movData[i][m('STATUS')]);
    if (status === 'CANCELADO') continue;

    if (tipo === 'BV_EVENTO') {
      resumo.bv.total += 1;
      if (status === 'PROCESSADO') resumo.bv.processado += 1;
      else if (status === 'PENDENTE') resumo.bv.pendente += 1;
    } else if (tipo === 'NF_EVENTO') {
      resumo.nf.total += 1;
      if (status === 'PROCESSADO') resumo.nf.processado += 1;
      else if (status === 'PENDENTE') resumo.nf.pendente += 1;
    } else if (tipo === 'FOLHA_EVENTO') {
      resumo.folha.total += 1;
      if (status === 'PROCESSADO') resumo.folha.processado += 1;
    }
  }

  return resumo;
}

/**
 * Registro de NF do evento (valor vem do EVENTO)
 */
function registrarNFEvento(idEvento, meta) {
  exigirAcao('eventos:registrarSaida');
  return executarComLockFinanceiro_('NF_EVENTO', function () {
    const ss = SpreadsheetApp.getActive();
    const shEvt = ss.getSheetByName('EVENTOS');
    const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    const usuario = resolverProcessadoPorFinanceiro_(meta && meta.origemProcessamento);
    const linkComprovante = String((meta && meta.linkComprovante) || '').trim();
    const observacoesExtra = String((meta && meta.observacoes) || '').trim();

    const evt = shEvt.getDataRange().getValues();
    const head = evt[0];
    const e = c => head.indexOf(c);
    const movData = shMov.getDataRange().getValues();
    const movHead = movData[0];
    const m = c => movHead.indexOf(c);

    for (let i = 1; i < evt.length; i++) {
      if (evt[i][e('ID_EVENTO')] !== idEvento) continue;

      const resumoMov = resumirSaidasMovEvento_(movData, m, idEvento);
      if (resumoMov.nf.processado > 0) {
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
  exigirPermissaoSaidaBV_();
  return executarComLockFinanceiro_('BV_EVENTO', function () {
    const ss = SpreadsheetApp.getActive();
    const shEvt = ss.getSheetByName('EVENTOS');
    const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    const usuario = resolverProcessadoPorFinanceiro_(meta && meta.origemProcessamento);
    const linkComprovante = String((meta && meta.linkComprovante) || '').trim();
    const observacoesExtra = String((meta && meta.observacoes) || '').trim();

    const evt = shEvt.getDataRange().getValues();
    const head = evt[0];
    const e = c => head.indexOf(c);
    const movData = shMov.getDataRange().getValues();
    const movHead = movData[0];
    const m = c => movHead.indexOf(c);

    for (let i = 1; i < evt.length; i++) {
      if (evt[i][e('ID_EVENTO')] !== idEvento) continue;

      const resumoMov = resumirSaidasMovEvento_(movData, m, idEvento);
      if (resumoMov.bv.processado > 0) {
        throw new Error('BV já processado para este evento');
      }

      const valorManual = normalizarValorMonetario_(meta && meta.valor, { allowZero: false });
      const valorBV = !isNaN(valorManual) && valorManual > 0
        ? Number(valorManual.toFixed(2))
        : (Number(evt[i][e('VALOR_BV')]) || 0);
      if (valorBV <= 0) throw new Error('Evento não possui BV válido');
      const tipoEvento = String(evt[i][e('TIPO_EVENTO')] || '').trim();
      const nomeContratante = String(evt[i][e('NOME_CONTRATANTE')] || '').trim();
      const nomePadraoEvento = ((tipoEvento ? (tipoEvento + ' - ') : '') + nomeContratante).trim();
      const nomeEventoMov = String(evt[i][e('NOME_EVENTO')] || '').trim() || nomePadraoEvento || idEvento;
      const parceiro = resolverParceiroBVEvento_(evt[i], e);
      const origemProcessamento = detectarOrigemProcessamentoBV_(meta);
      const obsDestino = montarObsDestinoBVParceiro_(parceiro, origemProcessamento);

      const idMovimentacao = gerarIDMovimentacao();
      const dataSaida = (meta && meta.dataSaida) ? normalizarData(meta.dataSaida) : normalizarData(new Date());
      const linhaMov = [
        idMovimentacao,
        'BV_EVENTO',
        'SAÍDA',
        idEvento,
        nomeEventoMov,
        dataSaida,
        valorBV,
        '',
        String(parceiro.nome || 'BV'),
        String(parceiro.id || ''),
        linkComprovante,
        (observacoesExtra || 'BV registrada automaticamente pelo sistema') + obsDestino,
        usuario,
        new Date(),
        '',
        'PROCESSADO'
      ];

      appendRowComVerificacao_(shMov, linhaMov, 'MOVIMENTACOES_FINANCEIRAS/BV_EVENTO');
      setValueComVerificacao_(shEvt, i + 1, e('VALOR_BV') + 1, valorBV, 'EVENTOS/VALOR_BV');
      setValueComVerificacao_(shEvt, i + 1, e('STATUS_BV') + 1, 'PROCESSADO', 'EVENTOS/STATUS_BV');
      return { sucesso: true, idMovimentacao: idMovimentacao };
    }

    throw new Error('Evento não encontrado');
  });
}

function exigirPermissaoSaidaBV_() {
  try {
    return exigirAcao('eventos:registrarSaidaBV');
  } catch (err) {
    // Compatibilidade com fluxos antigos que ainda usam permissão ampla de saída.
    const msg = String(err && err.message ? err.message : '');
    if (msg.indexOf('FORBIDDEN_ACTION') === 0) {
      return exigirAcao('eventos:registrarSaida');
    }
    throw err;
  }
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
    const usuario = resolverProcessadoPorFinanceiro_('MANUAL_FOLHA_EVENTO');

    const evt = shEvt.getDataRange().getValues();
    const head = evt[0];
    const e = c => head.indexOf(c);
    const movData = shMov.getDataRange().getValues();
    const movHead = movData[0];
    const m = c => movHead.indexOf(c);

    for (let i = 1; i < evt.length; i++) {
      if (evt[i][e('ID_EVENTO')] !== idEvento) continue;

      // Monta nome padrão do evento: TIPO_EVENTO + ' ' + NOME_CONTRATANTE
      const tipoEvento = evt[i][e('TIPO_EVENTO')] || '';
      const nomeContratante = evt[i][e('NOME_CONTRATANTE')] || '';
      const nomePadraoEvento = (tipoEvento + ' ' + nomeContratante).trim();

      // BLOQUEIO DEFINITIVO: folha é lançamento ÚNICO (fonte: MOVIMENTACOES)
      const resumoMov = resumirSaidasMovEvento_(movData, m, idEvento);
      if (resumoMov.folha.processado > 0) {
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

function aprovarFolhaEventoComRevisao(dados) {
  exigirAcao('eventos:registrarSaida');
  const idEvento = String((dados && dados.idEvento) || '').trim();
  const valor = normalizarValorMonetario_(dados && dados.valor, { allowZero: false });
  const descricao = String((dados && dados.descricao) || '').trim();
  const referencia = String((dados && dados.referencia) || '').trim();

  if (!idEvento) throw new Error('ID_EVENTO_OBRIGATORIO');
  if (!(valor > 0)) throw new Error('VALOR_FOLHA_INVALIDO');

  return executarComLockFinanceiro_('FOLHA_EVENTO_REVISAO', function () {
    const ss = SpreadsheetApp.getActive();
    const shEvt = ss.getSheetByName('EVENTOS');
    const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    const usuario = resolverProcessadoPorFinanceiro_('APROVACAO_FOLHA_EVENTO');
    if (!shEvt || !shMov) throw new Error('Planilhas EVENTOS ou MOVIMENTACOES_FINANCEIRAS não encontradas');

    const evt = shEvt.getDataRange().getValues();
    const headEvt = evt[0];
    const e = function (c) { return headEvt.indexOf(c); };
    const idxEvento = evt.findIndex(function (r, idx) {
      return idx > 0 && String(r[e('ID_EVENTO')] || '').trim() === idEvento;
    });
    if (idxEvento === -1) throw new Error('EVENTO_NAO_ENCONTRADO');

    const mov = shMov.getDataRange().getValues();
    const headMov = mov[0];
    const m = function (c) { return headMov.indexOf(c); };
    const idxTipo = m('TIPO_MOVIMENTACAO');
    const idxIdEvento = m('ID_EVENTO');
    const idxStatus = m('STATUS');
    const idxObs = m('OBSERVACOES');
    const idxReferencia = m('REFERENCIA');
    if (idxTipo === -1 || idxIdEvento === -1 || idxStatus === -1) {
      throw new Error('COLUNAS_MOVIMENTACOES_INVALIDAS');
    }

    let folhasSubstituidas = 0;
    for (let i = 1; i < mov.length; i++) {
      if (String(mov[i][idxIdEvento] || '').trim() !== idEvento) continue;
      if (String(mov[i][idxTipo] || '').trim() !== 'FOLHA_EVENTO') continue;
      const statusNorm = statusFinanceiroNormalizado_(mov[i][idxStatus]);
      if (statusNorm !== 'PROCESSADO') continue;

      setValueComVerificacao_(shMov, i + 1, idxStatus + 1, 'CANCELADO', 'MOVIMENTACOES_FINANCEIRAS/FOLHA_EVENTO_REVISAO');
      if (idxObs !== -1) {
        const obsAtual = String(mov[i][idxObs] || '').trim();
        const marcador = ' | Revisado em ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') + ' por ' + usuario;
        setValueComVerificacao_(shMov, i + 1, idxObs + 1, (obsAtual + marcador).slice(0, 1000), 'MOVIMENTACOES_FINANCEIRAS/FOLHA_EVENTO_REVISAO_OBS');
      }
      folhasSubstituidas++;
    }

    const tipoEvento = String(evt[idxEvento][e('TIPO_EVENTO')] || '').trim();
    const nomeContratante = String(evt[idxEvento][e('NOME_CONTRATANTE')] || '').trim();
    const nomePadraoEvento = (tipoEvento + ' ' + nomeContratante).trim();
    const descricaoFinal = descricao || 'Folha revisada por aprovação';
    const descricaoComRef = referencia
      ? (descricaoFinal + ' | RefFolha: ' + referencia)
      : descricaoFinal;
    const idMovimentacao = gerarIDMovimentacao();
    const linhaMov = new Array(headMov.length).fill('');
    const setCol = function (coluna, valor) {
      const idx = m(coluna);
      if (idx !== -1) linhaMov[idx] = valor;
    };
    setCol('ID_MOVIMENTACAO', idMovimentacao);
    setCol('TIPO_MOVIMENTACAO', 'FOLHA_EVENTO');
    setCol('NATUREZA', 'SAÍDA');
    setCol('ID_EVENTO', idEvento);
    setCol('NOME_EVENTO', nomePadraoEvento);
    setCol('DATA_MOVIMENTACAO', normalizarData(new Date()));
    setCol('VALOR', Number(valor));
    setCol('FORMA_PAGAMENTO', '');
    setCol('CONTRAPARTE', 'Folha');
    setCol('ID_CONTRAPARTE', '');
    setCol('LINK_COMPROVANTE', '');
    setCol('OBSERVACOES', descricaoComRef);
    setCol('PROCESSADO_POR', usuario);
    setCol('TIMESTAMP', new Date());
    if (idxReferencia !== -1) setCol('REFERENCIA', referencia || '');
    setCol('STATUS', 'PROCESSADO');
    appendRowComVerificacao_(shMov, linhaMov, 'MOVIMENTACOES_FINANCEIRAS/FOLHA_EVENTO_REVISAO');

    setValueComVerificacao_(shEvt, idxEvento + 1, e('FOLHA_CUSTO_VALOR') + 1, Number(valor.toFixed(2)), 'EVENTOS/FOLHA_CUSTO_VALOR_REVISAO');
    setValueComVerificacao_(shEvt, idxEvento + 1, e('FOLHA_CUSTO_DESCRICAO') + 1, descricaoFinal, 'EVENTOS/FOLHA_CUSTO_DESCRICAO_REVISAO');

    return {
      sucesso: true,
      idMovimentacao: idMovimentacao,
      folhasSubstituidas: folhasSubstituidas
    };
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
    const valorFolha = normalizarValorMonetario_(payload.valor, { allowZero: false });
    if (!(valorFolha > 0)) {
      throw new Error('Valor da folha inválido');
    }
    return registrarFolhaEvento(
      payload.idEvento,
      valorFolha,
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
    const origemRecebimento = String((dados && dados.origem) || '').trim();
    const usuario = resolverProcessadoPorFinanceiro_(origemRecebimento);

    const evento = buscarEvento(dados.idEvento);
    if (!evento) throw new Error('Evento não encontrado');
    const idContratanteEvento = String(evento.idContratante || '').trim();
    if (!idContratanteEvento) {
      throw new Error('EVENTO_SEM_VINCULO_CONTRATANTE: regularize o contratante para registrar recebimento.');
    }

    const valorRecebimento = normalizarValorMonetario_(dados.valor, { allowZero: false });
    if (!(valorRecebimento > 0)) throw new Error('Valor de recebimento inválido');
    const referenciaRecebimento = String(dados.referencia || '').trim();
    if (referenciaRecebimento && existeMovimentacaoPorReferenciaFinanceira_(sh, referenciaRecebimento)) {
      throw new Error('REFERENCIA_DUPLICADA: já existe movimentação para esta referência.');
    }

    const idRecebimento = gerarIDMovimentacao();

    const linha = [
      idRecebimento,
      'RECEBIMENTO_CLIENTE',
      'ENTRADA',
      dados.idEvento,
      buscarNomeEventoPorID(dados.idEvento),
      normalizarData(dados.dataRecebimento),
      valorRecebimento,
      dados.formaPagamento || '',
      buscarContratantePorEvento(dados.idEvento),
      idContratanteEvento,
      dados.linkComprovante || '',
      dados.observacoes || '',
      usuario,
      new Date(),
      referenciaRecebimento,
      'PROCESSADO'
    ];

    appendRowComVerificacao_(sh, linha, 'MOVIMENTACOES_FINANCEIRAS/RECEBIMENTO_CLIENTE');

    // comissão automática
    const resultadoComissao = gerarComissaoAutomatica(
      dados.idEvento,
      idRecebimento,
      valorRecebimento,
      dados.dataRecebimento,
      usuario
    );

    atualizarResumoFinanceiroEvento(dados.idEvento);

    return {
      sucesso: true,
      idRecebimento: idRecebimento,
      idComissaoGerada: resultadoComissao && resultadoComissao.idMovimentacao ? resultadoComissao.idMovimentacao : ''
    };
  });
}

function financeiroGarantirVinculoContratanteEvento(dados) {
  exigirAcao('eventos:registrarRecebimento');
  return executarComLockFinanceiro_('GARANTIR_VINCULO_CONTRATANTE_EVENTO', function () {
    const idEvento = String((dados && dados.idEvento) || '').trim();
    if (!idEvento) throw new Error('ID_EVENTO_OBRIGATORIO');

    const evento = buscarEvento(idEvento);
    if (!evento) throw new Error('EVENTO_NAO_ENCONTRADO');

    const idContratanteAtual = String(evento.idContratante || '').trim();
    if (idContratanteAtual) {
      return {
        sucesso: true,
        jaVinculado: true,
        idEvento: idEvento,
        idContratante: idContratanteAtual,
        nomeContratante: String(evento.nomeContratante || '').trim()
      };
    }

    const nomeEvento = String(evento.nomeContratante || '').trim();
    if (!nomeEvento) {
      throw new Error('EVENTO_SEM_NOME_CONTRATANTE');
    }

    const confirmarCriacao =
      dados &&
      (dados.confirmarCriacao === true ||
        String(dados.confirmarCriacao || '').trim().toUpperCase() === 'TRUE' ||
        String(dados.confirmarCriacao || '').trim() === '1');

    if (!confirmarCriacao) {
      return {
        sucesso: false,
        requerConfirmacao: true,
        idEvento: idEvento,
        nomeContratanteEvento: nomeEvento,
        mensagem: 'Evento sem vínculo de contratante na matriz.'
      };
    }

    const regularizado = regularizarContratante({ nome: nomeEvento });
    if (!regularizado || regularizado.sucesso !== true || !regularizado.id) {
      throw new Error((regularizado && regularizado.mensagem) || 'FALHA_REGULARIZAR_CONTRATANTE');
    }

    const idNovo = String(regularizado.id || '').trim();
    const nomeNovo = String(regularizado.nome || nomeEvento).trim();
    if (!idNovo) throw new Error('ID_CONTRATANTE_INVALIDO');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const shEvt = ss.getSheetByName('EVENTOS');
    if (!shEvt) throw new Error('Planilha EVENTOS não encontrada');

    const data = shEvt.getDataRange().getValues();
    let linha = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][COL.ID_EVENTO] || '').trim() === idEvento) {
        linha = i + 1;
        break;
      }
    }
    if (linha === -1) throw new Error('EVENTO_NAO_ENCONTRADO');

    shEvt.getRange(linha, COL.ID_CONTRATANTE + 1).setValue(idNovo);
    if (!String(data[linha - 1][COL.NOME_CONTRATANTE] || '').trim()) {
      shEvt.getRange(linha, COL.NOME_CONTRATANTE + 1).setValue(nomeNovo);
    }
    shEvt.getRange(linha, COL.ULTIMA_EDICAO + 1).setValue(new Date());
    shEvt.getRange(linha, COL.EDITADO_POR + 1).setValue(String((getUsuarioAtual() || {}).email || 'SYSTEM'));

    return {
      sucesso: true,
      vinculadoAgora: true,
      idEvento: idEvento,
      idContratante: idNovo,
      nomeContratante: nomeNovo
    };
  });
}

/* =====================================================
 * GERAÇÃO DE COMISSÃO AUTOMÁTICA
 * ===================================================== */

function gerarComissaoAutomatica(idEvento, idRecebimento, valorRecebido, dataRecebimento, processadoPor) {
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
    String(processadoPor || resolverProcessadoPorFinanceiro_('COMISSAO_AUTOMATICA')),
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

function existeMovimentacaoPorReferenciaFinanceira_(sheetMov, referencia) {
  const ref = String(referencia || '').trim();
  if (!ref || !sheetMov) return false;
  const data = sheetMov.getDataRange().getValues();
  if (!data || data.length < 2) return false;
  const headers = data[0].map(function (h) { return String(h || '').trim(); });
  const idxRef = headers.indexOf('REFERENCIA');
  if (idxRef === -1) return false;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idxRef] || '').trim() === ref) return true;
  }
  return false;
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
  let valorRecebidoAteAgora = 0;
  let bvProcessado = false;
  let bvPendenteMov = false;
  let nfProcessada = false;
  let nfPendenteMov = false;
  let folhaCustoValorMov = 0;
  let qtdBvProcessado = 0;
  let qtdNfProcessada = 0;
  let qtdFolhaProcessada = 0;
  let comissaoGeradaTotal = 0;
  let comissaoPagaTotal = 0;

  for (let i = 0; i < mov.length; i++) {
    const row = mov[i];
    if (String(row[m('ID_EVENTO')] || '').trim() !== String(idEvento)) continue;

    const tipo = String(row[m('TIPO_MOVIMENTACAO')] || '').trim();
    const status = statusFinanceiroNormalizado_(row[m('STATUS')]);
    if (status === 'CANCELADO') continue;

    const rawValor = row[m('VALOR')];
    const valor = typeof rawValor === 'string'
      ? Number(rawValor.replace(/\./g, '').replace(',', '.'))
      : Number(rawValor);
    const valorSeguro = isNaN(valor) ? 0 : valor;

    if (tipo === 'RECEBIMENTO_CLIENTE' && status === 'PROCESSADO') {
      valorRecebidoAteAgora += valorSeguro;
      continue;
    }
    if (tipo === 'ESTORNO_RECEBIMENTO' && status === 'PROCESSADO') {
      valorRecebidoAteAgora -= valorSeguro;
      continue;
    }

    if (tipo === 'BV_EVENTO') {
      if (status === 'PROCESSADO') {
        bvProcessado = true;
        qtdBvProcessado += 1;
      } else if (status === 'PENDENTE') {
        bvPendenteMov = true;
      }
      continue;
    }

    if (tipo === 'NF_EVENTO') {
      if (status === 'PROCESSADO') {
        nfProcessada = true;
        qtdNfProcessada += 1;
      } else if (status === 'PENDENTE') {
        nfPendenteMov = true;
      }
      continue;
    }

    if (tipo === 'FOLHA_EVENTO' && status === 'PROCESSADO') {
      folhaCustoValorMov += valorSeguro;
      qtdFolhaProcessada += 1;
      continue;
    }

    if (tipo === 'COMISSAO_GERADA') {
      comissaoGeradaTotal += valorSeguro;
      if (status === 'PROCESSADO') {
        comissaoPagaTotal += valorSeguro;
      }
    }
  }

  valorRecebidoAteAgora = Number(valorRecebidoAteAgora.toFixed(2));

  const valorTotal = Number(evt[evtIdx][e('VALOR_TOTAL')]) || 0;
  // Pendente não deve ficar negativo; excedente de recebimento é tratado como "a maior".
  const valorPendente = Number(Math.max(valorTotal - valorRecebidoAteAgora, 0).toFixed(2));
  const valorBV = Number(evt[evtIdx][e('VALOR_BV')]) || 0;
  const idBV = String(evt[evtIdx][e('ID_BV')] || '').trim();
  const nomeBV = String(evt[evtIdx][e('NOME_BV')] || '').trim();
  const statusBVEspelho = String(evt[evtIdx][e('STATUS_BV')] || 'N/A');
  const statusBV = valorBV > 0 ? (bvProcessado ? 'PROCESSADO' : 'PENDENTE') : 'N/A';
  const temNF = String(evt[evtIdx][e('TEM_NF')] || '').toUpperCase() === 'TRUE';
  const valorNF = Number(evt[evtIdx][e('VALOR_NF')]) || 0;
  const statusNFEspelho = String(evt[evtIdx][e('STATUS_NF')] || 'N/A');
  const statusNF = temNF ? (nfProcessada ? 'PROCESSADO' : 'PENDENTE') : 'N/A';
  const folhaCustoValorEspelho = Number(evt[evtIdx][e('FOLHA_CUSTO_VALOR')]) || 0;
  const folhaCustoValor = Number(folhaCustoValorMov.toFixed(2));
  const folhaCustoDescricao = String(evt[evtIdx][e('FOLHA_CUSTO_DESCRICAO')] || '');
  const valorComissaoCalculado = Number(evt[evtIdx][e('VALOR_COMISSAO_CALCULADO')]) || 0;
  const valorComissaoPagoEspelho = Number(evt[evtIdx][e('VALOR_COMISSAO_PAGO')]) || 0;
  const statusComissaoEspelho = String(evt[evtIdx][e('STATUS_COMISSAO')] || 'NA');

  let statusRecebimento = 'EM_ABERTO';
  if (valorRecebidoAteAgora > 0 && valorPendente > 0) statusRecebimento = 'PARCIAL';
  if (valorPendente <= 0) statusRecebimento = 'QUITADO';

  const divergencias = [];
  const alertas = [];
  if (statusFinanceiroNormalizado_(statusBVEspelho) !== statusFinanceiroNormalizado_(statusBV)) {
    divergencias.push('STATUS_BV_ESPELHO_DIVERGENTE');
  }
  if (statusFinanceiroNormalizado_(statusNFEspelho) !== statusFinanceiroNormalizado_(statusNF)) {
    divergencias.push('STATUS_NF_ESPELHO_DIVERGENTE');
  }
  if (Math.abs(folhaCustoValorEspelho - folhaCustoValor) > 0.01) {
    divergencias.push('FOLHA_CUSTO_ESPELHO_DIVERGENTE');
  }
  if (qtdBvProcessado > 1) divergencias.push('DUPLICIDADE_BV_PROCESSADO');
  if (qtdNfProcessada > 1) divergencias.push('DUPLICIDADE_NF_PROCESSADO');
  if (qtdFolhaProcessada > 1) divergencias.push('DUPLICIDADE_FOLHA_PROCESSADA');
  if (valorRecebidoAteAgora > valorTotal + 0.01) {
    alertas.push('INCONSISTENCIA_RECEBIDO_MAIOR_QUE_CONTRATO');
  }

  if (statusRecebimento === 'QUITADO' && valorBV > 0 && !bvProcessado) {
    alertas.push('EVENTO_QUITADO_COM_BV_PENDENTE');
  }
  if (statusRecebimento === 'QUITADO' && temNF && !nfProcessada) {
    alertas.push('EVENTO_QUITADO_COM_NF_PENDENTE');
  }
  if (valorBV > 0 && bvPendenteMov && !bvProcessado) {
    alertas.push('BV_PENDENTE_EM_MOVIMENTACOES');
  }
  if (temNF && nfPendenteMov && !nfProcessada) {
    alertas.push('NF_PENDENTE_EM_MOVIMENTACOES');
  }

  return {
    valorTotal,
    valorRecebidoAteAgora,
    valorPendente,
    statusRecebimento,
    valorBV,
    idBV,
    nomeBV,
    statusBV,
    statusBVEspelho,
    bvPendente: valueOrFalse_(valorBV > 0 && !bvProcessado),
    temNF,
    valorNF,
    statusNF,
    statusNFEspelho,
    nfPendente: valueOrFalse_(temNF && !nfProcessada),
    valorComissaoCalculado: Number(valorComissaoCalculado.toFixed(2)),
    valorComissaoGerada: Number(comissaoGeradaTotal.toFixed(2)),
    valorComissaoPagaMov: Number(comissaoPagaTotal.toFixed(2)),
    valorComissaoPagaEspelho: Number(valorComissaoPagoEspelho.toFixed(2)),
    statusComissaoEspelho,
    folhaCustoValor,
    folhaCustoValorEspelho,
    folhaCustoDescricao,
    folhaPendente: valueOrFalse_(folhaCustoValor <= 0),
    divergencias,
    alertas
  };
}

function valueOrFalse_(value) {
  return value ? true : false;
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
    const LINK_COMPROVANTE  = row[10];
    const OBSERVACOES       = row[11];
    const REFERENCIA        = row[14];

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
        nomeEvento: NOME_EVENTO || '',
        linkComprovante: String(LINK_COMPROVANTE || '').trim(),
        observacoes: String(OBSERVACOES || '').trim(),
        referencia: String(REFERENCIA || '').trim()
      });
    }
  }

  recebimentos.sort(function (a, b) {
    const da = new Date(a.ddata || '1970-01-01').getTime();
    const db = new Date(b.ddata || '1970-01-01').getTime();
    return db - da;
  });

  return recebimentos;
}

/* =====================================================
 * PREVIEW DO FECHAMENTO (USADO PELO FRONTEND)
 * ===================================================== */

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

    const evtRow = getEventoPorId(c.idEvento);
    const valorTotalEvt = evtRow ? (Number(evtRow[e('VALOR_TOTAL')]) || 0) : 0;
    const valorBVEvt = evtRow ? (Number(evtRow[e('VALOR_BV')]) || 0) : 0;
    const valorNFEvt = evtRow ? (Number(evtRow[e('VALOR_NF')]) || 0) : 0;
    const baseComissaoEvt = Number(Math.max(valorTotalEvt - valorBVEvt - valorNFEvt, 0).toFixed(2));
    const comissaoTipoEvt = evtRow ? String(evtRow[e('COMISSAO_TIPO')] || 'N/A') : 'N/A';
    const comissaoValorEvt = evtRow ? (Number(evtRow[e('COMISSAO_VALOR')]) || 0) : 0;
    const comissaoEsperadaEvt = evtRow ? (Number(evtRow[e('VALOR_COMISSAO_CALCULADO')]) || 0) : 0;
    const comissaoPagaEvt = evtRow ? (Number(evtRow[e('VALOR_COMISSAO_PAGO')]) || 0) : 0;
    const statusComissaoEvt = evtRow ? String(evtRow[e('STATUS_COMISSAO')] || 'NA') : 'NA';

    var regraComissaoLabel = 'N/A';
    if (comissaoTipoEvt === 'Padrão') {
      regraComissaoLabel = 'Padrão ' + Number(comissaoValorEvt || 0).toFixed(2).replace(/\.00$/, '') + '%';
    } else if (comissaoTipoEvt === 'Percentual') {
      regraComissaoLabel = 'Percentual ' + Number(comissaoValorEvt || 0).toFixed(2).replace(/\.00$/, '') + '%';
    } else if (comissaoTipoEvt === 'Fixo') {
      regraComissaoLabel = 'Fixo R$ ' + Number(comissaoValorEvt || 0).toFixed(2);
    } else if (comissaoTipoEvt === 'Sem Comissão') {
      regraComissaoLabel = 'Sem comissão';
    }

    const valorComissaoFinal = Number((c.valorComissao + (ajusteComissao || 0)).toFixed(2));
    const progressoComissao = comissaoEsperadaEvt > 0
      ? Number(Math.max(0, Math.min(100, (comissaoPagaEvt / comissaoEsperadaEvt) * 100)).toFixed(1))
      : 0;

    // Para preview: ajusteNecessario deve ser true para comissão pendente OU processada,
    // desde que haja estorno e ainda não haja ajuste registrado.
    return {
      nomeEvento: c.nomeEvento,
      valorComissao: c.valorComissao, // valor original
      valorComissaoFinal: valorComissaoFinal,
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
      statusComissao: c.status,
      statusComissaoEspelho: statusComissaoEvt,
      baseComissao: baseComissaoEvt,
      valorContrato: Number(valorTotalEvt.toFixed(2)),
      valorNF: Number(valorNFEvt.toFixed(2)),
      valorBV: Number(valorBVEvt.toFixed(2)),
      regraComissao: regraComissaoLabel,
      comissaoTipo: comissaoTipoEvt,
      comissaoValor: comissaoValorEvt,
      valorComissaoEsperada: Number(comissaoEsperadaEvt.toFixed(2)),
      valorComissaoPaga: Number(comissaoPagaEvt.toFixed(2)),
      progressoComissao: progressoComissao
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
function fecharComissaoVendedor(idVendedor, _, __, ajusteCredito, ajusteDebito, linkComprovante, ajustesDetalhados) {
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
  const usuario = resolverProcessadoPorFinanceiro_('FECHAMENTO_COMISSAO');
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

  const ajustesDetalhadosNorm = normalizarAjustesDetalhadosFechamento_(ajustesDetalhados);
  const somaAjustesDetalhados = somarAjustesDetalhadosFechamento_(ajustesDetalhadosNorm);
  const ajusteCreditoNum = ajustesDetalhadosNorm.length
    ? somaAjustesDetalhados.totalCredito
    : (Number(ajusteCredito) || 0);
  const ajusteDebitoNum = ajustesDetalhadosNorm.length
    ? somaAjustesDetalhados.totalDebito
    : (Number(ajusteDebito) || 0);
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
    ajustesDetalhados: ajustesDetalhadosNorm,
    linkComprovante: String(linkComprovante || '').trim(),
    valorFinal: valorFinal
  });

  const descricaoAjusteFechamento = gerarDescricaoAjustesDetalhadosFechamento_(ajustesDetalhadosNorm);

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
    descricaoAjusteFechamento,
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

  let linkPdf = '';
  let pdfGerado = false;
  let mensagemPdf = '';
  etapa = 'gerar_pdf';
  try {
    linkPdf = gerarPdfFechamentoComissao(idFechamento);
    atualizarLinkPdfNoFechamento_(shFech, idFechamento, linkPdf);
    pdfGerado = true;
    log('PDF gerado com sucesso');
  } catch (pdfErr) {
    const detalhePdf = String(pdfErr && pdfErr.message ? pdfErr.message : pdfErr);
    mensagemPdf = 'Fechamento confirmado, mas o PDF não foi gerado automaticamente.';
    log('ALERTA PDF: ' + detalhePdf);
  }

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
    pdfGerado: pdfGerado,
    mensagem: pdfGerado
      ? 'Fechamento realizado com sucesso'
      : (mensagemPdf || 'Fechamento confirmado sem PDF automático')
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

function regerarPdfFechamentoComissao(idFechamento) {
  exigirAcao('comissao:fechar');
  if (!idFechamento) {
    throw new Error('ID_FECHAMENTO obrigatório para regerar PDF');
  }

  const ss = SpreadsheetApp.getActive();
  const shFech = ss.getSheetByName('FECHAMENTOS_COMISSAO');
  if (!shFech) {
    throw new Error('Aba FECHAMENTOS_COMISSAO não encontrada');
  }

  const linkPdf = gerarPdfFechamentoComissao(idFechamento);
  atualizarLinkPdfNoFechamento_(shFech, idFechamento, linkPdf);

  return {
    sucesso: true,
    idFechamento: String(idFechamento),
    linkPdf: String(linkPdf || '').trim(),
    mensagem: 'PDF do fechamento regenerado com sucesso'
  };
}

function normalizarAjustesDetalhadosFechamento_(itens) {
  if (!Array.isArray(itens)) return [];
  return itens
    .map(function (item) {
      const tipo = String(item && item.tipo ? item.tipo : '').toUpperCase() === 'DEBITO' ? 'DEBITO' : 'CREDITO';
      const valor = Number(item && item.valor);
      const descricao = String(item && item.descricao ? item.descricao : '').trim();
      return {
        tipo: tipo,
        valor: isNaN(valor) ? 0 : Number(valor.toFixed(2)),
        descricao: descricao
      };
    })
    .filter(function (item) {
      return item.valor > 0;
    });
}

function somarAjustesDetalhadosFechamento_(itens) {
  let totalCredito = 0;
  let totalDebito = 0;
  (itens || []).forEach(function (item) {
    if (item.tipo === 'DEBITO') totalDebito += Number(item.valor || 0);
    else totalCredito += Number(item.valor || 0);
  });
  return {
    totalCredito: Number(totalCredito.toFixed(2)),
    totalDebito: Number(totalDebito.toFixed(2))
  };
}

function gerarDescricaoAjustesDetalhadosFechamento_(itens) {
  if (!Array.isArray(itens) || !itens.length) return '';
  const resumo = itens
    .slice(0, 3)
    .map(function (item) {
      return item.tipo + ': ' + (item.descricao || 'Sem descrição');
    })
    .join(' | ');
  if (itens.length > 3) {
    return resumo + ' | +' + (itens.length - 3) + ' ajuste(s)';
  }
  return resumo;
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

  const valorEstorno = normalizarValorMonetario_(payload.valor, { allowZero: false });
  if (!(valorEstorno > 0)) {
    throw new Error('Valor inválido para estorno');
  }

  return estornarRecebimento(
    payload.idRecebimento,
    valorEstorno,
    payload.motivo || 'Estorno manual'
  );
}

function estornarRecebimento(idRecebimento, valorEstorno, motivo) {
  exigirAcao('eventos:estornarRecebimento');
  return executarComLockFinanceiro_('ESTORNO_RECEBIMENTO', function () {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    const usuario = resolverProcessadoPorFinanceiro_('ESTORNO_RECEBIMENTO');

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
  const idEventoNorm = String(idEvento || '').trim();
  if (!idEventoNorm) return;

  const ss = SpreadsheetApp.getActive();
  const shEvt = ss.getSheetByName('EVENTOS');
  const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');

  const evt = shEvt.getDataRange().getValues();
  const evtHead = evt.shift();
  const e = c => evtHead.indexOf(c);

  const evtIdx = evt.findIndex(r => String(r[e('ID_EVENTO')] || '').trim() === idEventoNorm);
  if (evtIdx === -1) return;

  const mov = shMov.getDataRange().getValues();
  const movHead = mov.shift();
  const m = c => movHead.indexOf(c);

  const receb = mov.filter(r =>
    String(r[m('ID_EVENTO')] || '').trim() === idEventoNorm &&
    r[m('NATUREZA')] === 'ENTRADA' &&
    r[m('STATUS')] !== 'CANCELADO'
  );

  const totalRecebido = receb.reduce((s, r) => s + (Number(r[m('VALOR')]) || 0), 0);
  const valorTotal = Number(evt[evtIdx][e('VALOR_TOTAL')]) || 0;
  // Mantém pendência financeira sem negativos (excedente é tratado como recebimento acima do contrato).
  const pendente = Math.max(valorTotal - totalRecebido, 0);

  let status = 'EM_ABERTO';
  if (totalRecebido > 0 && pendente > 0) status = 'PARCIAL';
  if (pendente <= 0) status = 'QUITADO';

  const row = evtIdx + 2;
  shEvt.getRange(row, e('VALOR_RECEBIDO') + 1).setValue(totalRecebido);
  shEvt.getRange(row, e('VALOR_PENDENTE') + 1).setValue(pendente);
  shEvt.getRange(row, e('STATUS_RECEBIMENTO') + 1).setValue(status);
  if (e('ULTIMA_EDICAO') >= 0) {
    shEvt.getRange(row, e('ULTIMA_EDICAO') + 1).setValue(new Date());
  }
  if (e('EDITADO_POR') >= 0) {
    let editor = 'SYSTEM';
    try {
      editor = String((getUsuarioAtual && getUsuarioAtual().email) || 'SYSTEM');
    } catch (_) {}
    shEvt.getRange(row, e('EDITADO_POR') + 1).setValue(editor);
  }

  // Espelho de comissão (sincroniza junto com recebimentos)
  const idxTipoComissao = e('COMISSAO_TIPO');
  const idxValorComissao = e('COMISSAO_VALOR');
  const idxIdVendedor = e('ID_VENDEDOR');
  const idxValorBV = e('VALOR_BV');
  const idxValorNF = e('VALOR_NF');
  const idxValorComissaoCalculado = e('VALOR_COMISSAO_CALCULADO');
  const idxValorComissaoPago = e('VALOR_COMISSAO_PAGO');
  const idxStatusComissao = e('STATUS_COMISSAO');

  if (
    idxTipoComissao !== -1 &&
    idxValorComissao !== -1 &&
    idxIdVendedor !== -1 &&
    idxValorBV !== -1 &&
    idxValorNF !== -1 &&
    idxValorComissaoCalculado !== -1 &&
    idxValorComissaoPago !== -1 &&
    idxStatusComissao !== -1
  ) {
    const tipoComissao = String(evt[evtIdx][idxTipoComissao] || '').trim();
    const valorComissaoCfg = Number(evt[evtIdx][idxValorComissao]) || 0;
    const idVendedor = String(evt[evtIdx][idxIdVendedor] || '').trim();
    const valorBV = Number(evt[evtIdx][idxValorBV]) || 0;
    const valorNF = Number(evt[evtIdx][idxValorNF]) || 0;

    let esperado = 0;
    if (tipoComissao === 'Sem Comissão') {
      esperado = 0;
    } else if (tipoComissao === 'Fixo') {
      esperado = valorComissaoCfg;
    } else {
      const base = Number(valorTotal - valorBV - valorNF) || 0;
      if (base > 0) {
        let percentual = 0;
        if (tipoComissao === 'Percentual') {
          percentual = valorComissaoCfg;
        } else {
          const vendedor = buscarVendedor(idVendedor);
          percentual = Number((vendedor && vendedor.comissaoPadrao) || 0);
        }
        esperado = base * (percentual / 100);
      }
    }
    esperado = Number((esperado || 0).toFixed(2));

    let gerado = 0;
    let pago = 0;
    for (let i = 0; i < mov.length; i++) {
      const rowMov = mov[i];
      if (
        String(rowMov[m('ID_EVENTO')] || '').trim() !== idEventoNorm ||
        String(rowMov[m('TIPO_MOVIMENTACAO')] || '').trim() !== 'COMISSAO_GERADA' ||
        String(rowMov[m('STATUS')] || '').trim() === 'CANCELADO'
      ) {
        continue;
      }
      const valorMov = Number(rowMov[m('VALOR')]) || 0;
      gerado += valorMov;
      if (String(rowMov[m('STATUS')] || '').trim() === 'PROCESSADO') {
        pago += valorMov;
      }
    }

    gerado = Number(gerado.toFixed(2));
    pago = Number(pago.toFixed(2));
    const pendenteComissao = Number(Math.max(gerado - pago, 0).toFixed(2));
    const statusComissao = determinarStatusComissao_(esperado, gerado, pago, pendenteComissao);

    shEvt.getRange(row, idxValorComissaoCalculado + 1).setValue(esperado);
    shEvt.getRange(row, idxValorComissaoPago + 1).setValue(pago);
    shEvt.getRange(row, idxStatusComissao + 1).setValue(statusComissao);
  }
}

/**
 * =====================================================
 * MIGRAÇÃO DE SALDO INICIAL FINANCEIRO (LEGADO)
 * =====================================================
 * Cria movimentos históricos idempotentes para eventos já importados:
 * - RECEBIMENTO_CLIENTE (PROCESSADO) com marcador de migração
 * - COMISSAO_GERADA (PROCESSADO) com INCLUIDO_EM_FECHAMENTO legado
 *
 * Objetivo: permitir que novos lançamentos sejam incrementais sem perder
 * o histórico já refletido na aba EVENTOS.
 */
function resolverDestinatarioBV_(nomeCerimonialista, observacoesEvento, nomeParceiroBV) {
  const nomeCer = String(nomeCerimonialista || '').trim();
  if (nomeCer) {
    return { nome: nomeCer, fonte: 'NOME_CERIMONIALISTA' };
  }

  const obs = String(observacoesEvento || '').trim();
  if (obs) {
    const match = obs.match(/(?:CERIMONIAL(?:ISTA)?|BV)\s*[:\-]\s*([^|;\\n]+)/i);
    if (match && String(match[1] || '').trim()) {
      return { nome: String(match[1]).trim(), fonte: 'OBSERVACOES' };
    }
  }

  const nomeParceiro = String(nomeParceiroBV || '').trim();
  if (nomeParceiro) {
    return { nome: nomeParceiro, fonte: 'NOME_BV' };
  }

  return { nome: '', fonte: 'INDEFINIDO' };
}

function detectarOrigemProcessamentoBV_(meta) {
  const origemMeta = String((meta && meta.origemProcessamento) || '').trim().toUpperCase();
  if (origemMeta) return origemMeta;
  const obs = String((meta && meta.observacoes) || '').trim().toLowerCase();
  if (obs.indexOf('fiscal') !== -1) return 'FISCALIZACAO';
  return 'CENTRAL_SAIDAS';
}

function montarObsDestinoBVParceiro_(parceiro, origemProcessamento) {
  const nome = String((parceiro && parceiro.nome) || '').trim();
  const id = String((parceiro && parceiro.id) || '').trim();
  const fonte = String((parceiro && parceiro.fonte) || 'INDEFINIDO');
  const status = String((parceiro && parceiro.status) || 'sem_destino');
  const origem = String(origemProcessamento || 'DESCONHECIDA').trim();
  return ' | destino_bv=' + nome +
    ' | fonte_destino=' + fonte +
    ' | id_parceiro_bv=' + id +
    ' | parceiro_status=' + status +
    ' | origem_processamento_bv=' + origem;
}

function resolverParceiroBVEvento_(eventoRow, e) {
  const idBV = String(eventoRow[e('ID_BV')] || '').trim();
  const nomeBV = String(eventoRow[e('NOME_BV')] || '').trim();
  const nomeCerimonialista = String(eventoRow[e('NOME_CERIMONIALISTA')] || '').trim();
  const obsEvento = String(eventoRow[e('OBSERVACOES')] || '').trim();

  if (idBV) {
    const parceiroPorId = buscarParceiroBVPorId_(idBV);
    if (parceiroPorId) {
      return {
        id: parceiroPorId.id,
        nome: parceiroPorId.nome,
        fonte: 'ID_BV',
        status: 'parceiro_bv_encontrado'
      };
    }
    return {
      id: idBV,
      nome: nomeBV || 'BV',
      fonte: 'ID_BV',
      status: 'id_bv_sem_cadastro'
    };
  }

  if (nomeBV) {
    const parceiroPorNome = buscarParceiroBVPorNome_(nomeBV);
    if (parceiroPorNome) {
      return {
        id: parceiroPorNome.id,
        nome: parceiroPorNome.nome,
        fonte: 'NOME_BV',
        status: 'parceiro_bv_encontrado'
      };
    }
    return {
      id: '',
      nome: nomeBV,
      fonte: 'NOME_BV',
      status: 'nome_bv_sem_cadastro'
    };
  }

  const destinoFallback = resolverDestinatarioBV_(nomeCerimonialista, obsEvento, nomeBV);
  const nomeFallback = String((destinoFallback && destinoFallback.nome) || '').trim();
  if (!nomeFallback) {
    return { id: '', nome: 'BV', fonte: 'INDEFINIDO', status: 'sem_destino' };
  }

  const parceiroFallback = buscarParceiroBVPorNome_(nomeFallback);
  if (parceiroFallback) {
    return {
      id: parceiroFallback.id,
      nome: parceiroFallback.nome,
      fonte: String((destinoFallback && destinoFallback.fonte) || 'FALLBACK'),
      status: 'parceiro_bv_encontrado_fallback'
    };
  }

  return {
    id: '',
    nome: nomeFallback,
    fonte: String((destinoFallback && destinoFallback.fonte) || 'FALLBACK'),
    status: 'fallback_sem_parceiro_bv'
  };
}

function buscarParceiroBVPorId_(idParceiro) {
  const alvo = String(idParceiro || '').trim();
  if (!alvo) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('PARCEIROS_BV');
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0] || '').trim();
    if (id !== alvo) continue;
    return { id: id, nome: String(data[i][1] || '').trim() || 'BV' };
  }
  return null;
}

function buscarParceiroBVPorNome_(nomeParceiro) {
  const alvo = normalizarTextoSaldoInicial_(nomeParceiro);
  if (!alvo) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('PARCEIROS_BV');
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const nome = String(data[i][1] || '').trim();
    if (!nome) continue;
    if (normalizarTextoSaldoInicial_(nome) !== alvo) continue;
    return { id: String(data[i][0] || '').trim(), nome: nome };
  }
  return null;
}

function montarObsDestinoBV_(destino, cadastro) {
  const nome = String((destino && destino.nome) || '').trim();
  if (!nome) return '';
  const fonte = String((destino && destino.fonte) || 'INDEFINIDO');
  const idCer = String((cadastro && cadastro.id) || '').trim();
  const statusCad = cadastro && cadastro.criado
    ? 'cerimonialista_cadastrado'
    : (cadastro && cadastro.encontrado ? 'cerimonialista_existente' : 'cerimonialista_nao_cadastrado');
  return ' | destino_bv=' + nome + ' | fonte_destino=' + fonte + ' | id_cerimonialista=' + idCer + ' | ' + statusCad;
}

function garantirCerimonialistaPorNome_(nome, usuarioEmail) {
  const nomeLimpo = String(nome || '').trim();
  if (!nomeLimpo) return { id: '', nome: '', criado: false, encontrado: false };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('CERIMONIALISTAS');
  if (!sh) return { id: '', nome: nomeLimpo, criado: false, encontrado: false };

  const data = sh.getDataRange().getValues();
  const key = normalizarTextoSaldoInicial_(nomeLimpo);

  for (let i = 1; i < data.length; i++) {
    const nomeRow = String(data[i][1] || '').trim();
    if (normalizarTextoSaldoInicial_(nomeRow) === key) {
      return {
        id: String(data[i][0] || '').trim(),
        nome: nomeRow || nomeLimpo,
        criado: false,
        encontrado: true
      };
    }
  }

  let novoId = 1;
  if (data.length > 1) {
    let maxId = 0;
    for (let i = 1; i < data.length; i++) {
      const n = Number(data[i][0]);
      if (!isNaN(n) && n > maxId) maxId = n;
    }
    novoId = maxId + 1;
  }

  sh.appendRow([
    novoId,
    nomeLimpo,
    '',
    'Cadastro automático via migração BV legado (' + String(usuarioEmail || '') + ')',
    new Date()
  ]);

  return {
    id: String(novoId),
    nome: nomeLimpo,
    criado: true,
    encontrado: false
  };
}

function montarCacheVendedoresSaldoInicial_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shVend = ss.getSheetByName('VENDEDORES');
  if (!shVend) {
    throw new Error('Aba VENDEDORES não encontrada para resolver ID_VENDEDOR.');
  }

  const data = shVend.getDataRange().getValues();
  const mapaPorNome = {};
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0] || '').trim();
    const nome = String(data[i][1] || '').trim();
    if (!id || !nome) continue;
    const key = normalizarTextoSaldoInicial_(nome);
    if (!key) continue;
    if (!mapaPorNome[key]) mapaPorNome[key] = [];
    mapaPorNome[key].push({ id: id, nome: nome });
  }

  return { porNome: mapaPorNome };
}

function resolverIdVendedorSaldoInicial_(idVendedorAtual, nomeVendedor, cacheVendedores) {
  const idAtual = String(idVendedorAtual || '').trim();
  if (idAtual) return { ok: true, idVendedor: idAtual };

  const nome = String(nomeVendedor || '').trim();
  if (!nome) return { ok: false, motivo: 'NOME_VENDEDOR vazio' };

  const key = normalizarTextoSaldoInicial_(nome);
  const candidatos = (((cacheVendedores || {}).porNome || {})[key]) || [];
  if (candidatos.length === 1) {
    return { ok: true, idVendedor: candidatos[0].id };
  }
  if (candidatos.length === 0) {
    return { ok: false, motivo: 'NOME_VENDEDOR não encontrado em VENDEDORES: ' + nome };
  }
  return { ok: false, motivo: 'NOME_VENDEDOR ambíguo em VENDEDORES: ' + nome };
}

function normalizarTextoSaldoInicial_(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function recalcularEspelhosFinanceirosMigracao_(idsEvento, shEvt, shMov) {
  if (!idsEvento || !idsEvento.length) return;

  const idsSet = {};
  for (let i = 0; i < idsEvento.length; i++) {
    idsSet[String(idsEvento[i])] = true;
  }

  const evtData = shEvt.getDataRange().getValues();
  const movData = shMov.getDataRange().getValues();
  if (evtData.length < 2 || movData.length < 2) return;

  const evtHead = evtData[0];
  const movHead = movData[0];
  const e = function (c) { return evtHead.indexOf(c); };
  const m = function (c) { return movHead.indexOf(c); };

  const colunasEventos = [
    'ID_EVENTO',
    'VALOR_TOTAL',
    'VALOR_RECEBIDO',
    'VALOR_PENDENTE',
    'STATUS_RECEBIMENTO',
    'ID_VENDEDOR',
    'VALOR_COMISSAO_CALCULADO',
    'VALOR_COMISSAO_PAGO',
    'STATUS_COMISSAO'
  ];
  const colunasMov = [
    'TIPO_MOVIMENTACAO',
    'NATUREZA',
    'STATUS',
    'ID_EVENTO',
    'ID_CONTRAPARTE',
    'VALOR'
  ];

  for (var i = 0; i < colunasEventos.length; i++) {
    if (e(colunasEventos[i]) === -1) {
      throw new Error('Coluna obrigatória não encontrada em EVENTOS: ' + colunasEventos[i]);
    }
  }
  for (var j = 0; j < colunasMov.length; j++) {
    if (m(colunasMov[j]) === -1) {
      throw new Error('Coluna obrigatória não encontrada em MOVIMENTACOES_FINANCEIRAS: ' + colunasMov[j]);
    }
  }

  const mapaRecebido = {};
  const mapaComissao = {};

  for (let r = 1; r < movData.length; r++) {
    const row = movData[r];
    if (String(row[m('STATUS')] || '') === 'CANCELADO') continue;

    const idEvento = String(row[m('ID_EVENTO')] || '').trim();
    if (!idsSet[idEvento]) continue;

    const tipoMov = String(row[m('TIPO_MOVIMENTACAO')] || '');
    const natureza = String(row[m('NATUREZA')] || '');
    const valor = Number(row[m('VALOR')]) || 0;

    if (natureza === 'ENTRADA') {
      if (!mapaRecebido[idEvento]) mapaRecebido[idEvento] = 0;
      mapaRecebido[idEvento] += valor;
    }

    if (tipoMov === 'COMISSAO_GERADA') {
      const idVendedor = String(row[m('ID_CONTRAPARTE')] || '').trim();
      if (!mapaComissao[idEvento]) {
        mapaComissao[idEvento] = {
          geradoPorVendedor: {},
          pagoPorVendedor: {}
        };
      }
      if (!mapaComissao[idEvento].geradoPorVendedor[idVendedor]) {
        mapaComissao[idEvento].geradoPorVendedor[idVendedor] = 0;
      }
      mapaComissao[idEvento].geradoPorVendedor[idVendedor] += valor;

      if (String(row[m('STATUS')] || '') === 'PROCESSADO') {
        if (!mapaComissao[idEvento].pagoPorVendedor[idVendedor]) {
          mapaComissao[idEvento].pagoPorVendedor[idVendedor] = 0;
        }
        mapaComissao[idEvento].pagoPorVendedor[idVendedor] += valor;
      }
    }
  }

  for (let rEvt = 1; rEvt < evtData.length; rEvt++) {
    const row = evtData[rEvt];
    const idEvento = String(row[e('ID_EVENTO')] || '').trim();
    if (!idsSet[idEvento]) continue;

    const totalRecebido = Number((mapaRecebido[idEvento] || 0).toFixed(2));
    const valorTotal = Number(row[e('VALOR_TOTAL')]) || 0;
    const pendente = Number((valorTotal - totalRecebido).toFixed(2));

    let statusRecebimento = 'EM_ABERTO';
    if (totalRecebido > 0 && pendente > 0) statusRecebimento = 'PARCIAL';
    if (pendente <= 0) statusRecebimento = 'QUITADO';

    const idVendedor = String(row[e('ID_VENDEDOR')] || '').trim();
    const esperado = Number(row[e('VALOR_COMISSAO_CALCULADO')]) || 0;
    const totalGerado = Number((((mapaComissao[idEvento] || {}).geradoPorVendedor || {})[idVendedor] || 0).toFixed(2));
    const totalPago = Number((((mapaComissao[idEvento] || {}).pagoPorVendedor || {})[idVendedor] || 0).toFixed(2));
    const totalPendenteComissao = Number(Math.max(totalGerado - totalPago, 0).toFixed(2));
    const statusComissao = determinarStatusComissao_(Number(esperado.toFixed(2)), totalGerado, totalPago, totalPendenteComissao);

    const rowNumber = rEvt + 1;
    setValueComVerificacao_(shEvt, rowNumber, e('VALOR_RECEBIDO') + 1, totalRecebido, 'EVENTOS/VALOR_RECEBIDO');
    setValueComVerificacao_(shEvt, rowNumber, e('VALOR_PENDENTE') + 1, pendente, 'EVENTOS/VALOR_PENDENTE');
    setValueComVerificacao_(shEvt, rowNumber, e('STATUS_RECEBIMENTO') + 1, statusRecebimento, 'EVENTOS/STATUS_RECEBIMENTO');
    setValueComVerificacao_(shEvt, rowNumber, e('VALOR_COMISSAO_PAGO') + 1, totalPago, 'EVENTOS/VALOR_COMISSAO_PAGO');
    setValueComVerificacao_(shEvt, rowNumber, e('STATUS_COMISSAO') + 1, statusComissao, 'EVENTOS/STATUS_COMISSAO');
  }
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
  const idBV = String(evento[COL.ID_BV] || '').trim();
  const nomeBV = String(evento[COL.NOME_BV] || '').trim();
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

  const alertasCriticos = alertas.filter(a => !alertaEhSomenteInformativo_(a));

  if (alertas.some(a => errosCriticos.includes(a))) {
    status = 'erro';
  } else if (alertasCriticos.length > 0) {
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
          ? 'EM_ABERTO'
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
        status: valorBV > 0 ? (bvPago ? 'PROCESSADO' : 'PENDENTE') : 'NA',
        idParceiro: idBV,
        nomeParceiro: nomeBV
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
  const mapaMovPorEvento = agruparMovimentacoesFinanceirasPorEvento_(movData);

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
        movData,
        mapaMovPorEvento
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
        tipoRegistro: String(tipoRegistro || ''),
        tipoEvento: String(leitura.tipoEvento || ''),
        projeto: String(linha[COL.PROJETO] || ''),
        nomeEvento: leitura.nomeEvento,
        nomeContratante: leitura.nomeContratante,
        idCerimonialista: String(linha[COL.ID_CERIMONIALISTA] || ''),
        nomeCerimonialista: String(linha[COL.NOME_CERIMONIALISTA] || '').trim(),
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
        divergencias: leitura.divergencias || [],
        acoes: leitura.acoes,
        status: leitura.status,
        comissao,
        metadados: leitura.metadados || {}
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

function obterDashboardGestao(params) {
  exigirAcao('eventos:visualizarFinanceiro');

  const anoAtual = new Date().getFullYear();
  const ano = Number((params && params.ano) || anoAtual);
  const incluirCancelados = String((params && params.incluirCancelados) || '').toUpperCase() === 'TRUE';
  const forceRefresh = String((params && params.forceRefresh) || '').toUpperCase() === 'TRUE';
  const cache = CacheService.getScriptCache();
  const ttlRaw = Number(obterConfig('DASHBOARD_CACHE_TTL_SEG'));
  const ttlSeg = Number.isFinite(ttlRaw) && ttlRaw > 0
    ? Math.max(15, Math.min(300, Math.floor(ttlRaw)))
    : 60;
  const cacheKey = [
    'dashboard:gestao:v2',
    String(ano),
    incluirCancelados ? '1' : '0'
  ].join(':');
  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (_) {}
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shEvt = ss.getSheetByName('EVENTOS');
  const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  if (!shEvt || !shMov) throw new Error('Planilhas EVENTOS ou MOVIMENTACOES_FINANCEIRAS não encontradas');

  const evtData = shEvt.getDataRange().getValues();
  const movData = shMov.getDataRange().getValues();
  if (evtData.length < 2) {
    const vazio = {
      sucesso: true,
      ano: ano,
      resumo: {
        eventos: { total: 0, ativos: 0, cancelados: 0, quitados: 0, parciais: 0, abertos: 0 },
        financeiro: { contrato: 0, recebido: 0, pendente: 0, percRecebido: 0 },
        saidas: { bvProcessado: 0, bvPendente: 0, nfProcessada: 0, nfPendente: 0, folhaTotal: 0, folhaEventos: 0 }
      },
      visaoMensal: {
        contratado: [],
        recebidoHibrido: [],
        comissaoGeradaEvento: [],
        comissaoPagaEvento: [],
        saidasEvento: [],
        liquidoEvento: [],
        totais: {
          contratado: 0,
          recebidoHibrido: 0,
          comissaoGeradaEvento: 0,
          comissaoPendenteEvento: 0,
          comissaoPagaEvento: 0,
          bvPagoEvento: 0,
          nfPagoEvento: 0,
          folhaPagoEvento: 0,
          comissaoPagaEventoQtd: 0,
          bvPagoEventoQtd: 0,
          nfPagoEventoQtd: 0,
          folhaPagoEventoQtd: 0,
          saidasTotalEvento: 0,
          liquidoEvento: 0
        },
        qualidade: {
          eventosLegadoAno: 0,
          eventosComMovRecebimento: 0,
          eventosComFallbackEspelho: 0,
          eventosSemRecebimento: 0
        }
      },
      riscos: [],
      vendedores: [],
      mensal: []
    };
    try { cache.put(cacheKey, JSON.stringify(vazio), ttlSeg); } catch (_) {}
    return vazio;
  }

  const evtHead = evtData[0];
  const e = function (c) { return evtHead.indexOf(c); };
  const movHead = movData[0];
  const m = function (c) { return movHead.indexOf(c); };

  const mapaMov = agruparMovimentacoesFinanceirasPorEvento_(movData);
  const mapaComissaoEvento = {};
  const rankingVendedores = {};
  const mensal = {};
  const mensalEvento = {};
  for (let mes = 1; mes <= 12; mes++) {
    mensal[mes] = { recebido: 0, comissaoPaga: 0, bvPago: 0, folha: 0 };
    mensalEvento[mes] = {
      contratado: 0,
      recebidoHibrido: 0,
      comissaoGeradaEvento: 0,
      comissaoPendenteEvento: 0,
      comissaoPagaEvento: 0,
      bvPagoEvento: 0,
      nfPagoEvento: 0,
      folhaPagoEvento: 0,
      comissaoPagaEventoQtd: 0,
      bvPagoEventoQtd: 0,
      nfPagoEventoQtd: 0,
      folhaPagoEventoQtd: 0,
      saidasTotalEvento: 0,
      liquidoEvento: 0,
      eventos: 0,
      fallbackEspelho: 0
    };
  }
  const qualidade = {
    eventosLegadoAno: 0,
    eventosComMovRecebimento: 0,
    eventosComFallbackEspelho: 0,
    eventosSemRecebimento: 0
  };

  for (let i = 1; i < movData.length; i++) {
    const row = movData[i];
    const idEvento = String(row[m('ID_EVENTO')] || '').trim();
    if (!idEvento) continue;

    const tipo = String(row[m('TIPO_MOVIMENTACAO')] || '').trim();
    const status = statusFinanceiroNormalizado_(row[m('STATUS')]);
    if (status === 'CANCELADO') continue;

    const valor = Number(row[m('VALOR')]) || 0;
    const idContraparte = String(row[m('ID_CONTRAPARTE')] || '').trim();
    const nomeContraparte = String(row[m('CONTRAPARTE')] || '').trim();
    const dtInfo = extrairAnoMesFinanceiro_(row[m('DATA_MOVIMENTACAO')]);

    if (!mapaComissaoEvento[idEvento]) {
      mapaComissaoEvento[idEvento] = { gerado: 0, pago: 0 };
    }
    if (tipo === 'COMISSAO_GERADA') {
      mapaComissaoEvento[idEvento].gerado += valor;
      if (status === 'PROCESSADO') mapaComissaoEvento[idEvento].pago += valor;

      // Ranking de vendedores no dashboard deve refletir o ano selecionado.
      if (dtInfo.ano === ano) {
        const chaveVend = idContraparte || nomeContraparte || 'SEM_VENDEDOR';
        if (!rankingVendedores[chaveVend]) {
          rankingVendedores[chaveVend] = {
            idVendedor: idContraparte,
            nomeVendedor: nomeContraparte || 'Sem identificação',
            gerado: 0,
            pago: 0
          };
        }
        rankingVendedores[chaveVend].gerado += valor;
        if (status === 'PROCESSADO') rankingVendedores[chaveVend].pago += valor;
      }
    }

    if (dtInfo.ano === ano && dtInfo.mes >= 1 && dtInfo.mes <= 12) {
      if (tipo === 'RECEBIMENTO_CLIENTE' && status === 'PROCESSADO') mensal[dtInfo.mes].recebido += valor;
      if (tipo === 'ESTORNO_RECEBIMENTO' && status === 'PROCESSADO') mensal[dtInfo.mes].recebido -= valor;
      if (tipo === 'COMISSAO_GERADA' && status === 'PROCESSADO') mensal[dtInfo.mes].comissaoPaga += valor;
      if (tipo === 'BV_EVENTO' && status === 'PROCESSADO') mensal[dtInfo.mes].bvPago += valor;
      if (tipo === 'FOLHA_EVENTO' && status === 'PROCESSADO') mensal[dtInfo.mes].folha += valor;
    }
  }

  const resumo = {
    eventos: { total: 0, ativos: 0, cancelados: 0, quitados: 0, parciais: 0, abertos: 0 },
    financeiro: { contrato: 0, recebido: 0, pendente: 0, percRecebido: 0 },
    saidas: { bvProcessado: 0, bvPendente: 0, nfProcessada: 0, nfPendente: 0, folhaTotal: 0, folhaEventos: 0 }
  };
  const riscos = [];
  const funil = { reservas: 0, eventos: 0, reunioes: 0, bloqueios: 0 };
  const proximos30dias = [];
  const anosDisponiveisSet = {};

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const limite30 = new Date(hoje.getTime());
  limite30.setDate(limite30.getDate() + 30);

  for (let i = 1; i < evtData.length; i++) {
    const row = evtData[i];
    const idEvento = String(row[e('ID_EVENTO')] || '').trim();
    if (!idEvento) continue;

    const tipoRegistro = String(row[e('TIPO_REGISTRO')] || '').trim();
    if (tipoRegistro === 'Evento') funil.eventos++;
    if (tipoRegistro === 'Reserva') funil.reservas++;
    if (tipoRegistro === 'Reuniao') funil.reunioes++;
    if (tipoRegistro === 'Bloqueio') funil.bloqueios++;

    if (tipoRegistro !== 'Evento') continue;

    const dataEvtInfo = extrairAnoMesFinanceiro_(row[e('DATA_EVENTO')]);
    if (Number(dataEvtInfo.ano) > 0) anosDisponiveisSet[String(dataEvtInfo.ano)] = true;
    if (dataEvtInfo.ano !== ano) continue;

    const statusEvt = String(row[e('STATUS_GERAL')] || 'ATIVO');
    if (!incluirCancelados && statusEvt === 'CANCELADO') continue;

    resumo.eventos.total++;
    if (statusEvt === 'CANCELADO') resumo.eventos.cancelados++;
    else resumo.eventos.ativos++;

    const valorTotal = Number(row[e('VALOR_TOTAL')]) || 0;
    resumo.financeiro.contrato += valorTotal;

    const bucket = mapaMov[idEvento] || {
      recebido: 0,
      bv: { processado: 0, pendente: 0, valorProcessado: 0 },
      nf: { processado: 0, pendente: 0, valorProcessado: 0 },
      folha: { processado: 0, valorProcessado: 0 }
    };
    const recebido = Number((bucket.recebido || 0).toFixed(2));
    const recebidoEspelho = Number(row[e('VALOR_RECEBIDO')]) || 0;
    const pendente = Number(Math.max(valorTotal - recebido, 0).toFixed(2));
    resumo.financeiro.recebido += recebido;
    resumo.financeiro.pendente += pendente;

    mensalEvento[dataEvtInfo.mes].contratado += valorTotal;
    mensalEvento[dataEvtInfo.mes].eventos += 1;
    let recebidoHibrido = recebido;
    if (recebido > 0) {
      qualidade.eventosComMovRecebimento++;
    } else if (recebidoEspelho > 0) {
      recebidoHibrido = recebidoEspelho;
      mensalEvento[dataEvtInfo.mes].fallbackEspelho += 1;
      qualidade.eventosComFallbackEspelho++;
    } else {
      qualidade.eventosSemRecebimento++;
    }
    mensalEvento[dataEvtInfo.mes].recebidoHibrido += recebidoHibrido;
    const comissaoGeradaEvento = Number((mapaComissaoEvento[idEvento]?.gerado || 0).toFixed(2));
    const comissaoPagaEvento = Number((mapaComissaoEvento[idEvento]?.pago || 0).toFixed(2));
    const comissaoPendenteEvento = Number(Math.max(comissaoGeradaEvento - comissaoPagaEvento, 0).toFixed(2));
    const bvPagoEvento = Number((bucket.bv.valorProcessado || 0).toFixed(2));
    const nfPagoEvento = Number((bucket.nf.valorProcessado || 0).toFixed(2));
    const folhaPagoEvento = Number((bucket.folha.valorProcessado || 0).toFixed(2));
    const saidasTotalEvento = Number((comissaoPagaEvento + bvPagoEvento + nfPagoEvento + folhaPagoEvento).toFixed(2));
    const liquidoEvento = Number((recebidoHibrido - saidasTotalEvento).toFixed(2));

    mensalEvento[dataEvtInfo.mes].comissaoGeradaEvento += comissaoGeradaEvento;
    mensalEvento[dataEvtInfo.mes].comissaoPendenteEvento += comissaoPendenteEvento;
    mensalEvento[dataEvtInfo.mes].comissaoPagaEvento += comissaoPagaEvento;
    mensalEvento[dataEvtInfo.mes].bvPagoEvento += bvPagoEvento;
    mensalEvento[dataEvtInfo.mes].nfPagoEvento += nfPagoEvento;
    mensalEvento[dataEvtInfo.mes].folhaPagoEvento += folhaPagoEvento;
    if (comissaoPagaEvento > 0) mensalEvento[dataEvtInfo.mes].comissaoPagaEventoQtd += 1;
    if (bvPagoEvento > 0) mensalEvento[dataEvtInfo.mes].bvPagoEventoQtd += 1;
    if (nfPagoEvento > 0) mensalEvento[dataEvtInfo.mes].nfPagoEventoQtd += 1;
    if (folhaPagoEvento > 0) mensalEvento[dataEvtInfo.mes].folhaPagoEventoQtd += 1;
    mensalEvento[dataEvtInfo.mes].saidasTotalEvento += saidasTotalEvento;
    mensalEvento[dataEvtInfo.mes].liquidoEvento += liquidoEvento;

    if (String(row[e('OBSERVACOES')] || '').indexOf('[LEGADO]') !== -1) {
      qualidade.eventosLegadoAno++;
    }

    if (recebido <= 0) resumo.eventos.abertos++;
    else if (pendente > 0) resumo.eventos.parciais++;
    else resumo.eventos.quitados++;

    const valorBV = Number(row[e('VALOR_BV')]) || 0;
    const temNF = String(row[e('TEM_NF')] || '').toUpperCase() === 'TRUE';
    const valorFolhaMov = Number((bucket.folha.valorProcessado || 0).toFixed(2));

    if (valorBV > 0) {
      if ((bucket.bv.processado || 0) > 0) resumo.saidas.bvProcessado++;
      else resumo.saidas.bvPendente++;
    }
    if (temNF) {
      if ((bucket.nf.processado || 0) > 0) resumo.saidas.nfProcessada++;
      else resumo.saidas.nfPendente++;
    }
    if (valorFolhaMov > 0) {
      resumo.saidas.folhaEventos++;
      resumo.saidas.folhaTotal += valorFolhaMov;
    }

    const statusReceb = statusRecebimentoInterno_(recebido, valorTotal);
    if (statusReceb === 'QUITADO' && valorBV > 0 && (bucket.bv.processado || 0) === 0) {
      riscos.push({
        idEvento: idEvento,
        severidade: 'CRITICO',
        tipo: 'EVENTO_QUITADO_COM_BV_PENDENTE',
        nomeEvento: `${row[e('TIPO_EVENTO')]} - ${row[e('NOME_CONTRATANTE')]}`,
        dataEvento: row[e('DATA_EVENTO')]
      });
    }
    if (statusReceb === 'QUITADO' && temNF && (bucket.nf.processado || 0) === 0) {
      riscos.push({
        idEvento: idEvento,
        severidade: 'CRITICO',
        tipo: 'EVENTO_QUITADO_COM_NF_PENDENTE',
        nomeEvento: `${row[e('TIPO_EVENTO')]} - ${row[e('NOME_CONTRATANTE')]}`,
        dataEvento: row[e('DATA_EVENTO')]
      });
    }
    if ((bucket.bv.processado || 0) > 1) {
      riscos.push({
        idEvento: idEvento,
        severidade: 'ALTO',
        tipo: 'DUPLICIDADE_BV_PROCESSADO',
        nomeEvento: `${row[e('TIPO_EVENTO')]} - ${row[e('NOME_CONTRATANTE')]}`,
        dataEvento: row[e('DATA_EVENTO')]
      });
    }

    const dataEventoNorm = normalizarData(row[e('DATA_EVENTO')]);
    if (dataEventoNorm && dataEventoNorm >= hoje && dataEventoNorm <= limite30) {
      proximos30dias.push({
        idEvento: idEvento,
        dataEvento: row[e('DATA_EVENTO')],
        nomeEvento: `${row[e('TIPO_EVENTO')]} - ${row[e('NOME_CONTRATANTE')]}`,
        statusRecebimento: statusReceb,
        valorPendente: pendente
      });
    }
  }

  resumo.financeiro.contrato = Number(resumo.financeiro.contrato.toFixed(2));
  resumo.financeiro.recebido = Number(resumo.financeiro.recebido.toFixed(2));
  resumo.financeiro.pendente = Number(resumo.financeiro.pendente.toFixed(2));
  resumo.saidas.folhaTotal = Number(resumo.saidas.folhaTotal.toFixed(2));
  resumo.financeiro.percRecebido = resumo.financeiro.contrato > 0
    ? Number(((resumo.financeiro.recebido / resumo.financeiro.contrato) * 100).toFixed(2))
    : 0;

  const vendedores = Object.keys(rankingVendedores).map(function (k) {
    const v = rankingVendedores[k];
    const pendente = Math.max(v.gerado - v.pago, 0);
    return {
      idVendedor: v.idVendedor || '',
      nomeVendedor: v.nomeVendedor || 'Sem identificação',
      gerado: Number(v.gerado.toFixed(2)),
      pago: Number(v.pago.toFixed(2)),
      pendente: Number(pendente.toFixed(2))
    };
  }).sort(function (a, b) {
    return b.pago - a.pago;
  }).slice(0, 10);

  const mensalLista = [];
  const contratadoLista = [];
  const recebidoHibridoLista = [];
  const comissaoGeradaEventoLista = [];
  const comissaoPagaEventoLista = [];
  const saidasEventoLista = [];
  const liquidoEventoLista = [];
  let totalContratadoEvento = 0;
  let totalRecebidoHibridoEvento = 0;
  let totalComissaoGeradaEvento = 0;
  let totalComissaoPendenteEvento = 0;
  let totalComissaoPagaEvento = 0;
  let totalBvPagoEvento = 0;
  let totalNfPagoEvento = 0;
  let totalFolhaPagoEvento = 0;
  let totalComissaoPagaEventoQtd = 0;
  let totalBvPagoEventoQtd = 0;
  let totalNfPagoEventoQtd = 0;
  let totalFolhaPagoEventoQtd = 0;
  let totalSaidasEvento = 0;
  let totalLiquidoEvento = 0;
  for (let mes = 1; mes <= 12; mes++) {
    mensalLista.push({
      mes: mes,
      recebido: Number((mensal[mes].recebido || 0).toFixed(2)),
      comissaoPaga: Number((mensal[mes].comissaoPaga || 0).toFixed(2)),
      bvPago: Number((mensal[mes].bvPago || 0).toFixed(2)),
      folha: Number((mensal[mes].folha || 0).toFixed(2))
    });
    const contratadoMes = Number((mensalEvento[mes].contratado || 0).toFixed(2));
    const recebidoHibridoMes = Number((mensalEvento[mes].recebidoHibrido || 0).toFixed(2));
    const comissaoGeradaEventoMes = Number((mensalEvento[mes].comissaoGeradaEvento || 0).toFixed(2));
    const comissaoPendenteEventoMes = Number((mensalEvento[mes].comissaoPendenteEvento || 0).toFixed(2));
    const comissaoPagaEventoMes = Number((mensalEvento[mes].comissaoPagaEvento || 0).toFixed(2));
    const bvPagoEventoMes = Number((mensalEvento[mes].bvPagoEvento || 0).toFixed(2));
    const nfPagoEventoMes = Number((mensalEvento[mes].nfPagoEvento || 0).toFixed(2));
    const folhaPagoEventoMes = Number((mensalEvento[mes].folhaPagoEvento || 0).toFixed(2));
    const comissaoPagaEventoQtdMes = Number(mensalEvento[mes].comissaoPagaEventoQtd || 0);
    const bvPagoEventoQtdMes = Number(mensalEvento[mes].bvPagoEventoQtd || 0);
    const nfPagoEventoQtdMes = Number(mensalEvento[mes].nfPagoEventoQtd || 0);
    const folhaPagoEventoQtdMes = Number(mensalEvento[mes].folhaPagoEventoQtd || 0);
    const saidasTotalEventoMes = Number((mensalEvento[mes].saidasTotalEvento || 0).toFixed(2));
    const liquidoEventoMes = Number((mensalEvento[mes].liquidoEvento || 0).toFixed(2));
    contratadoLista.push({
      mes: mes,
      valor: contratadoMes,
      eventos: Number(mensalEvento[mes].eventos || 0)
    });
    recebidoHibridoLista.push({
      mes: mes,
      valor: recebidoHibridoMes,
      fallbackEspelho: Number(mensalEvento[mes].fallbackEspelho || 0)
    });
    comissaoGeradaEventoLista.push({
      mes: mes,
      valor: comissaoGeradaEventoMes,
      pendente: comissaoPendenteEventoMes
    });
    comissaoPagaEventoLista.push({
      mes: mes,
      valor: comissaoPagaEventoMes
    });
    saidasEventoLista.push({
      mes: mes,
      valor: saidasTotalEventoMes,
      comissaoPaga: comissaoPagaEventoMes,
      bvPago: bvPagoEventoMes,
      nfPago: nfPagoEventoMes,
      folhaPago: folhaPagoEventoMes,
      comissaoPagaQtd: comissaoPagaEventoQtdMes,
      bvPagoQtd: bvPagoEventoQtdMes,
      nfPagoQtd: nfPagoEventoQtdMes,
      folhaPagoQtd: folhaPagoEventoQtdMes
    });
    liquidoEventoLista.push({
      mes: mes,
      valor: liquidoEventoMes
    });
    totalContratadoEvento += contratadoMes;
    totalRecebidoHibridoEvento += recebidoHibridoMes;
    totalComissaoGeradaEvento += comissaoGeradaEventoMes;
    totalComissaoPendenteEvento += comissaoPendenteEventoMes;
    totalComissaoPagaEvento += comissaoPagaEventoMes;
    totalBvPagoEvento += bvPagoEventoMes;
    totalNfPagoEvento += nfPagoEventoMes;
    totalFolhaPagoEvento += folhaPagoEventoMes;
    totalComissaoPagaEventoQtd += comissaoPagaEventoQtdMes;
    totalBvPagoEventoQtd += bvPagoEventoQtdMes;
    totalNfPagoEventoQtd += nfPagoEventoQtdMes;
    totalFolhaPagoEventoQtd += folhaPagoEventoQtdMes;
    totalSaidasEvento += saidasTotalEventoMes;
    totalLiquidoEvento += liquidoEventoMes;
  }

  riscos.sort(function (a, b) {
    if (a.severidade === b.severidade) return 0;
    if (a.severidade === 'CRITICO') return -1;
    if (b.severidade === 'CRITICO') return 1;
    return 0;
  });

  proximos30dias.sort(function (a, b) {
    const da = normalizarData(a.dataEvento);
    const db = normalizarData(b.dataEvento);
    if (da && db) return da - db;
    return 0;
  });

  const resultado = {
    sucesso: true,
    ano: ano,
    anosDisponiveis: Object.keys(anosDisponiveisSet).map(function (k) { return Number(k); }).filter(function (n) { return Number.isFinite(n) && n > 0; }).sort(function (a, b) { return a - b; }),
    resumo: resumo,
    visaoMensal: {
      contratado: contratadoLista,
      recebidoHibrido: recebidoHibridoLista,
      comissaoGeradaEvento: comissaoGeradaEventoLista,
      comissaoPagaEvento: comissaoPagaEventoLista,
      saidasEvento: saidasEventoLista,
      liquidoEvento: liquidoEventoLista,
      totais: {
        contratado: Number(totalContratadoEvento.toFixed(2)),
        recebidoHibrido: Number(totalRecebidoHibridoEvento.toFixed(2)),
        comissaoGeradaEvento: Number(totalComissaoGeradaEvento.toFixed(2)),
        comissaoPendenteEvento: Number(totalComissaoPendenteEvento.toFixed(2)),
        comissaoPagaEvento: Number(totalComissaoPagaEvento.toFixed(2)),
        bvPagoEvento: Number(totalBvPagoEvento.toFixed(2)),
        nfPagoEvento: Number(totalNfPagoEvento.toFixed(2)),
        folhaPagoEvento: Number(totalFolhaPagoEvento.toFixed(2)),
        comissaoPagaEventoQtd: Number(totalComissaoPagaEventoQtd || 0),
        bvPagoEventoQtd: Number(totalBvPagoEventoQtd || 0),
        nfPagoEventoQtd: Number(totalNfPagoEventoQtd || 0),
        folhaPagoEventoQtd: Number(totalFolhaPagoEventoQtd || 0),
        saidasTotalEvento: Number(totalSaidasEvento.toFixed(2)),
        liquidoEvento: Number(totalLiquidoEvento.toFixed(2))
      },
      qualidade: qualidade
    },
    riscos: riscos.slice(0, 40),
    vendedores: vendedores,
    mensal: mensalLista,
    funil: funil,
    proximos30dias: proximos30dias.slice(0, 30)
  };
  try { cache.put(cacheKey, JSON.stringify(resultado), ttlSeg); } catch (_) {}
  return resultado;
}

function extrairAnoMesFinanceiro_(dataBruta) {
  const d = normalizarData(dataBruta);
  if (!d || isNaN(d.getTime())) {
    return { ano: 0, mes: 0 };
  }
  return {
    ano: d.getFullYear(),
    mes: d.getMonth() + 1
  };
}

function agruparMovimentacoesFinanceirasPorEvento_(movData) {
  const mapa = {};
  if (!Array.isArray(movData) || movData.length < 2) return mapa;

  for (let i = 1; i < movData.length; i++) {
    const row = movData[i];
    const idEvento = String(row[3] || '').trim();
    if (!idEvento) continue;

    const tipo = String(row[1] || '').trim();
    const status = statusFinanceiroNormalizado_(row[15]);
    if (status === 'CANCELADO') continue;

    const valor = Number(row[6]) || 0;
    const bucket = mapa[idEvento] || {
      recebido: 0,
      bv: { processado: 0, pendente: 0, valorProcessado: 0 },
      nf: { processado: 0, pendente: 0, valorProcessado: 0 },
      folha: { processado: 0, valorProcessado: 0 }
    };

    if (tipo === 'RECEBIMENTO_CLIENTE' && status === 'PROCESSADO') {
      bucket.recebido += valor;
    } else if (tipo === 'ESTORNO_RECEBIMENTO' && status === 'PROCESSADO') {
      bucket.recebido -= valor;
    } else if (tipo === 'BV_EVENTO') {
      if (status === 'PROCESSADO') {
        bucket.bv.processado += 1;
        bucket.bv.valorProcessado += valor;
      } else if (status === 'PENDENTE') {
        bucket.bv.pendente += 1;
      }
    } else if (tipo === 'NF_EVENTO') {
      if (status === 'PROCESSADO') {
        bucket.nf.processado += 1;
        bucket.nf.valorProcessado += valor;
      } else if (status === 'PENDENTE') {
        bucket.nf.pendente += 1;
      }
    } else if (tipo === 'FOLHA_EVENTO' && status === 'PROCESSADO') {
      bucket.folha.processado += 1;
      bucket.folha.valorProcessado += valor;
    }

    mapa[idEvento] = bucket;
  }

  return mapa;
}

function lerSaudeFinanceiraEvento_(idEvento, eventosData, movData, mapaMovPorEvento) {
  const evtHead = Array.isArray(eventosData) && eventosData.length > 0 ? eventosData[0] : [];
  const idxEvt = function (nome, fallback) {
    const pos = Array.isArray(evtHead) ? evtHead.indexOf(nome) : -1;
    return pos >= 0 ? pos : fallback;
  };
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
  const idBV = String(evento[COL.ID_BV] || '').trim();
  const nomeBV = String(evento[COL.NOME_BV] || '').trim();
  const valorNF = Number(evento[COL.VALOR_NF]) || 0;
  const temNF = evento[COL.TEM_NF] === true || String(evento[COL.TEM_NF] || '').toUpperCase() === 'TRUE';
  const statusEvento = evento[COL.STATUS_GERAL] || 'ATIVO';
  const statusBVEspelho = String(evento[idxEvt('STATUS_BV', COL.STATUS_BV)] || 'N/A');
  const statusNFEspelho = String(evento[idxEvt('STATUS_NF', COL.STATUS_NF)] || 'N/A');
  const folhaEspelho = Number(evento[idxEvt('FOLHA_CUSTO_VALOR', COL.FOLHA_CUSTO_VALOR)]) || 0;

  const bucket = (mapaMovPorEvento && mapaMovPorEvento[idEvento]) || {
    recebido: 0,
    bv: { processado: 0, pendente: 0, valorProcessado: 0 },
    nf: { processado: 0, pendente: 0, valorProcessado: 0 },
    folha: { processado: 0, valorProcessado: 0 }
  };

  const totalRecebido = Number((bucket.recebido || 0).toFixed(2));
  const bvPago = (bucket.bv.processado || 0) > 0;
  const nfProcessada = (bucket.nf.processado || 0) > 0;
  const folhaExiste = (bucket.folha.processado || 0) > 0;
  const folhaMov = Number((bucket.folha.valorProcessado || 0).toFixed(2));

  const pendente = Math.max(0, valorTotal - totalRecebido);

  const alertas = [];
  const divergencias = [];
  if (eventoJaOcorreu && totalRecebido === 0 && valorTotal > 0) {
    alertas.push('EVENTO_OCORREU_SEM_RECEBIMENTO');
  }
  if (eventoJaOcorreu && totalRecebido > 0 && pendente > 0) {
    alertas.push('EVENTO_OCORREU_RECEBIMENTO_PARCIAL');
  }
  if (totalRecebido > valorTotal + 0.01) {
    alertas.push('INCONSISTENCIA_RECEBIDO_MAIOR_QUE_CONTRATO');
  }
  if (valorBV > 0 && !bvPago) {
    alertas.push('BV_PENDENTE');
  }
  if (statusRecebimentoInterno_(totalRecebido, valorTotal) === 'QUITADO' && valorBV > 0 && !bvPago) {
    alertas.push('EVENTO_QUITADO_COM_BV_PENDENTE');
  }
  if (statusRecebimentoInterno_(totalRecebido, valorTotal) === 'QUITADO' && temNF && !nfProcessada) {
    alertas.push('EVENTO_QUITADO_COM_NF_PENDENTE');
  }
  if (eventoJaOcorreu && !folhaExiste) {
    alertas.push('FOLHA_NAO_REGISTRADA');
  }
  if ((bucket.bv.processado || 0) > 1) alertas.push('DUPLICIDADE_BV_PROCESSADO');
  if ((bucket.nf.processado || 0) > 1) alertas.push('DUPLICIDADE_NF_PROCESSADO');
  if ((bucket.folha.processado || 0) > 1) alertas.push('DUPLICIDADE_FOLHA_PROCESSADA');

  const statusBVCalculado = valorBV > 0 ? (bvPago ? 'PROCESSADO' : 'PENDENTE') : 'N/A';
  const statusNFCalculado = temNF ? (nfProcessada ? 'PROCESSADO' : 'PENDENTE') : 'N/A';
  if (statusFinanceiroNormalizado_(statusBVEspelho) !== statusFinanceiroNormalizado_(statusBVCalculado)) {
    divergencias.push('STATUS_BV_ESPELHO_DIVERGENTE');
  }
  if (statusFinanceiroNormalizado_(statusNFEspelho) !== statusFinanceiroNormalizado_(statusNFCalculado)) {
    divergencias.push('STATUS_NF_ESPELHO_DIVERGENTE');
  }
  if (Math.abs(folhaEspelho - folhaMov) > 0.01) {
    divergencias.push('FOLHA_CUSTO_ESPELHO_DIVERGENTE');
  }

  let status = 'ok';
  const alertasCriticos = alertas.filter(a => !alertaEhSomenteInformativo_(a));
  if (divergencias.length > 0 || alertasCriticos.length > 0) status = 'alerta';

  return {
    idEvento: evento[COL.ID_EVENTO],
    tipoEvento: String(evento[COL.TIPO_EVENTO] || ''),
    nomeEvento: `${evento[COL.TIPO_EVENTO]} - ${evento[COL.NOME_CONTRATANTE]}`,
    nomeContratante: String(evento[COL.NOME_CONTRATANTE] || ''),
    dataEvento: evento[COL.DATA_EVENTO],
    statusEvento,
    status,
    alertas,
    divergencias,
    resumoFinanceiro: {
      valorContrato: valorTotal,
      totalRecebido,
      valorPendente: pendente,
      statusRecebimento: statusRecebimentoInterno_(totalRecebido, valorTotal)
    },
    custos: {
      nf: { existe: temNF, valor: valorNF, status: statusNFCalculado, pendente: temNF && !nfProcessada },
      bv: {
        existe: valorBV > 0,
        valor: valorBV,
        status: statusBVCalculado,
        pendente: valorBV > 0 && !bvPago,
        idParceiro: idBV,
        nomeParceiro: nomeBV
      },
      folha: { existe: folhaExiste, valor: folhaMov }
    },
    acoes: {
      podeReceber: pendente > 0 && statusEvento === 'ATIVO',
      podePagarBV: valorBV > 0 && !bvPago,
      podeRegistrarFolha: eventoJaOcorreu && !folhaExiste
    },
    metadados: {
      tipoRegistro: String(evento[COL.TIPO_REGISTRO] || ''),
      legado: String(evento[idxEvt('CRIADO_POR', COL.CRIADO_POR)] || '').toLowerCase().indexOf('migracao') !== -1,
      statusBVEspelho: statusBVEspelho,
      statusNFEspelho: statusNFEspelho
    }
  };
}

function statusRecebimentoInterno_(totalRecebido, valorTotal) {
  if (totalRecebido <= 0) return 'EM_ABERTO';
  if (totalRecebido < valorTotal) return 'PARCIAL';
  return 'QUITADO';
}

function normalizarStatusRecebimentoLegado_(statusRaw, totalRecebido, valorTotal) {
  const status = String(statusRaw || '').trim().toUpperCase();
  if (status === 'N/A') return 'N/A';
  if (status === 'QUITADO') return 'QUITADO';
  if (status === 'PARCIAL') return 'PARCIAL';
  if (status === 'EM_ABERTO' || status === 'ABERTO') return 'EM_ABERTO';
  if (status === 'PENDENTE') {
    if ((Number(totalRecebido) || 0) > 0 && (Number(valorTotal) || 0) > (Number(totalRecebido) || 0)) {
      return 'PARCIAL';
    }
    return 'EM_ABERTO';
  }
  return statusRecebimentoInterno_(Number(totalRecebido) || 0, Number(valorTotal) || 0);
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
  const statusRecebimento = normalizarStatusRecebimentoLegado_(
    evtRow[e('STATUS_RECEBIMENTO')],
    Number(evtRow[e('VALOR_RECEBIDO')]) || 0,
    Number(evtRow[e('VALOR_TOTAL')]) || 0
  );

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
  const idEventoFiltro = String((params && params.idEvento) || '').trim();
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
    'TIPO_REGISTRO',
    'STATUS_GERAL',
    'VALOR_RECEBIDO',
    'VALOR_PENDENTE',
    'VALOR_TOTAL',
    'VALOR_BV',
    'STATUS_BV',
    'TEM_NF',
    'VALOR_NF',
    'STATUS_NF',
    'FOLHA_CUSTO_VALOR',
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
        comissaoPagaPorVendedor: {},
        bvProcessado: 0,
        nfProcessado: 0,
        folhaProcessada: 0,
        valorFolhaProcessada: 0
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
    } else if (tipo === 'BV_EVENTO' && status === 'PROCESSADO') {
      mapaMov[idEvento].bvProcessado += 1;
    } else if (tipo === 'NF_EVENTO' && status === 'PROCESSADO') {
      mapaMov[idEvento].nfProcessado += 1;
    } else if (tipo === 'FOLHA_EVENTO' && status === 'PROCESSADO') {
      mapaMov[idEvento].folhaProcessada += 1;
      mapaMov[idEvento].valorFolhaProcessada += valor;
    }
  }

  const divergencias = [];
  const tolerancia = 0.01;
  let eventosAnalisados = 0;

  for (let i = 1; i < evtData.length; i++) {
    const row = evtData[i];
    const idEvento = String(row[e('ID_EVENTO')] || '').trim();
    if (!idEvento) continue;
    if (idEventoFiltro && idEvento !== idEventoFiltro) continue;

    // Mantém o mesmo recorte operacional de listarEventosFinanceiros:
    // apenas eventos reais e status válidos para o fluxo financeiro.
    const tipoRegistro = String(row[e('TIPO_REGISTRO')] || '').trim();
    const statusGeral = String(row[e('STATUS_GERAL')] || '').trim();
    if (tipoRegistro !== 'Evento') continue;
    if (!['ATIVO', 'CANCELADO'].includes(statusGeral)) continue;

    eventosAnalisados++;

    const idVendedor = String(row[e('ID_VENDEDOR')] || '').trim();
    const valorTotal = Number(row[e('VALOR_TOTAL')]) || 0;
    const valorRecebidoEspelho = Number(row[e('VALOR_RECEBIDO')]) || 0;
    const valorPendenteEspelho = Number(row[e('VALOR_PENDENTE')]) || 0;
    const valorComissaoPagaEspelho = Number(row[e('VALOR_COMISSAO_PAGO')]) || 0;
    const valorComissaoEsperada = Number(row[e('VALOR_COMISSAO_CALCULADO')]) || 0;
    const statusComissaoEspelho = String(row[e('STATUS_COMISSAO')] || '');
    const valorBVEspelho = Number(row[e('VALOR_BV')]) || 0;
    const statusBVEspelho = String(row[e('STATUS_BV')] || 'N/A');
    const temNFEspelho = String(row[e('TEM_NF')] || '').toUpperCase() === 'TRUE';
    const statusNFEspelho = String(row[e('STATUS_NF')] || 'N/A');
    const folhaEspelho = Number(row[e('FOLHA_CUSTO_VALOR')]) || 0;

    const mov = mapaMov[idEvento] || {
      recebidoLiquido: 0,
      comissaoGeradaPorVendedor: {},
      comissaoPagaPorVendedor: {},
      bvProcessado: 0,
      nfProcessado: 0,
      folhaProcessada: 0,
      valorFolhaProcessada: 0
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

    const statusBVEsperado = valorBVEspelho > 0
      ? ((mov.bvProcessado || 0) > 0 ? 'PROCESSADO' : 'PENDENTE')
      : 'N/A';
    if (statusFinanceiroNormalizado_(statusBVEspelho) !== statusFinanceiroNormalizado_(statusBVEsperado)) {
      divergencias.push({
        idEvento: idEvento,
        tipo: 'STATUS_BV_DIVERGENTE',
        esperado: statusBVEsperado,
        atual: statusBVEspelho || 'N/A'
      });
    }

    const statusNFEsperado = temNFEspelho
      ? ((mov.nfProcessado || 0) > 0 ? 'PROCESSADO' : 'PENDENTE')
      : 'N/A';
    if (statusFinanceiroNormalizado_(statusNFEspelho) !== statusFinanceiroNormalizado_(statusNFEsperado)) {
      divergencias.push({
        idEvento: idEvento,
        tipo: 'STATUS_NF_DIVERGENTE',
        esperado: statusNFEsperado,
        atual: statusNFEspelho || 'N/A'
      });
    }

    const folhaEsperada = Number((mov.valorFolhaProcessada || 0).toFixed(2));
    if (Math.abs(folhaEspelho - folhaEsperada) > tolerancia) {
      divergencias.push({
        idEvento: idEvento,
        tipo: 'FOLHA_CUSTO_VALOR_DIVERGENTE',
        esperado: folhaEsperada,
        atual: Number(folhaEspelho.toFixed(2))
      });
    }

    if ((mov.bvProcessado || 0) > 1) {
      divergencias.push({
        idEvento: idEvento,
        tipo: 'DUPLICIDADE_BV_PROCESSADO',
        esperado: 1,
        atual: mov.bvProcessado
      });
    }
    if ((mov.nfProcessado || 0) > 1) {
      divergencias.push({
        idEvento: idEvento,
        tipo: 'DUPLICIDADE_NF_PROCESSADO',
        esperado: 1,
        atual: mov.nfProcessado
      });
    }
    if ((mov.folhaProcessada || 0) > 1) {
      divergencias.push({
        idEvento: idEvento,
        tipo: 'DUPLICIDADE_FOLHA_PROCESSADA',
        esperado: 1,
        atual: mov.folhaProcessada
      });
    }

    if (divergencias.length >= limite) break;
  }

  const eventosComDivergencia = {};
  for (let i = 0; i < divergencias.length; i++) {
    eventosComDivergencia[divergencias[i].idEvento] = true;
  }

  return {
    sucesso: true,
    resumo: {
      eventosAnalisados: eventosAnalisados,
      divergencias: divergencias.length,
      eventosComDivergencia: Object.keys(eventosComDivergencia).length,
      truncadoNoLimite: divergencias.length >= limite
    },
    divergencias: divergencias
  };
}

function reconciliarResumoFinanceiroEvento(idEvento) {
  const usuario = exigirAcao('eventos:editar');
  if (String((usuario && usuario.PERFIL) || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: eventos:reconciliarFinanceiro');
  }
  const alvo = String(idEvento || '').trim();
  if (!alvo) throw new Error('ID_EVENTO_OBRIGATORIO');

  return executarComLockFinanceiro_('RECONCILIAR_RESUMO_EVENTO', function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const shEvt = ss.getSheetByName('EVENTOS');
    const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    if (!shEvt || !shMov) throw new Error('Planilhas EVENTOS ou MOVIMENTACOES_FINANCEIRAS não encontradas');

    const evtData = shEvt.getDataRange().getValues();
    const movData = shMov.getDataRange().getValues();
    const evtHead = evtData[0];
    const movHead = movData[0] || [];
    const e = function (c) { return evtHead.indexOf(c); };
    const m = function (c) { return movHead.indexOf(c); };
    const rowIdx = evtData.findIndex(function (r, idx) {
      return idx > 0 && String(r[e('ID_EVENTO')] || '').trim() === alvo;
    });
    if (rowIdx === -1) throw new Error('EVENTO_NAO_ENCONTRADO');

    const resumo = buscarResumoFinanceiroEvento(alvo);
    if (!resumo) throw new Error('RESUMO_FINANCEIRO_INDISPONIVEL');

    const rowNumber = rowIdx + 1;
    const valorRecebido = Number(resumo.valorRecebidoAteAgora || 0);
    const valorPendente = Number(resumo.valorPendente || 0);
    const statusRecebimento = String(resumo.statusRecebimento || 'EM_ABERTO');
    const statusBV = String(resumo.statusBV || 'N/A');
    const statusNF = String(resumo.statusNF || 'N/A');
    const folhaValor = Number(resumo.folhaCustoValor || 0);
    const idVendedorEvento = String(evtData[rowIdx][e('ID_VENDEDOR')] || '').trim();
    const valorComissaoEsperada = Number(evtData[rowIdx][e('VALOR_COMISSAO_CALCULADO')]) || 0;

    let totalComissaoGerada = 0;
    let totalComissaoPaga = 0;
    const idxTipoMov = m('TIPO_MOVIMENTACAO');
    const idxStatusMov = m('STATUS');
    const idxIdEventoMov = m('ID_EVENTO');
    const idxIdContraparteMov = m('ID_CONTRAPARTE');
    const idxValorMov = m('VALOR');

    if (
      idxTipoMov >= 0 &&
      idxStatusMov >= 0 &&
      idxIdEventoMov >= 0 &&
      idxIdContraparteMov >= 0 &&
      idxValorMov >= 0 &&
      idVendedorEvento
    ) {
      for (let i = 1; i < movData.length; i++) {
        const row = movData[i];
        if (String(row[idxIdEventoMov] || '').trim() !== alvo) continue;
        if (String(row[idxIdContraparteMov] || '').trim() !== idVendedorEvento) continue;
        if (String(row[idxTipoMov] || '').trim() !== 'COMISSAO_GERADA') continue;

        const statusMov = statusFinanceiroNormalizado_(row[idxStatusMov]);
        if (statusMov === 'CANCELADO') continue;

        const valorMov = Number(row[idxValorMov]) || 0;
        totalComissaoGerada += valorMov;
        if (statusMov === 'PROCESSADO') {
          totalComissaoPaga += valorMov;
        }
      }
    }

    totalComissaoGerada = Number(totalComissaoGerada.toFixed(2));
    totalComissaoPaga = Number(totalComissaoPaga.toFixed(2));
    const totalComissaoPendente = Number(Math.max(totalComissaoGerada - totalComissaoPaga, 0).toFixed(2));
    const statusComissao = determinarStatusComissao_(
      Number(valorComissaoEsperada.toFixed(2)),
      totalComissaoGerada,
      totalComissaoPaga,
      totalComissaoPendente
    );

    const setIfExists_ = function (colName, value, contexto) {
      const idx = e(colName);
      if (idx >= 0) {
        setValueComVerificacao_(shEvt, rowNumber, idx + 1, value, contexto);
      }
    };

    setIfExists_('VALOR_RECEBIDO', Number(valorRecebido.toFixed(2)), 'EVENTOS/VALOR_RECEBIDO_RECONCILIAR');
    setIfExists_('VALOR_PENDENTE', Number(valorPendente.toFixed(2)), 'EVENTOS/VALOR_PENDENTE_RECONCILIAR');
    setIfExists_('STATUS_RECEBIMENTO', statusRecebimento, 'EVENTOS/STATUS_RECEBIMENTO_RECONCILIAR');
    setIfExists_('STATUS_BV', statusBV, 'EVENTOS/STATUS_BV_RECONCILIAR');
    setIfExists_('STATUS_NF', statusNF, 'EVENTOS/STATUS_NF_RECONCILIAR');
    setIfExists_('FOLHA_CUSTO_VALOR', Number(folhaValor.toFixed(2)), 'EVENTOS/FOLHA_CUSTO_VALOR_RECONCILIAR');
    setIfExists_('VALOR_COMISSAO_PAGO', Number(totalComissaoPaga.toFixed(2)), 'EVENTOS/VALOR_COMISSAO_PAGO_RECONCILIAR');
    setIfExists_('STATUS_COMISSAO', statusComissao, 'EVENTOS/STATUS_COMISSAO_RECONCILIAR');

    const setMetaBestEffort_ = function (colName, value, contexto) {
      const idx = e(colName);
      if (idx < 0) return;
      try {
        setValueComVerificacao_(shEvt, rowNumber, idx + 1, value, contexto);
      } catch (metaErr) {
        Logger.log('[RECONCILIAR_META_WARN] idEvento=' + alvo + ' col=' + colName + ' erro=' + String(metaErr));
      }
    };

    setMetaBestEffort_('ULTIMA_EDICAO', new Date(), 'EVENTOS/ULTIMA_EDICAO_RECONCILIAR');
    setMetaBestEffort_('EDITADO_POR', getUsuarioAtual().email, 'EVENTOS/EDITADO_POR_RECONCILIAR');

    return {
      sucesso: true,
      idEvento: alvo,
      resumoAtualizado: {
        valorRecebido: Number(valorRecebido.toFixed(2)),
        valorPendente: Number(valorPendente.toFixed(2)),
        statusRecebimento: statusRecebimento,
        statusBV: statusBV,
        statusNF: statusNF,
        folhaCustoValor: Number(folhaValor.toFixed(2)),
        valorComissaoPago: Number(totalComissaoPaga.toFixed(2)),
        statusComissao: statusComissao
      }
    };
  });
}
