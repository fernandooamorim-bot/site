/**
 * Módulo legado financeiro (migração/auditoria)
 * Extraído de gestao-eventos-financeiro.js em 2026-03-08
 * Mantém assinaturas para compatibilidade com api-auth e operações manuais.
 */

function migrarSaldoInicialFinanceiro(params) {
  exigirAcao('financeiro:migrarSaldoInicial');

  return executarComLockFinanceiro_('MIGRACAO_SALDO_INICIAL_FINANCEIRO', function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const shEvt = ss.getSheetByName('EVENTOS');
    const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    if (!shEvt || !shMov) {
      throw new Error('Planilhas EVENTOS e MOVIMENTACOES_FINANCEIRAS são obrigatórias para a migração.');
    }

    const usuario = getUsuarioAtual().email;
    const marcador = '[MIGRACAO_SALDO_INICIAL_V1]';
    const tagFechamentoLegado = 'LEGADO_SALDO_INICIAL';
    const permitirNaoEvento = String((params && params.incluirNaoEvento) || '').toUpperCase() === 'TRUE';

    const evtData = shEvt.getDataRange().getValues();
    const movData = shMov.getDataRange().getValues();
    if (evtData.length < 2) {
      return {
        sucesso: true,
        mensagem: 'Nenhum evento encontrado para migração.',
        marcador: marcador
      };
    }

    const evtHead = evtData[0];
    const movHead = movData[0];
    const e = function (c) { return evtHead.indexOf(c); };
    const m = function (c) { return movHead.indexOf(c); };

    const colunasEventos = [
      'ID_EVENTO',
      'TIPO_REGISTRO',
      'DATA_EVENTO',
      'TIPO_EVENTO',
      'ID_CONTRATANTE',
      'NOME_CONTRATANTE',
      'ID_VENDEDOR',
      'NOME_VENDEDOR',
      'VALOR_RECEBIDO',
      'VALOR_COMISSAO_PAGO'
    ];
    const colunasMov = [
      'ID_MOVIMENTACAO',
      'TIPO_MOVIMENTACAO',
      'NATUREZA',
      'ID_EVENTO',
      'NOME_EVENTO',
      'DATA_MOVIMENTACAO',
      'VALOR',
      'FORMA_PAGAMENTO',
      'CONTRAPARTE',
      'ID_CONTRAPARTE',
      'LINK_COMPROVANTE',
      'OBSERVACOES',
      'PROCESSADO_POR',
      'TIMESTAMP',
      'INCLUIDO_EM_FECHAMENTO',
      'STATUS'
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

    const jaMigradoRecebimento = {};
    const jaMigradoComissao = {};
    for (let r = 1; r < movData.length; r++) {
      const row = movData[r];
      const idEvento = String(row[m('ID_EVENTO')] || '').trim();
      if (!idEvento) continue;

      const tipoMov = String(row[m('TIPO_MOVIMENTACAO')] || '').trim();
      const obs = String(row[m('OBSERVACOES')] || '');
      if (obs.indexOf(marcador) === -1) continue;

      if (tipoMov === 'RECEBIMENTO_CLIENTE') {
        jaMigradoRecebimento[idEvento] = true;
      } else if (tipoMov === 'COMISSAO_GERADA') {
        jaMigradoComissao[idEvento] = true;
      }
    }

    const cacheVendedores = montarCacheVendedoresSaldoInicial_();
    const relatorio = {
      sucesso: true,
      marcador: marcador,
      tagFechamentoLegado: tagFechamentoLegado,
      totalEventosAnalisados: 0,
      eventosIgnoradosNaoEvento: 0,
      eventosElegiveis: 0,
      recebimentosCriados: 0,
      comissoesCriadas: 0,
      recebimentosJaExistentes: 0,
      comissoesJaExistentes: 0,
      eventosAtualizados: 0,
      eventosComErro: 0,
      vendedoresResolvidosPorNome: 0,
      erros: []
    };

    const eventosAfetados = {};

    for (let iEvt = 1; iEvt < evtData.length; iEvt++) {
      relatorio.totalEventosAnalisados++;
      const row = evtData[iEvt];

      const idEvento = String(row[e('ID_EVENTO')] || '').trim();
      if (!idEvento) continue;

      const tipoRegistro = String(row[e('TIPO_REGISTRO')] || '').trim();
      if (!permitirNaoEvento && tipoRegistro && tipoRegistro !== 'Evento') {
        relatorio.eventosIgnoradosNaoEvento++;
        continue;
      }

      const valorRecebidoLegado = Number(row[e('VALOR_RECEBIDO')]) || 0;
      const valorComissaoPagaLegado = Number(row[e('VALOR_COMISSAO_PAGO')]) || 0;
      if (valorRecebidoLegado <= 0 && valorComissaoPagaLegado <= 0) {
        continue;
      }

      relatorio.eventosElegiveis++;

      const tipoEvento = String(row[e('TIPO_EVENTO')] || '').trim();
      const nomeContratante = String(row[e('NOME_CONTRATANTE')] || '').trim();
      const nomeEvento = (tipoEvento + ' ' + nomeContratante).trim() || idEvento;
      const dataMov = row[e('DATA_EVENTO')] || new Date();
      const dataNormalizada = normalizarData(dataMov);
      const idContratante = row[e('ID_CONTRATANTE')];
      let idVendedor = row[e('ID_VENDEDOR')];
      const nomeVendedor = String(row[e('NOME_VENDEDOR')] || '').trim();

      try {
        let criouMovimento = false;

        if (valorRecebidoLegado > 0) {
          if (jaMigradoRecebimento[idEvento]) {
            relatorio.recebimentosJaExistentes++;
          } else {
            const linhaRecebimento = [
              gerarIDMovimentacao(),
              'RECEBIMENTO_CLIENTE',
              'ENTRADA',
              idEvento,
              nomeEvento,
              dataNormalizada,
              Number(valorRecebidoLegado.toFixed(2)),
              'LEGADO',
              nomeContratante,
              idContratante,
              '',
              marcador + ' tipo=RECEBIMENTO valor=' + String(Number(valorRecebidoLegado.toFixed(2))),
              usuario,
              new Date(),
              '',
              'PROCESSADO'
            ];
            appendRowComVerificacao_(shMov, linhaRecebimento, 'MOVIMENTACOES_FINANCEIRAS/MIGRACAO_RECEBIMENTO');
            jaMigradoRecebimento[idEvento] = true;
            relatorio.recebimentosCriados++;
            criouMovimento = true;
          }
        }

        if (valorComissaoPagaLegado > 0) {
          if (jaMigradoComissao[idEvento]) {
            relatorio.comissoesJaExistentes++;
          } else {
            if (!String(idVendedor || '').trim()) {
              const resolucao = resolverIdVendedorSaldoInicial_(idVendedor, nomeVendedor, cacheVendedores);
              if (!resolucao.ok) {
                throw new Error('ID_VENDEDOR ausente para criar comissão de saldo inicial: ' + resolucao.motivo);
              }
              idVendedor = resolucao.idVendedor;
              if (String(row[e('ID_VENDEDOR')] || '').trim() !== String(idVendedor).trim()) {
                setValueComVerificacao_(shEvt, iEvt + 1, e('ID_VENDEDOR') + 1, idVendedor, 'EVENTOS/ID_VENDEDOR_MIGRACAO');
                row[e('ID_VENDEDOR')] = idVendedor;
                relatorio.vendedoresResolvidosPorNome++;
              }
            }

            const linhaComissao = [
              gerarIDMovimentacao(),
              'COMISSAO_GERADA',
              'SAÍDA',
              idEvento,
              nomeEvento,
              dataNormalizada,
              Number(valorComissaoPagaLegado.toFixed(2)),
              '',
              nomeVendedor,
              idVendedor,
              '',
              marcador + ' tipo=COMISSAO valor=' + String(Number(valorComissaoPagaLegado.toFixed(2))),
              usuario,
              new Date(),
              tagFechamentoLegado,
              'PROCESSADO'
            ];
            appendRowComVerificacao_(shMov, linhaComissao, 'MOVIMENTACOES_FINANCEIRAS/MIGRACAO_COMISSAO');
            jaMigradoComissao[idEvento] = true;
            relatorio.comissoesCriadas++;
            criouMovimento = true;
          }
        }

        if (criouMovimento) {
          eventosAfetados[idEvento] = true;
        }
      } catch (err) {
        relatorio.eventosComErro++;
        relatorio.erros.push({
          idEvento: idEvento,
          erro: String(err && err.message ? err.message : err)
        });
      }
    }

    const idsAfetados = Object.keys(eventosAfetados);
    if (idsAfetados.length > 0) {
      recalcularEspelhosFinanceirosMigracao_(idsAfetados, shEvt, shMov);
      relatorio.eventosAtualizados = idsAfetados.length;
    }

    relatorio.mensagem = 'Migração de saldo inicial concluída';
    return relatorio;
  });
}

/**
 * Execução manual via editor do Apps Script (sem doPost).
 * Use somente para operação administrativa pontual.
 */
function executarMigracaoSaldoInicialManual(emailProprietario, incluirNaoEvento) {
  const email = String(emailProprietario || '').trim().toLowerCase();
  if (!email) {
    throw new Error('Informe o email do proprietário para executar manualmente.');
  }

  const anterior = globalThis.REQUEST_EMAIL;
  try {
    globalThis.REQUEST_EMAIL = email;
    return migrarSaldoInicialFinanceiro({
      incluirNaoEvento: incluirNaoEvento ? 'TRUE' : 'FALSE'
    });
  } finally {
    if (typeof anterior === 'undefined') {
      delete globalThis.REQUEST_EMAIL;
    } else {
      globalThis.REQUEST_EMAIL = anterior;
    }
  }
}

function auditarSaldoInicialFinanceiro(params) {
  exigirAcao('financeiro:migrarSaldoInicial');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shEvt = ss.getSheetByName('EVENTOS');
  const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  if (!shEvt || !shMov) {
    throw new Error('Planilhas EVENTOS e MOVIMENTACOES_FINANCEIRAS são obrigatórias para auditoria.');
  }

  const marcador = '[MIGRACAO_SALDO_INICIAL_V1]';
  const permitirNaoEvento = String((params && params.incluirNaoEvento) || '').toUpperCase() === 'TRUE';
  const limite = Math.max(50, Math.min(Number((params && params.limit) || 500), 5000));

  const evtData = shEvt.getDataRange().getValues();
  const movData = shMov.getDataRange().getValues();
  if (evtData.length < 2) {
    return {
      sucesso: true,
      resumo: { eventosAnalisados: 0, pendencias: 0, divergencias: 0 },
      pendencias: [],
      divergencias: []
    };
  }

  const evtHead = evtData[0];
  const movHead = movData[0];
  const e = function (c) { return evtHead.indexOf(c); };
  const m = function (c) { return movHead.indexOf(c); };

  const colunasEventos = [
    'ID_EVENTO',
    'TIPO_REGISTRO',
    'VALOR_TOTAL',
    'VALOR_RECEBIDO',
    'VALOR_PENDENTE',
    'ID_VENDEDOR',
    'VALOR_COMISSAO_CALCULADO',
    'VALOR_COMISSAO_PAGO',
    'STATUS_COMISSAO'
  ];
  const colunasMov = [
    'TIPO_MOVIMENTACAO',
    'STATUS',
    'ID_EVENTO',
    'ID_CONTRAPARTE',
    'NATUREZA',
    'VALOR',
    'OBSERVACOES'
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

  const mapaMov = {};
  const mapaMigracao = {};
  for (let r = 1; r < movData.length; r++) {
    const row = movData[r];
    const status = String(row[m('STATUS')] || '');
    if (status === 'CANCELADO') continue;

    const idEvento = String(row[m('ID_EVENTO')] || '').trim();
    if (!idEvento) continue;

    if (!mapaMov[idEvento]) {
      mapaMov[idEvento] = {
        recebidoLiquido: 0,
        comissaoGeradaPorVendedor: {},
        comissaoPagaPorVendedor: {}
      };
    }
    if (!mapaMigracao[idEvento]) {
      mapaMigracao[idEvento] = { temRecebimentoSaldoInicial: false, temComissaoSaldoInicial: false };
    }

    const tipoMov = String(row[m('TIPO_MOVIMENTACAO')] || '');
    const natureza = String(row[m('NATUREZA')] || '');
    const valor = Number(row[m('VALOR')]) || 0;
    const idVendedor = String(row[m('ID_CONTRAPARTE')] || '').trim();
    const obs = String(row[m('OBSERVACOES')] || '');

    if (tipoMov === 'RECEBIMENTO_CLIENTE' && status === 'PROCESSADO') {
      mapaMov[idEvento].recebidoLiquido += valor;
    } else if (tipoMov === 'ESTORNO_RECEBIMENTO' && status === 'PROCESSADO') {
      mapaMov[idEvento].recebidoLiquido -= valor;
    } else if (tipoMov === 'COMISSAO_GERADA') {
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

    if (obs.indexOf(marcador) !== -1) {
      if (tipoMov === 'RECEBIMENTO_CLIENTE') mapaMigracao[idEvento].temRecebimentoSaldoInicial = true;
      if (tipoMov === 'COMISSAO_GERADA') mapaMigracao[idEvento].temComissaoSaldoInicial = true;
    }
  }

  const pendencias = [];
  const divergencias = [];
  let eventosAnalisados = 0;
  let ignoradosNaoEvento = 0;

  for (let rEvt = 1; rEvt < evtData.length; rEvt++) {
    const row = evtData[rEvt];
    const idEvento = String(row[e('ID_EVENTO')] || '').trim();
    if (!idEvento) continue;

    const tipoRegistro = String(row[e('TIPO_REGISTRO')] || '').trim();
    if (!permitirNaoEvento && tipoRegistro && tipoRegistro !== 'Evento') {
      ignoradosNaoEvento++;
      continue;
    }
    eventosAnalisados++;

    const valorRecebidoEvt = Number(row[e('VALOR_RECEBIDO')]) || 0;
    const valorComissaoPagaEvt = Number(row[e('VALOR_COMISSAO_PAGO')]) || 0;
    const mig = mapaMigracao[idEvento] || { temRecebimentoSaldoInicial: false, temComissaoSaldoInicial: false };
    const mov = mapaMov[idEvento] || {
      recebidoLiquido: 0,
      comissaoGeradaPorVendedor: {},
      comissaoPagaPorVendedor: {}
    };

    if (valorRecebidoEvt > 0 && !mig.temRecebimentoSaldoInicial) {
      pendencias.push({
        idEvento: idEvento,
        tipo: 'FALTA_SALDO_INICIAL_RECEBIMENTO',
        valorEvento: Number(valorRecebidoEvt.toFixed(2))
      });
    }

    if (valorComissaoPagaEvt > 0 && !mig.temComissaoSaldoInicial) {
      pendencias.push({
        idEvento: idEvento,
        tipo: 'FALTA_SALDO_INICIAL_COMISSAO',
        valorEvento: Number(valorComissaoPagaEvt.toFixed(2))
      });
    }

    const recebidoCalc = Number((mov.recebidoLiquido || 0).toFixed(2));
    const valorTotal = Number(row[e('VALOR_TOTAL')]) || 0;
    const pendenteCalc = Number(Math.max(valorTotal - recebidoCalc, 0).toFixed(2));

    const idVendedor = String(row[e('ID_VENDEDOR')] || '').trim();
    const esperadoComissao = Number(row[e('VALOR_COMISSAO_CALCULADO')]) || 0;
    const pagoCalc = Number((((mov.comissaoPagaPorVendedor || {})[idVendedor]) || 0).toFixed(2));
    const geradoCalc = Number((((mov.comissaoGeradaPorVendedor || {})[idVendedor]) || 0).toFixed(2));
    const pendenteComissaoCalc = Number(Math.max(geradoCalc - pagoCalc, 0).toFixed(2));
    const statusComissaoCalc = determinarStatusComissao_(
      Number(esperadoComissao.toFixed(2)),
      geradoCalc,
      pagoCalc,
      pendenteComissaoCalc
    );

    const valorPendenteEvt = Number(row[e('VALOR_PENDENTE')]) || 0;
    const statusComissaoEvt = String(row[e('STATUS_COMISSAO')] || '');
    const tolerancia = 0.01;

    if (Math.abs(valorRecebidoEvt - recebidoCalc) > tolerancia) {
      divergencias.push({
        idEvento: idEvento,
        tipo: 'VALOR_RECEBIDO_DIVERGENTE',
        atual: Number(valorRecebidoEvt.toFixed(2)),
        esperado: recebidoCalc
      });
    }
    if (Math.abs(valorPendenteEvt - pendenteCalc) > tolerancia) {
      divergencias.push({
        idEvento: idEvento,
        tipo: 'VALOR_PENDENTE_DIVERGENTE',
        atual: Number(valorPendenteEvt.toFixed(2)),
        esperado: pendenteCalc
      });
    }
    if (Math.abs(valorComissaoPagaEvt - pagoCalc) > tolerancia) {
      divergencias.push({
        idEvento: idEvento,
        tipo: 'VALOR_COMISSAO_PAGO_DIVERGENTE',
        atual: Number(valorComissaoPagaEvt.toFixed(2)),
        esperado: pagoCalc
      });
    }
    if (statusComissaoEvt !== statusComissaoCalc) {
      divergencias.push({
        idEvento: idEvento,
        tipo: 'STATUS_COMISSAO_DIVERGENTE',
        atual: statusComissaoEvt || 'N/A',
        esperado: statusComissaoCalc
      });
    }

    if (pendencias.length + divergencias.length >= limite) {
      break;
    }
  }

  return {
    sucesso: true,
    marcador: marcador,
    resumo: {
      eventosAnalisados: eventosAnalisados,
      ignoradosNaoEvento: ignoradosNaoEvento,
      pendencias: pendencias.length,
      divergencias: divergencias.length,
      truncadoNoLimite: (pendencias.length + divergencias.length) >= limite
    },
    pendencias: pendencias,
    divergencias: divergencias
  };
}

function executarAuditoriaSaldoInicialManual(emailProprietario, incluirNaoEvento, limit) {
  const email = String(emailProprietario || '').trim().toLowerCase();
  if (!email) {
    throw new Error('Informe o email do proprietário para executar auditoria manual.');
  }

  const anterior = globalThis.REQUEST_EMAIL;
  try {
    globalThis.REQUEST_EMAIL = email;
    return auditarSaldoInicialFinanceiro({
      incluirNaoEvento: incluirNaoEvento ? 'TRUE' : 'FALSE',
      limit: Number(limit) || 1000
    });
  } finally {
    if (typeof anterior === 'undefined') {
      delete globalThis.REQUEST_EMAIL;
    } else {
      globalThis.REQUEST_EMAIL = anterior;
    }
  }
}

function repararPendenciasSaldoInicialComissao(params) {
  exigirAcao('financeiro:migrarSaldoInicial');

  return executarComLockFinanceiro_('REPARO_SALDO_INICIAL_COMISSAO', function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const shEvt = ss.getSheetByName('EVENTOS');
    const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    if (!shEvt || !shMov) {
      throw new Error('Planilhas EVENTOS e MOVIMENTACOES_FINANCEIRAS são obrigatórias para reparo.');
    }

    const auditoria = auditarSaldoInicialFinanceiro({
      incluirNaoEvento: String((params && params.incluirNaoEvento) || 'FALSE'),
      limit: 5000
    });
    const chunk = Math.max(1, Math.min(Number((params && params.chunkSize) || 20), 200));
    const pendenciasComissao = (auditoria.pendencias || []).filter(function (p) {
      return String(p.tipo || '') === 'FALTA_SALDO_INICIAL_COMISSAO';
    });

    const alvo = pendenciasComissao.slice(0, chunk);
    if (!alvo.length) {
      return {
        sucesso: true,
        mensagem: 'Nenhuma pendência de comissão para reparar.',
        totalPendenciasComissao: pendenciasComissao.length,
        processados: 0,
        erros: []
      };
    }

    const usuario = getUsuarioAtual().email;
    const marcador = '[MIGRACAO_SALDO_INICIAL_V1]';
    const tagFechamentoLegado = 'LEGADO_SALDO_INICIAL';

    const evtData = shEvt.getDataRange().getValues();
    const movData = shMov.getDataRange().getValues();
    const evtHead = evtData[0];
    const movHead = movData[0];
    const e = function (c) { return evtHead.indexOf(c); };
    const m = function (c) { return movHead.indexOf(c); };

    const cacheVendedores = montarCacheVendedoresSaldoInicial_();
    const idxEvt = {};
    for (let i = 1; i < evtData.length; i++) {
      const id = String(evtData[i][e('ID_EVENTO')] || '').trim();
      idxEvt[id] = {
        row: evtData[i],
        rowNumber: i + 1
      };
    }

    const jaTemComissaoSaldoInicial = {};
    for (let i = 1; i < movData.length; i++) {
      const row = movData[i];
      const idEvento = String(row[m('ID_EVENTO')] || '').trim();
      if (!idEvento) continue;
      if (String(row[m('TIPO_MOVIMENTACAO')] || '') !== 'COMISSAO_GERADA') continue;
      const obs = String(row[m('OBSERVACOES')] || '');
      if (obs.indexOf(marcador) === -1) continue;
      jaTemComissaoSaldoInicial[idEvento] = true;
    }

    const erros = [];
    const idsAfetados = {};
    let processados = 0;
    let ignoradosJaExistentes = 0;
    let vendedoresResolvidosPorNome = 0;

    for (let i = 0; i < alvo.length; i++) {
      const idEvento = String(alvo[i].idEvento || '').trim();
      if (!idEvento) continue;

      try {
        if (jaTemComissaoSaldoInicial[idEvento]) {
          ignoradosJaExistentes++;
          continue;
        }

        const eventoInfo = idxEvt[idEvento];
        if (!eventoInfo || !eventoInfo.row) throw new Error('Evento não encontrado na aba EVENTOS');
        const evento = eventoInfo.row;

        let idVendedor = evento[e('ID_VENDEDOR')];
        const nomeVendedor = String(evento[e('NOME_VENDEDOR')] || '').trim();
        const valorComissao = Number(evento[e('VALOR_COMISSAO_PAGO')]) || 0;
        if (!String(idVendedor || '').trim()) {
          const resolucao = resolverIdVendedorSaldoInicial_(idVendedor, nomeVendedor, cacheVendedores);
          if (!resolucao.ok) throw new Error('ID_VENDEDOR ausente: ' + resolucao.motivo);
          idVendedor = resolucao.idVendedor;
          setValueComVerificacao_(shEvt, eventoInfo.rowNumber, e('ID_VENDEDOR') + 1, idVendedor, 'EVENTOS/ID_VENDEDOR_REPARO');
          evento[e('ID_VENDEDOR')] = idVendedor;
          vendedoresResolvidosPorNome++;
        }
        if (valorComissao <= 0) throw new Error('VALOR_COMISSAO_PAGO <= 0');

        const tipoEvento = String(evento[e('TIPO_EVENTO')] || '').trim();
        const nomeContratante = String(evento[e('NOME_CONTRATANTE')] || '').trim();
        const nomeEvento = (tipoEvento + ' ' + nomeContratante).trim() || idEvento;
        const dataNormalizada = normalizarData(evento[e('DATA_EVENTO')] || new Date());

        const linhaComissao = [
          gerarIDMovimentacao(),
          'COMISSAO_GERADA',
          'SAÍDA',
          idEvento,
          nomeEvento,
          dataNormalizada,
          Number(valorComissao.toFixed(2)),
          '',
          nomeVendedor,
          idVendedor,
          '',
          marcador + ' tipo=COMISSAO valor=' + String(Number(valorComissao.toFixed(2))) + ' [REPARO]',
          usuario,
          new Date(),
          tagFechamentoLegado,
          'PROCESSADO'
        ];
        appendRowComVerificacao_(shMov, linhaComissao, 'MOVIMENTACOES_FINANCEIRAS/REPARO_COMISSAO');
        jaTemComissaoSaldoInicial[idEvento] = true;
        processados++;
        idsAfetados[idEvento] = true;
      } catch (err) {
        erros.push({
          idEvento: idEvento,
          erro: String(err && err.message ? err.message : err)
        });
      }
    }

    const ids = Object.keys(idsAfetados);
    if (ids.length > 0) {
      recalcularEspelhosFinanceirosMigracao_(ids, shEvt, shMov);
    }

    const auditoriaPos = auditarSaldoInicialFinanceiro({
      incluirNaoEvento: String((params && params.incluirNaoEvento) || 'FALSE'),
      limit: 5000
    });
    const restantes = (auditoriaPos.pendencias || []).filter(function (p) {
      return String(p.tipo || '') === 'FALTA_SALDO_INICIAL_COMISSAO';
    }).length;

    return {
      sucesso: true,
      chunkSolicitado: chunk,
      totalPendenciasComissaoAntes: pendenciasComissao.length,
      processados: processados,
      ignoradosJaExistentes: ignoradosJaExistentes,
      vendedoresResolvidosPorNome: vendedoresResolvidosPorNome,
      erros: erros,
      pendenciasComissaoRestantes: restantes
    };
  });
}

function executarReparoPendenciasComissaoManual(emailProprietario, chunkSize) {
  const email = String(emailProprietario || '').trim().toLowerCase();
  if (!email) {
    throw new Error('Informe o email do proprietário para executar reparo manual.');
  }

  const anterior = globalThis.REQUEST_EMAIL;
  try {
    globalThis.REQUEST_EMAIL = email;
    return repararPendenciasSaldoInicialComissao({
      incluirNaoEvento: 'FALSE',
      chunkSize: Number(chunkSize) || 20
    });
  } finally {
    if (typeof anterior === 'undefined') {
      delete globalThis.REQUEST_EMAIL;
    } else {
      globalThis.REQUEST_EMAIL = anterior;
    }
  }
}

function reconciliarMovimentacoesSaldoInicialPosAuditoria(params) {
  exigirAcao('financeiro:migrarSaldoInicial');

  return executarComLockFinanceiro_('RECONCILIAR_SALDO_INICIAL_POS_AUDITORIA', function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const shEvt = ss.getSheetByName('EVENTOS');
    const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    if (!shEvt || !shMov) {
      throw new Error('Planilhas EVENTOS e MOVIMENTACOES_FINANCEIRAS são obrigatórias para reconciliação.');
    }

    const marcador = '[MIGRACAO_SALDO_INICIAL_V1]';
    const tagFechamentoLegado = 'LEGADO_SALDO_INICIAL';
    const permitirNaoEvento = String((params && params.incluirNaoEvento) || '').toUpperCase() === 'TRUE';
    const somenteDivergentes = String((params && params.somenteDivergentes) || '').toUpperCase() === 'TRUE';
    const chunkSize = Math.max(1, Math.min(Number((params && params.chunkSize) || 999999), 500));
    const pularAuditoriaFinal = String((params && params.pularAuditoriaFinal) || '').toUpperCase() === 'TRUE';
    const usuario = getUsuarioAtual().email;
    const cacheVendedores = montarCacheVendedoresSaldoInicial_();

    const evtData = shEvt.getDataRange().getValues();
    const movData = shMov.getDataRange().getValues();
    if (evtData.length < 2) {
      return { sucesso: true, mensagem: 'Nenhum evento para reconciliar.' };
    }

    const evtHead = evtData[0];
    const movHead = movData[0];
    const e = function (c) { return evtHead.indexOf(c); };
    const m = function (c) { return movHead.indexOf(c); };

    const colunasEventos = [
      'ID_EVENTO', 'TIPO_REGISTRO', 'DATA_EVENTO', 'TIPO_EVENTO',
      'ID_CONTRATANTE', 'NOME_CONTRATANTE', 'ID_VENDEDOR', 'NOME_VENDEDOR',
      'VALOR_RECEBIDO', 'VALOR_COMISSAO_PAGO'
    ];
    const colunasMov = [
      'ID_MOVIMENTACAO', 'TIPO_MOVIMENTACAO', 'NATUREZA', 'ID_EVENTO', 'NOME_EVENTO',
      'DATA_MOVIMENTACAO', 'VALOR', 'FORMA_PAGAMENTO', 'CONTRAPARTE', 'ID_CONTRAPARTE',
      'LINK_COMPROVANTE', 'OBSERVACOES', 'PROCESSADO_POR', 'TIMESTAMP', 'INCLUIDO_EM_FECHAMENTO', 'STATUS'
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

    const seedsReceb = {};
    const seedsComis = {};
    for (let r = 1; r < movData.length; r++) {
      const row = movData[r];
      const idEvento = String(row[m('ID_EVENTO')] || '').trim();
      if (!idEvento) continue;
      const obs = String(row[m('OBSERVACOES')] || '');
      if (obs.indexOf(marcador) === -1) continue;

      const tipo = String(row[m('TIPO_MOVIMENTACAO')] || '');
      const reg = { rowIndex: r + 1, row: row };
      if (tipo === 'RECEBIMENTO_CLIENTE') {
        if (!seedsReceb[idEvento]) seedsReceb[idEvento] = [];
        seedsReceb[idEvento].push(reg);
      } else if (tipo === 'COMISSAO_GERADA') {
        if (!seedsComis[idEvento]) seedsComis[idEvento] = [];
        seedsComis[idEvento].push(reg);
      }
    }

    let idsDivergentesSet = null;
    if (somenteDivergentes) {
      const aud = auditarSaldoInicialFinanceiro({
        incluirNaoEvento: permitirNaoEvento ? 'TRUE' : 'FALSE',
        limit: 5000
      });
      idsDivergentesSet = {};
      const divs = aud.divergencias || [];
      for (let d = 0; d < divs.length; d++) {
        const idDiv = String(divs[d].idEvento || '').trim();
        if (idDiv) idsDivergentesSet[idDiv] = true;
      }
    }

    const rel = {
      sucesso: true,
      eventosAnalisados: 0,
      ignoradosNaoEvento: 0,
      recebimentosCriados: 0,
      recebimentosAtualizados: 0,
      recebimentosCancelados: 0,
      comissoesCriadas: 0,
      comissoesAtualizadas: 0,
      comissoesCanceladas: 0,
      vendedoresResolvidosPorNome: 0,
      ambiguidades: [],
      erros: []
    };

    const idsAfetados = {};
    let eventosSelecionados = 0;
    const atualizarSeedReceb = function (seed, evento, desired) {
      const rowNum = seed.rowIndex;
      const tipoEvento = String(evento[e('TIPO_EVENTO')] || '').trim();
      const nomeContratante = String(evento[e('NOME_CONTRATANTE')] || '').trim();
      const nomeEvento = (tipoEvento + ' ' + nomeContratante).trim();
      const dataNorm = normalizarData(evento[e('DATA_EVENTO')] || new Date());
      const idContratante = evento[e('ID_CONTRATANTE')];
      const status = desired > 0 ? 'PROCESSADO' : 'CANCELADO';

      setValueComVerificacao_(shMov, rowNum, m('NOME_EVENTO') + 1, nomeEvento, 'MOV/NOME_EVENTO_RECONCILIAR_RECEB');
      setValueComVerificacao_(shMov, rowNum, m('DATA_MOVIMENTACAO') + 1, dataNorm, 'MOV/DATA_RECONCILIAR_RECEB');
      if (desired > 0) {
        setValueComVerificacao_(shMov, rowNum, m('VALOR') + 1, Number(desired.toFixed(2)), 'MOV/VALOR_RECONCILIAR_RECEB');
      }
      setValueComVerificacao_(shMov, rowNum, m('CONTRAPARTE') + 1, nomeContratante, 'MOV/CONTRAPARTE_RECONCILIAR_RECEB');
      setValueComVerificacao_(shMov, rowNum, m('ID_CONTRAPARTE') + 1, idContratante, 'MOV/ID_CONTRAPARTE_RECONCILIAR_RECEB');
      setValueComVerificacao_(shMov, rowNum, m('STATUS') + 1, status, 'MOV/STATUS_RECONCILIAR_RECEB');
      atualizarAuditoriaMovimentacaoBestEffort_(shMov, rowNum, m, usuario);
    };

    const atualizarSeedComissao = function (seed, evento, desired, idVendedor, nomeVendedor) {
      const rowNum = seed.rowIndex;
      const tipoEvento = String(evento[e('TIPO_EVENTO')] || '').trim();
      const nomeContratante = String(evento[e('NOME_CONTRATANTE')] || '').trim();
      const nomeEvento = (tipoEvento + ' ' + nomeContratante).trim();
      const dataNorm = normalizarData(evento[e('DATA_EVENTO')] || new Date());
      const status = desired > 0 ? 'PROCESSADO' : 'CANCELADO';

      setValueComVerificacao_(shMov, rowNum, m('NOME_EVENTO') + 1, nomeEvento, 'MOV/NOME_EVENTO_RECONCILIAR_COMIS');
      setValueComVerificacao_(shMov, rowNum, m('DATA_MOVIMENTACAO') + 1, dataNorm, 'MOV/DATA_RECONCILIAR_COMIS');
      if (desired > 0) {
        setValueComVerificacao_(shMov, rowNum, m('VALOR') + 1, Number(desired.toFixed(2)), 'MOV/VALOR_RECONCILIAR_COMIS');
      }
      setValueComVerificacao_(shMov, rowNum, m('CONTRAPARTE') + 1, nomeVendedor, 'MOV/CONTRAPARTE_RECONCILIAR_COMIS');
      setValueComVerificacao_(shMov, rowNum, m('ID_CONTRAPARTE') + 1, idVendedor, 'MOV/ID_CONTRAPARTE_RECONCILIAR_COMIS');
      setValueComVerificacao_(shMov, rowNum, m('INCLUIDO_EM_FECHAMENTO') + 1, desired > 0 ? tagFechamentoLegado : '', 'MOV/INCLUIDO_FECH_RECONCILIAR_COMIS');
      setValueComVerificacao_(shMov, rowNum, m('STATUS') + 1, status, 'MOV/STATUS_RECONCILIAR_COMIS');
      atualizarAuditoriaMovimentacaoBestEffort_(shMov, rowNum, m, usuario);
    };

    for (let rEvt = 1; rEvt < evtData.length; rEvt++) {
      const evento = evtData[rEvt];
      const idEvento = String(evento[e('ID_EVENTO')] || '').trim();
      if (!idEvento) continue;
      if (idsDivergentesSet && !idsDivergentesSet[idEvento]) continue;

      const tipoRegistro = String(evento[e('TIPO_REGISTRO')] || '').trim();
      if (!permitirNaoEvento && tipoRegistro && tipoRegistro !== 'Evento') {
        rel.ignoradosNaoEvento++;
        continue;
      }
      rel.eventosAnalisados++;
      eventosSelecionados++;
      if (eventosSelecionados > chunkSize) break;

      const desiredReceb = Number(evento[e('VALOR_RECEBIDO')]) || 0;
      const desiredComis = Number(evento[e('VALOR_COMISSAO_PAGO')]) || 0;
      let idVendedor = evento[e('ID_VENDEDOR')];
      const nomeVendedorEvt = String(evento[e('NOME_VENDEDOR')] || '').trim();

      try {
        const recs = seedsReceb[idEvento] || [];
        if (recs.length > 1) {
          rel.ambiguidades.push({ idEvento: idEvento, tipo: 'MULTIPLOS_SEEDS_RECEBIMENTO', quantidade: recs.length });
        } else if (recs.length === 1) {
          atualizarSeedReceb(recs[0], evento, desiredReceb);
          if (desiredReceb > 0) rel.recebimentosAtualizados++;
          else rel.recebimentosCancelados++;
          idsAfetados[idEvento] = true;
        } else if (desiredReceb > 0) {
          const tipoEvento = String(evento[e('TIPO_EVENTO')] || '').trim();
          const nomeContratante = String(evento[e('NOME_CONTRATANTE')] || '').trim();
          const nomeEvento = (tipoEvento + ' ' + nomeContratante).trim() || idEvento;
          const dataNorm = normalizarData(evento[e('DATA_EVENTO')] || new Date());
          const idContratante = evento[e('ID_CONTRATANTE')];
          const linhaReceb = [
            gerarIDMovimentacao(),
            'RECEBIMENTO_CLIENTE',
            'ENTRADA',
            idEvento,
            nomeEvento,
            dataNorm,
            Number(desiredReceb.toFixed(2)),
            'LEGADO',
            nomeContratante,
            idContratante,
            '',
            marcador + ' tipo=RECEBIMENTO valor=' + String(Number(desiredReceb.toFixed(2))) + ' [RECONCILIADO]',
            usuario,
            new Date(),
            '',
            'PROCESSADO'
          ];
          appendRowComVerificacao_(shMov, linhaReceb, 'MOV/CRIAR_SEED_RECEB_RECONCILIACAO');
          rel.recebimentosCriados++;
          idsAfetados[idEvento] = true;
        }

        const coms = seedsComis[idEvento] || [];
        if (!String(idVendedor || '').trim() && desiredComis > 0) {
          const resolucao = resolverIdVendedorSaldoInicial_(idVendedor, nomeVendedorEvt, cacheVendedores);
          if (resolucao.ok) {
            idVendedor = resolucao.idVendedor;
            setValueComVerificacao_(shEvt, rEvt + 1, e('ID_VENDEDOR') + 1, idVendedor, 'EVENTOS/ID_VENDEDOR_RECONCILIACAO');
            evento[e('ID_VENDEDOR')] = idVendedor;
            rel.vendedoresResolvidosPorNome++;
          }
        }
        const nomeVendedorFinal = String(evento[e('NOME_VENDEDOR')] || '').trim();

        if (coms.length > 1) {
          rel.ambiguidades.push({ idEvento: idEvento, tipo: 'MULTIPLOS_SEEDS_COMISSAO', quantidade: coms.length });
        } else if (coms.length === 1) {
          if (desiredComis > 0 && !String(idVendedor || '').trim()) {
            throw new Error('ID_VENDEDOR ausente para reconciliar comissão');
          }
          atualizarSeedComissao(coms[0], evento, desiredComis, idVendedor, nomeVendedorFinal);
          if (desiredComis > 0) rel.comissoesAtualizadas++;
          else rel.comissoesCanceladas++;
          idsAfetados[idEvento] = true;
        } else if (desiredComis > 0) {
          if (!String(idVendedor || '').trim()) {
            throw new Error('ID_VENDEDOR ausente para criar comissão');
          }
          const tipoEvento = String(evento[e('TIPO_EVENTO')] || '').trim();
          const nomeContratante = String(evento[e('NOME_CONTRATANTE')] || '').trim();
          const nomeEvento = (tipoEvento + ' ' + nomeContratante).trim() || idEvento;
          const dataNorm = normalizarData(evento[e('DATA_EVENTO')] || new Date());
          const linhaComis = [
            gerarIDMovimentacao(),
            'COMISSAO_GERADA',
            'SAÍDA',
            idEvento,
            nomeEvento,
            dataNorm,
            Number(desiredComis.toFixed(2)),
            '',
            nomeVendedorFinal,
            idVendedor,
            '',
            marcador + ' tipo=COMISSAO valor=' + String(Number(desiredComis.toFixed(2))) + ' [RECONCILIADO]',
            usuario,
            new Date(),
            tagFechamentoLegado,
            'PROCESSADO'
          ];
          appendRowComVerificacao_(shMov, linhaComis, 'MOV/CRIAR_SEED_COMIS_RECONCILIACAO');
          rel.comissoesCriadas++;
          idsAfetados[idEvento] = true;
        }
      } catch (err) {
        rel.erros.push({
          idEvento: idEvento,
          erro: String(err && err.message ? err.message : err)
        });
      }
    }

    const afetados = Object.keys(idsAfetados);
    if (afetados.length > 0) {
      recalcularEspelhosFinanceirosMigracao_(afetados, shEvt, shMov);
    }

    if (!pularAuditoriaFinal) {
      const auditoriaPos = auditarSaldoInicialFinanceiro({
        incluirNaoEvento: permitirNaoEvento ? 'TRUE' : 'FALSE',
        limit: 5000
      });
      rel.resumoPosAuditoria = auditoriaPos.resumo;
    }
    rel.modo = somenteDivergentes ? 'SOMENTE_DIVERGENTES' : 'COMPLETO';
    rel.chunkSize = chunkSize;
    rel.totalEventosAfetados = afetados.length;
    return rel;
  });
}

function executarReconciliacaoSaldoInicialManual(emailProprietario, incluirNaoEvento) {
  const email = String(emailProprietario || '').trim().toLowerCase();
  if (!email) {
    throw new Error('Informe o email do proprietário para executar reconciliação manual.');
  }
  const anterior = globalThis.REQUEST_EMAIL;
  try {
    globalThis.REQUEST_EMAIL = email;
    return reconciliarMovimentacoesSaldoInicialPosAuditoria({
      incluirNaoEvento: incluirNaoEvento ? 'TRUE' : 'FALSE'
    });
  } finally {
    if (typeof anterior === 'undefined') {
      delete globalThis.REQUEST_EMAIL;
    } else {
      globalThis.REQUEST_EMAIL = anterior;
    }
  }
}

function atualizarAuditoriaMovimentacaoBestEffort_(shMov, rowNum, m, usuario) {
  try {
    const colProc = m('PROCESSADO_POR');
    if (colProc >= 0) {
      shMov.getRange(rowNum, colProc + 1).setValue(usuario);
    }
    const colTs = m('TIMESTAMP');
    if (colTs >= 0) {
      shMov.getRange(rowNum, colTs + 1).setValue(new Date());
    }
    SpreadsheetApp.flush();
  } catch (_) {
    // Não bloqueia reconciliação por falha em coluna auxiliar de auditoria.
  }
}

function executarReconciliacaoDivergenciasManual(emailProprietario, chunkSize) {
  const email = String(emailProprietario || '').trim().toLowerCase();
  if (!email) {
    throw new Error('Informe o email do proprietário para executar reconciliação de divergências.');
  }
  const anterior = globalThis.REQUEST_EMAIL;
  try {
    globalThis.REQUEST_EMAIL = email;
    return reconciliarMovimentacoesSaldoInicialPosAuditoria({
      incluirNaoEvento: 'FALSE',
      somenteDivergentes: 'TRUE',
      chunkSize: Number(chunkSize) || 25,
      pularAuditoriaFinal: 'TRUE'
    });
  } finally {
    if (typeof anterior === 'undefined') {
      delete globalThis.REQUEST_EMAIL;
    } else {
      globalThis.REQUEST_EMAIL = anterior;
    }
  }
}

function auditarSaidasLegado2025(params) {
  exigirAcao('financeiro:migrarSaldoInicial');

  const anoMinimo = Math.max(2000, Number((params && params.anoMinimo) || 2025));
  const limiteLista = Math.max(20, Math.min(Number((params && params.limit) || 300), 2000));
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shEvt = ss.getSheetByName('EVENTOS');
  const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  if (!shEvt || !shMov) {
    throw new Error('Planilhas EVENTOS e MOVIMENTACOES_FINANCEIRAS são obrigatórias para auditoria de saídas.');
  }

  const evtData = shEvt.getDataRange().getValues();
  const movData = shMov.getDataRange().getValues();
  if (evtData.length < 2) {
    return { sucesso: true, resumo: { eventosAnalisados: 0 } };
  }

  const evtHead = evtData[0];
  const movHead = movData[0];
  const e = function (c) { return evtHead.indexOf(c); };
  const m = function (c) { return movHead.indexOf(c); };

  const colEvtReq = [
    'ID_EVENTO', 'TIPO_REGISTRO', 'DATA_EVENTO', 'TIPO_EVENTO', 'NOME_CONTRATANTE',
    'TEM_NF', 'VALOR_NF', 'STATUS_NF',
    'VALOR_BV', 'STATUS_BV',
    'FOLHA_CUSTO_VALOR', 'FOLHA_CUSTO_DESCRICAO'
  ];
  const colMovReq = ['TIPO_MOVIMENTACAO', 'STATUS', 'ID_EVENTO', 'VALOR', 'OBSERVACOES'];
  for (var i = 0; i < colEvtReq.length; i++) {
    if (e(colEvtReq[i]) === -1) throw new Error('Coluna obrigatória não encontrada em EVENTOS: ' + colEvtReq[i]);
  }
  for (var j = 0; j < colMovReq.length; j++) {
    if (m(colMovReq[j]) === -1) throw new Error('Coluna obrigatória não encontrada em MOVIMENTACOES_FINANCEIRAS: ' + colMovReq[j]);
  }

  const mapa = {};
  for (let r = 1; r < movData.length; r++) {
    const row = movData[r];
    const status = String(row[m('STATUS')] || '');
    if (status === 'CANCELADO') continue;
    const idEvento = String(row[m('ID_EVENTO')] || '').trim();
    if (!idEvento) continue;
    const tipo = String(row[m('TIPO_MOVIMENTACAO')]);
    const valor = Number(row[m('VALOR')]) || 0;
    const obs = String(row[m('OBSERVACOES')] || '');
    if (!mapa[idEvento]) {
      mapa[idEvento] = {
        nfCount: 0, nfValor: 0, nfSeed: 0,
        bvCount: 0, bvValor: 0,
        folhaCount: 0, folhaValor: 0, folhaSeed: 0
      };
    }
    if (tipo === 'NF_EVENTO') {
      mapa[idEvento].nfCount++;
      mapa[idEvento].nfValor += valor;
      if (obs.indexOf('[MIGRACAO_SAIDAS_LEGADO_V1]') !== -1) mapa[idEvento].nfSeed++;
    } else if (tipo === 'BV_EVENTO') {
      mapa[idEvento].bvCount++;
      mapa[idEvento].bvValor += valor;
    } else if (tipo === 'FOLHA_EVENTO') {
      mapa[idEvento].folhaCount++;
      mapa[idEvento].folhaValor += valor;
      if (obs.indexOf('[MIGRACAO_SAIDAS_LEGADO_V1]') !== -1) mapa[idEvento].folhaSeed++;
    }
  }

  const pendenciasNF = [];
  const pendenciasFolha = [];
  const bvProcessado = [];
  const resumo = {
    eventosAnalisados: 0,
    eventosAnoMinimo: 0,
    nfEsperada: 0,
    nfComMov: 0,
    nfPendentes: 0,
    folhaEsperada: 0,
    folhaComMov: 0,
    folhaPendentes: 0,
    bvComValor: 0,
    bvComMov: 0
  };

  for (let rEvt = 1; rEvt < evtData.length; rEvt++) {
    const row = evtData[rEvt];
    resumo.eventosAnalisados++;
    const idEvento = String(row[e('ID_EVENTO')] || '').trim();
    if (!idEvento) continue;
    const tipoRegistro = String(row[e('TIPO_REGISTRO')] || '').trim();
    if (tipoRegistro && tipoRegistro !== 'Evento') continue;
    const ano = extrairAnoEventoSaldoSaidas_(idEvento, row[e('DATA_EVENTO')]);
    if (ano < anoMinimo) continue;
    resumo.eventosAnoMinimo++;

    const nomeEvento = (String(row[e('TIPO_EVENTO')] || '') + ' ' + String(row[e('NOME_CONTRATANTE')] || '')).trim();
    const stat = mapa[idEvento] || { nfCount: 0, nfValor: 0, folhaCount: 0, folhaValor: 0, bvCount: 0, bvValor: 0 };

    const temNF = parseBooleanPlanilha_(row[e('TEM_NF')]);
    const valorNF = Number(row[e('VALOR_NF')]) || 0;
    const statusNF = String(row[e('STATUS_NF')] || '').toUpperCase().trim();
    const expectedNF = temNF && valorNF > 0 && (statusNF === 'PROCESSADO' || statusNF === 'EMITIDA' || statusNF === 'PAGA');
    if (expectedNF) {
      resumo.nfEsperada++;
      if (stat.nfCount > 0) resumo.nfComMov++;
      else {
        resumo.nfPendentes++;
        if (pendenciasNF.length < limiteLista) {
          pendenciasNF.push({ idEvento: idEvento, nomeEvento: nomeEvento, valorNF: Number(valorNF.toFixed(2)), statusNF: statusNF || 'N/A' });
        }
      }
    }

    const valorFolha = Number(row[e('FOLHA_CUSTO_VALOR')]) || 0;
    if (valorFolha > 0) {
      resumo.folhaEsperada++;
      if (stat.folhaCount > 0) resumo.folhaComMov++;
      else {
        resumo.folhaPendentes++;
        if (pendenciasFolha.length < limiteLista) {
          pendenciasFolha.push({
            idEvento: idEvento,
            nomeEvento: nomeEvento,
            valorFolha: Number(valorFolha.toFixed(2)),
            descricao: String(row[e('FOLHA_CUSTO_DESCRICAO')] || '')
          });
        }
      }
    }

    const valorBV = Number(row[e('VALOR_BV')]) || 0;
    if (valorBV > 0) {
      resumo.bvComValor++;
      if (stat.bvCount > 0) resumo.bvComMov++;
      if (bvProcessado.length < limiteLista) {
        bvProcessado.push({
          idEvento: idEvento,
          nomeEvento: nomeEvento,
          valorBVEvento: Number(valorBV.toFixed(2)),
          statusBVEvento: String(row[e('STATUS_BV')] || ''),
          qtdMovBV: stat.bvCount
        });
      }
    }
  }

  return {
    sucesso: true,
    anoMinimo: anoMinimo,
    resumo: resumo,
    pendenciasNF: pendenciasNF,
    pendenciasFolha: pendenciasFolha,
    visaoBV: bvProcessado
  };
}

function migrarSaidasLegadoNfFolha2025(params) {
  exigirAcao('financeiro:migrarSaldoInicial');
  return executarComLockFinanceiro_('MIGRAR_SAIDAS_NF_FOLHA_2025', function () {
    const anoMinimo = Math.max(2000, Number((params && params.anoMinimo) || 2025));
    const incluirFolha = String((params && params.incluirFolha) || 'TRUE').toUpperCase() === 'TRUE';
    const incluirNF = String((params && params.incluirNF) || 'TRUE').toUpperCase() === 'TRUE';
    const chunkSize = Math.max(1, Math.min(Number((params && params.chunkSize) || 80), 400));
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const shEvt = ss.getSheetByName('EVENTOS');
    const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    if (!shEvt || !shMov) {
      throw new Error('Planilhas EVENTOS e MOVIMENTACOES_FINANCEIRAS são obrigatórias para migração de saídas.');
    }

    const marcador = '[MIGRACAO_SAIDAS_LEGADO_V1]';
    const usuario = getUsuarioAtual().email;
    const evtData = shEvt.getDataRange().getValues();
    const movData = shMov.getDataRange().getValues();
    if (evtData.length < 2) return { sucesso: true, mensagem: 'Sem eventos para migrar.' };

    const evtHead = evtData[0];
    const movHead = movData[0];
    const e = function (c) { return evtHead.indexOf(c); };
    const m = function (c) { return movHead.indexOf(c); };

    const mapSeedNf = {};
    const mapSeedFolha = {};
    const mapAnyNf = {};
    const mapAnyFolha = {};
    for (let r = 1; r < movData.length; r++) {
      const row = movData[r];
      const status = String(row[m('STATUS')] || '');
      if (status === 'CANCELADO') continue;
      const idEvento = String(row[m('ID_EVENTO')] || '').trim();
      if (!idEvento) continue;
      const tipo = String(row[m('TIPO_MOVIMENTACAO')] || '');
      const obs = String(row[m('OBSERVACOES')] || '');
      if (tipo === 'NF_EVENTO') {
        mapAnyNf[idEvento] = true;
        if (obs.indexOf(marcador) !== -1) mapSeedNf[idEvento] = true;
      } else if (tipo === 'FOLHA_EVENTO') {
        mapAnyFolha[idEvento] = true;
        if (obs.indexOf(marcador) !== -1) mapSeedFolha[idEvento] = true;
      }
    }

    const rel = {
      sucesso: true,
      anoMinimo: anoMinimo,
      chunkSize: chunkSize,
      analisados: 0,
      processados: 0,
      nfCriadas: 0,
      folhaCriadas: 0,
      ignoradosJaComMov: 0,
      erros: []
    };

    for (let rEvt = 1; rEvt < evtData.length; rEvt++) {
      if (rel.processados >= chunkSize) break;
      const row = evtData[rEvt];
      const idEvento = String(row[e('ID_EVENTO')] || '').trim();
      if (!idEvento) continue;
      const tipoRegistro = String(row[e('TIPO_REGISTRO')] || '').trim();
      if (tipoRegistro && tipoRegistro !== 'Evento') continue;
      const ano = extrairAnoEventoSaldoSaidas_(idEvento, row[e('DATA_EVENTO')]);
      if (ano < anoMinimo) continue;
      rel.analisados++;

      const tipoEvento = String(row[e('TIPO_EVENTO')] || '').trim();
      const nomeContratante = String(row[e('NOME_CONTRATANTE')] || '').trim();
      const nomeEvento = (tipoEvento + ' ' + nomeContratante).trim() || idEvento;
      const dataMov = normalizarData(row[e('DATA_EVENTO')] || new Date());

      try {
        let teveAcao = false;
        if (incluirNF) {
          const temNF = parseBooleanPlanilha_(row[e('TEM_NF')]);
          const valorNF = Number(row[e('VALOR_NF')]) || 0;
          const statusNF = String(row[e('STATUS_NF')] || '').toUpperCase().trim();
          const expectedNF = temNF && valorNF > 0 && (statusNF === 'PROCESSADO' || statusNF === 'EMITIDA' || statusNF === 'PAGA');
          if (expectedNF && !mapAnyNf[idEvento] && !mapSeedNf[idEvento]) {
            const linhaNF = [
              gerarIDMovimentacao(),
              'NF_EVENTO',
              'SAÍDA',
              idEvento,
              nomeEvento,
              dataMov,
              Number(valorNF.toFixed(2)),
              '',
              'Nota Fiscal',
              '',
              '',
              marcador + ' tipo=NF valor=' + String(Number(valorNF.toFixed(2))),
              usuario,
              new Date(),
              '',
              'PROCESSADO'
            ];
            appendRowComVerificacao_(shMov, linhaNF, 'MOV/MIGRACAO_NF_2025');
            mapAnyNf[idEvento] = true;
            mapSeedNf[idEvento] = true;
            rel.nfCriadas++;
            teveAcao = true;
          } else if (expectedNF && mapAnyNf[idEvento]) {
            rel.ignoradosJaComMov++;
          }
        }

        if (incluirFolha) {
          const valorFolha = Number(row[e('FOLHA_CUSTO_VALOR')]) || 0;
          const descFolha = String(row[e('FOLHA_CUSTO_DESCRICAO')] || '').trim();
          if (valorFolha > 0 && !mapAnyFolha[idEvento] && !mapSeedFolha[idEvento]) {
            const linhaFolha = [
              gerarIDMovimentacao(),
              'FOLHA_EVENTO',
              'SAÍDA',
              idEvento,
              nomeEvento,
              dataMov,
              Number(valorFolha.toFixed(2)),
              '',
              'Folha',
              '',
              '',
              (descFolha ? descFolha + ' | ' : '') + marcador + ' tipo=FOLHA valor=' + String(Number(valorFolha.toFixed(2))),
              usuario,
              new Date(),
              '',
              'PROCESSADO'
            ];
            appendRowComVerificacao_(shMov, linhaFolha, 'MOV/MIGRACAO_FOLHA_2025');
            mapAnyFolha[idEvento] = true;
            mapSeedFolha[idEvento] = true;
            rel.folhaCriadas++;
            teveAcao = true;
          } else if (valorFolha > 0 && mapAnyFolha[idEvento]) {
            rel.ignoradosJaComMov++;
          }
        }

        if (teveAcao) {
          rel.processados++;
        }
      } catch (err) {
        rel.erros.push({ idEvento: idEvento, erro: String(err && err.message ? err.message : err) });
      }
    }

    return rel;
  });
}

function executarAuditoriaSaidasLegado2025Manual(emailProprietario) {
  const email = String(emailProprietario || '').trim().toLowerCase();
  if (!email) throw new Error('Informe o email do proprietário para auditoria.');
  const anterior = globalThis.REQUEST_EMAIL;
  try {
    globalThis.REQUEST_EMAIL = email;
    return auditarSaidasLegado2025({ anoMinimo: 2025, limit: 300 });
  } finally {
    if (typeof anterior === 'undefined') delete globalThis.REQUEST_EMAIL;
    else globalThis.REQUEST_EMAIL = anterior;
  }
}

function executarMigracaoNfFolha2025Manual(emailProprietario, chunkSize) {
  const email = String(emailProprietario || '').trim().toLowerCase();
  if (!email) throw new Error('Informe o email do proprietário para migração de NF/Folha.');
  const anterior = globalThis.REQUEST_EMAIL;
  try {
    globalThis.REQUEST_EMAIL = email;
    return migrarSaidasLegadoNfFolha2025({
      anoMinimo: 2025,
      incluirNF: 'TRUE',
      incluirFolha: 'TRUE',
      chunkSize: Number(chunkSize) || 80
    });
  } finally {
    if (typeof anterior === 'undefined') delete globalThis.REQUEST_EMAIL;
    else globalThis.REQUEST_EMAIL = anterior;
  }
}

function parseBooleanPlanilha_(valor) {
  if (typeof valor === 'boolean') return valor;
  const t = String(valor || '').trim().toUpperCase();
  return t === 'TRUE' || t === 'SIM' || t === '1' || t === 'YES';
}

function extrairAnoEventoSaldoSaidas_(idEvento, dataEvento) {
  const id = String(idEvento || '');
  const m = id.match(/(20\d{2})/);
  if (m) return Number(m[1]);
  const d = new Date(dataEvento);
  if (!isNaN(d.getTime())) return d.getFullYear();
  return 0;
}

function auditarBvLegado2025a2027(params) {
  exigirAcao('financeiro:migrarSaldoInicial');

  const anoMinimo = Math.max(2000, Number((params && params.anoMinimo) || 2025));
  const anoMaximo = Math.max(anoMinimo, Number((params && params.anoMaximo) || 2027));
  const limiteLista = Math.max(20, Math.min(Number((params && params.limit) || 300), 2000));

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shEvt = ss.getSheetByName('EVENTOS');
  const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  if (!shEvt || !shMov) throw new Error('Planilhas EVENTOS e MOVIMENTACOES_FINANCEIRAS não encontradas');

  const evtData = shEvt.getDataRange().getValues();
  const movData = shMov.getDataRange().getValues();
  if (evtData.length < 2) return { sucesso: true, resumo: { eventosAnalisados: 0 } };

  const evtHead = evtData[0];
  const movHead = movData[0];
  const e = c => evtHead.indexOf(c);
  const m = c => movHead.indexOf(c);

  const reqEvt = ['ID_EVENTO', 'TIPO_REGISTRO', 'DATA_EVENTO', 'TIPO_EVENTO', 'NOME_CONTRATANTE', 'VALOR_BV', 'STATUS_BV', 'ID_BV', 'NOME_BV'];
  const reqMov = ['TIPO_MOVIMENTACAO', 'STATUS', 'ID_EVENTO', 'VALOR', 'ID_CONTRAPARTE', 'CONTRAPARTE', 'OBSERVACOES'];
  for (var i = 0; i < reqEvt.length; i++) if (e(reqEvt[i]) === -1) throw new Error('Coluna faltando em EVENTOS: ' + reqEvt[i]);
  for (var j = 0; j < reqMov.length; j++) if (m(reqMov[j]) === -1) throw new Error('Coluna faltando em MOVIMENTACOES_FINANCEIRAS: ' + reqMov[j]);

  const mapaBv = {};
  for (let r = 1; r < movData.length; r++) {
    const row = movData[r];
    if (String(row[m('STATUS')] || '') === 'CANCELADO') continue;
    if (String(row[m('TIPO_MOVIMENTACAO')] || '') !== 'BV_EVENTO') continue;
    const idEvento = String(row[m('ID_EVENTO')] || '').trim();
    if (!idEvento) continue;
    if (!mapaBv[idEvento]) mapaBv[idEvento] = [];
    mapaBv[idEvento].push({
      status: String(row[m('STATUS')] || '').trim().toUpperCase(),
      valor: Number(row[m('VALOR')]) || 0,
      idContraparte: String(row[m('ID_CONTRAPARTE')] || '').trim(),
      contraparte: String(row[m('CONTRAPARTE')] || '').trim(),
      seed: String(row[m('OBSERVACOES')] || '').indexOf('[MIGRACAO_BV_LEGADO_V1]') !== -1
    });
  }

  const pendencias = [];
  const resumo = {
    eventosAnalisados: 0,
    eventosFaixaAno: 0,
    eventosComBvValor: 0,
    bvComMov: 0,
    bvSemMov: 0,
    statusDivergente: 0,
    valorDivergente: 0,
    idParceiroDivergente: 0
  };

  for (let rEvt = 1; rEvt < evtData.length; rEvt++) {
    const row = evtData[rEvt];
    resumo.eventosAnalisados++;
    const idEvento = String(row[e('ID_EVENTO')] || '').trim();
    if (!idEvento) continue;
    const tipoRegistro = String(row[e('TIPO_REGISTRO')] || '').trim();
    if (tipoRegistro && tipoRegistro !== 'Evento') continue;

    const ano = extrairAnoEventoSaldoSaidas_(idEvento, row[e('DATA_EVENTO')]);
    if (ano < anoMinimo || ano > anoMaximo) continue;
    resumo.eventosFaixaAno++;

    const valorBV = Number(row[e('VALOR_BV')]) || 0;
    if (valorBV <= 0) continue;
    resumo.eventosComBvValor++;

    const expectedStatus = ano === 2025 ? 'PROCESSADO' : 'PENDENTE';
    const idParceiro = String(row[e('ID_BV')] || '').trim();
    const nomeParceiro = String(row[e('NOME_BV')] || '').trim();
    const nomeEvento = (String(row[e('TIPO_EVENTO')] || '') + ' ' + String(row[e('NOME_CONTRATANTE')] || '')).trim();

    const movs = mapaBv[idEvento] || [];
    if (!movs.length) {
      resumo.bvSemMov++;
      if (pendencias.length < limiteLista) {
        pendencias.push({
          idEvento, ano, nomeEvento,
          tipo: 'SEM_MOVIMENTO_BV',
          esperadoStatus: expectedStatus,
          esperadoValor: Number(valorBV.toFixed(2)),
          esperadoIdParceiro: idParceiro,
          esperadoNomeParceiro: nomeParceiro
        });
      }
      continue;
    }

    resumo.bvComMov++;
    const primeiro = movs[0];
    const statusOk = primeiro.status === expectedStatus;
    const valorOk = Math.abs((primeiro.valor || 0) - Number(valorBV.toFixed(2))) <= 0.01;
    const parceiroOk = !idParceiro || String(primeiro.idContraparte || '').trim() === idParceiro;

    if (!statusOk) resumo.statusDivergente++;
    if (!valorOk) resumo.valorDivergente++;
    if (!parceiroOk) resumo.idParceiroDivergente++;

    if ((!statusOk || !valorOk || !parceiroOk) && pendencias.length < limiteLista) {
      pendencias.push({
        idEvento, ano, nomeEvento,
        tipo: 'DIVERGENCIA_BV',
        esperadoStatus: expectedStatus,
        atualStatus: primeiro.status,
        esperadoValor: Number(valorBV.toFixed(2)),
        atualValor: Number((primeiro.valor || 0).toFixed(2)),
        esperadoIdParceiro: idParceiro,
        atualIdParceiro: String(primeiro.idContraparte || ''),
        seed: Boolean(primeiro.seed)
      });
    }
  }

  return {
    sucesso: true,
    anoMinimo,
    anoMaximo,
    resumo,
    pendencias
  };
}

function migrarBvLegado2025a2027(params) {
  exigirAcao('financeiro:migrarSaldoInicial');

  return executarComLockFinanceiro_('MIGRAR_BV_LEGADO_2025_2027', function () {
    const anoMinimo = Math.max(2000, Number((params && params.anoMinimo) || 2025));
    const anoMaximo = Math.max(anoMinimo, Number((params && params.anoMaximo) || 2027));
    const chunkSize = Math.max(1, Math.min(Number((params && params.chunkSize) || 80), 400));
    const atualizarSeeds = String((params && params.atualizarSeeds) || 'TRUE').toUpperCase() === 'TRUE';
    const cadastrarCerimonialistas = String((params && params.cadastrarCerimonialistas) || 'TRUE').toUpperCase() === 'TRUE';

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const shEvt = ss.getSheetByName('EVENTOS');
    const shMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    if (!shEvt || !shMov) throw new Error('Planilhas EVENTOS e MOVIMENTACOES_FINANCEIRAS não encontradas');

    const evtData = shEvt.getDataRange().getValues();
    const movData = shMov.getDataRange().getValues();
    if (evtData.length < 2) return { sucesso: true, mensagem: 'Sem eventos para migrar BV.' };

    const evtHead = evtData[0];
    const movHead = movData[0];
    const e = c => evtHead.indexOf(c);
    const m = c => movHead.indexOf(c);
    const usuario = getUsuarioAtual().email;
    const marcador = '[MIGRACAO_BV_LEGADO_V1]';

    const mapaBv = {};
    for (let r = 1; r < movData.length; r++) {
      const row = movData[r];
      if (String(row[m('STATUS')] || '') === 'CANCELADO') continue;
      if (String(row[m('TIPO_MOVIMENTACAO')] || '') !== 'BV_EVENTO') continue;
      const idEvento = String(row[m('ID_EVENTO')] || '').trim();
      if (!idEvento) continue;
      if (!mapaBv[idEvento]) mapaBv[idEvento] = [];
      mapaBv[idEvento].push({
        rowIndex: r + 1,
        status: String(row[m('STATUS')] || '').trim().toUpperCase(),
        valor: Number(row[m('VALOR')]) || 0,
        idContraparte: String(row[m('ID_CONTRAPARTE')] || '').trim(),
        contraparte: String(row[m('CONTRAPARTE')] || '').trim(),
        seed: String(row[m('OBSERVACOES')] || '').indexOf(marcador) !== -1
      });
    }

    const rel = {
      sucesso: true,
      anoMinimo,
      anoMaximo,
      chunkSize,
      analisados: 0,
      processados: 0,
      criados: 0,
      atualizadosSeed: 0,
      ignoradosJaComMov: 0,
      erros: []
    };

    for (let rEvt = 1; rEvt < evtData.length; rEvt++) {
      if (rel.processados >= chunkSize) break;
      const row = evtData[rEvt];
      const idEvento = String(row[e('ID_EVENTO')] || '').trim();
      if (!idEvento) continue;
      const tipoRegistro = String(row[e('TIPO_REGISTRO')] || '').trim();
      if (tipoRegistro && tipoRegistro !== 'Evento') continue;

      const ano = extrairAnoEventoSaldoSaidas_(idEvento, row[e('DATA_EVENTO')]);
      if (ano < anoMinimo || ano > anoMaximo) continue;
      rel.analisados++;

      const valorBV = Number(row[e('VALOR_BV')]) || 0;
      if (valorBV <= 0) continue;

      const expectedStatus = ano === 2025 ? 'PROCESSADO' : 'PENDENTE';
      const idParceiro = String(row[e('ID_BV')] || '').trim();
      const nomeParceiro = String(row[e('NOME_BV')] || '').trim();
      const nomeCerimonialista = String(row[e('NOME_CERIMONIALISTA')] || '').trim();
      const obsEvento = String(row[e('OBSERVACOES')] || '').trim();
      const tipoEvento = String(row[e('TIPO_EVENTO')] || '').trim();
      const nomeContratante = String(row[e('NOME_CONTRATANTE')] || '').trim();
      const nomeEvento = (tipoEvento + ' ' + nomeContratante).trim() || idEvento;
      const dataMov = normalizarData(row[e('DATA_EVENTO')] || new Date());
      const movs = mapaBv[idEvento] || [];
      const destino = resolverDestinatarioBV_(nomeCerimonialista, obsEvento, nomeParceiro);
      const cadastroDest = cadastrarCerimonialistas
        ? garantirCerimonialistaPorNome_(destino.nome, usuario)
        : { id: '', nome: destino.nome, criado: false, encontrado: false };
      const contraparteFinal = cadastroDest.nome || destino.nome || nomeParceiro || 'BV';
      const idContraparteFinal = cadastroDest.id || idParceiro;
      const obsDestino = montarObsDestinoBV_(destino, cadastroDest);

      try {
        if (!movs.length) {
          const linhaBV = [
            gerarIDMovimentacao(),
            'BV_EVENTO',
            'SAÍDA',
            idEvento,
            nomeEvento,
            dataMov,
            Number(valorBV.toFixed(2)),
            '',
            contraparteFinal,
            idContraparteFinal,
            '',
            marcador + ' ano=' + String(ano) + ' status=' + expectedStatus + ' valor=' + String(Number(valorBV.toFixed(2))) + obsDestino,
            usuario,
            new Date(),
            '',
            expectedStatus
          ];
          appendRowComVerificacao_(shMov, linhaBV, 'MOV/MIGRACAO_BV_LEGADO');
          rel.criados++;
          rel.processados++;
          continue;
        }

        const primeiro = movs[0];
        if (atualizarSeeds && primeiro.seed) {
          const rowNum = primeiro.rowIndex;
          setValueComVerificacao_(shMov, rowNum, m('NOME_EVENTO') + 1, nomeEvento, 'MOV/BV/NOME_EVENTO');
          setValueComVerificacao_(shMov, rowNum, m('DATA_MOVIMENTACAO') + 1, dataMov, 'MOV/BV/DATA_MOV');
          setValueComVerificacao_(shMov, rowNum, m('VALOR') + 1, Number(valorBV.toFixed(2)), 'MOV/BV/VALOR');
          setValueComVerificacao_(shMov, rowNum, m('CONTRAPARTE') + 1, contraparteFinal, 'MOV/BV/CONTRAPARTE');
          setValueComVerificacao_(shMov, rowNum, m('ID_CONTRAPARTE') + 1, idContraparteFinal, 'MOV/BV/ID_CONTRAPARTE');
          setValueComVerificacao_(shMov, rowNum, m('STATUS') + 1, expectedStatus, 'MOV/BV/STATUS');
          if (m('OBSERVACOES') >= 0) {
            const obsAtual = String(shMov.getRange(rowNum, m('OBSERVACOES') + 1).getValue() || '');
            if (obsAtual.indexOf('destino_bv=') === -1 && obsDestino) {
              setValueComVerificacao_(
                shMov,
                rowNum,
                m('OBSERVACOES') + 1,
                (obsAtual ? (obsAtual + ' | ') : '') + 'atualizado_reconciliacao_bv' + obsDestino,
                'MOV/BV/OBS_DESTINO'
              );
            }
          }
          atualizarAuditoriaMovimentacaoBestEffort_(shMov, rowNum, m, usuario);
          rel.atualizadosSeed++;
          rel.processados++;
        } else {
          rel.ignoradosJaComMov++;
        }
      } catch (err) {
        rel.erros.push({ idEvento, erro: String(err && err.message ? err.message : err) });
      }
    }

    return rel;
  });
}

function executarAuditoriaBvLegadoManual(emailProprietario) {
  const email = String(emailProprietario || '').trim().toLowerCase();
  if (!email) throw new Error('Informe o email do proprietário para auditoria BV.');
  const anterior = globalThis.REQUEST_EMAIL;
  try {
    globalThis.REQUEST_EMAIL = email;
    return auditarBvLegado2025a2027({ anoMinimo: 2025, anoMaximo: 2027, limit: 300 });
  } finally {
    if (typeof anterior === 'undefined') delete globalThis.REQUEST_EMAIL;
    else globalThis.REQUEST_EMAIL = anterior;
  }
}

function executarMigracaoBvLegadoManual(emailProprietario, chunkSize) {
  const email = String(emailProprietario || '').trim().toLowerCase();
  if (!email) throw new Error('Informe o email do proprietário para migração BV.');
  const anterior = globalThis.REQUEST_EMAIL;
  try {
    globalThis.REQUEST_EMAIL = email;
    return migrarBvLegado2025a2027({
      anoMinimo: 2025,
      anoMaximo: 2027,
      chunkSize: Number(chunkSize) || 80,
      atualizarSeeds: 'TRUE',
      cadastrarCerimonialistas: 'TRUE'
    });
  } finally {
    if (typeof anterior === 'undefined') delete globalThis.REQUEST_EMAIL;
    else globalThis.REQUEST_EMAIL = anterior;
  }
}

