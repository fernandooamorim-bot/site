/**
 * ========================================
 * REGISTRO DE PAGAMENTOS
 * BV, Nota Fiscal e Folha de Custo
 * ========================================
 */

/**
 * Registra pagamento de BV
 */
function registrarPagamentoBV(dados) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    const sheetEventos = ss.getSheetByName('EVENTOS');
    const usuario = Session.getActiveUser().getEmail();
    
    // Busca evento
    const evento = buscarEvento(dados.idEvento);
    if (!evento) {
      return { sucesso: false, mensagem: 'Evento não encontrado' };
    }
    
    // Valida se evento tem BV
    if (!evento.idBV || evento.valorBV <= 0) {
      return { sucesso: false, mensagem: 'Este evento não possui BV configurado' };
    }
    
    // Valida se já foi pago
    if (evento.statusBV === 'PAGO') {
      return { sucesso: false, mensagem: 'BV já foi pago anteriormente' };
    }
    
    // 1. CRIA REGISTRO EM MOVIMENTACOES_FINANCEIRAS
    const idMovimentacao = gerarIDMovimentacao();
    
    const movimento = [
      idMovimentacao,
      'PAGAMENTO_BV',
      'SAIDA',
      dados.idEvento,
      evento.nomeEvento || evento.nomeContratante,
      dados.dataPagamento,
      dados.valor || evento.valorBV,
      dados.formaPagamento,
      evento.nomeBV,
      evento.idBV,
      dados.linkComprovante || '',
      dados.observacoes || 'Pagamento de BV',
      usuario,
      new Date(),
      '',
      'PAGO'
    ];
    
    const proximaLinha = sheetMov.getLastRow() + 1;
    sheetMov.getRange(proximaLinha, 1, 1, movimento.length).setValues([movimento]);
    
    // 2. ATUALIZA EVENTO
    const dataEventos = sheetEventos.getDataRange().getValues();
    for (let i = 1; i < dataEventos.length; i++) {
      if (dataEventos[i][0] === dados.idEvento) {
        // Col 29: STATUS_BV
        sheetEventos.getRange(i + 1, 29).setValue('PAGO');
        
        // Col 30: BV_DATA_PAGAMENTO
        sheetEventos.getRange(i + 1, 30).setValue(dados.dataPagamento);
        break;
      }
    }
    
    // Log
    registrarLog(
      'CRIAR',
      'MOVIMENTACOES_FINANCEIRAS',
      idMovimentacao,
      `Pagamento BV: ${evento.nomeBV} | ${formatarMoeda(dados.valor || evento.valorBV)}`
    );
    
    return {
      sucesso: true,
      idMovimentacao: idMovimentacao,
      mensagem: 'Pagamento de BV registrado com sucesso!'
    };
    
  } catch (error) {
    Logger.log('Erro ao registrar pagamento BV: ' + error.message);
    return {
      sucesso: false,
      mensagem: 'Erro: ' + error.message
    };
  }
}

/**
 * Registra pagamento de Folha de Custo
 */
function registrarFolhaCusto(dados) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    const sheetEventos = ss.getSheetByName('EVENTOS');
    const usuario = Session.getActiveUser().getEmail();
    
    // Busca evento
    const evento = buscarEvento(dados.idEvento);
    if (!evento) {
      return { sucesso: false, mensagem: 'Evento não encontrado' };
    }
    
    // 1. CRIA REGISTRO EM MOVIMENTACOES_FINANCEIRAS
    const idMovimentacao = gerarIDMovimentacao();
    
    const movimento = [
      idMovimentacao,
      'FOLHA_CUSTO',
      'SAIDA',
      dados.idEvento,
      evento.nomeEvento || evento.nomeContratante,
      dados.dataPagamento,
      dados.valor,
      dados.formaPagamento,
      'Folha de Custo',
      '',
      dados.linkComprovante || '',
      dados.descricao || 'Pagamento de folha de custo',
      usuario,
      new Date(),
      '',
      'PAGO'
    ];
    
    const proximaLinha = sheetMov.getLastRow() + 1;
    sheetMov.getRange(proximaLinha, 1, 1, movimento.length).setValues([movimento]);
    
    // 2. ATUALIZA EVENTO
    const dataEventos = sheetEventos.getDataRange().getValues();
    for (let i = 1; i < dataEventos.length; i++) {
      if (dataEventos[i][0] === dados.idEvento) {
        const linhaEvento = i + 1;
        
        // Col 34: FOLHA_CUSTO_VALOR (acumula)
        const valorAtual = dataEventos[i][33] || 0;
        const novoValor = Number(valorAtual) + Number(dados.valor);
        sheetEventos.getRange(linhaEvento, 34).setValue(novoValor);
        
        // Col 35: FOLHA_CUSTO_DESCRICAO (concatena)
        const descricaoAtual = dataEventos[i][34] || '';
        const dataFormatada = Utilities.formatDate(new Date(dados.dataPagamento), 'GMT-3', 'dd/MM');
        const novaDescricao = descricaoAtual 
          ? `${descricaoAtual}; ${dataFormatada}: ${dados.descricao}`
          : `${dataFormatada}: ${dados.descricao}`;
        sheetEventos.getRange(linhaEvento, 35).setValue(novaDescricao);
        
        break;
      }
    }
    
    // Log
    registrarLog(
      'CRIAR',
      'MOVIMENTACOES_FINANCEIRAS',
      idMovimentacao,
      `Folha Custo: ${dados.descricao} | ${formatarMoeda(dados.valor)}`
    );
    
    return {
      sucesso: true,
      idMovimentacao: idMovimentacao,
      mensagem: 'Folha de custo registrada com sucesso!'
    };
    
  } catch (error) {
    Logger.log('Erro ao registrar folha de custo: ' + error.message);
    return {
      sucesso: false,
      mensagem: 'Erro: ' + error.message
    };
  }
}

/**
 * Lista eventos com BV pendente de pagamento
 */
function listarEventosBVPendente() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('EVENTOS');
    const dados = sheet.getDataRange().getValues();
    
    const eventos = [];
    
    for (let i = 1; i < dados.length; i++) {
      const statusBV = dados[i][28]; // Col 29
      const valorBV = dados[i][27];  // Col 28
      
      if (statusBV === 'A PAGAR' && valorBV > 0) {
        eventos.push({
          idEvento: dados[i][0],
          dataEvento: dados[i][2],
          nomeEvento: dados[i][9], // NOME_CONTRATANTE
          nomeBV: dados[i][26],
          valorBV: valorBV,
          statusBV: statusBV
        });
      }
    }
    
    return eventos;
    
  } catch (error) {
    Logger.log('Erro ao listar BV pendente: ' + error.message);
    return [];
  }
}

/**
 * Busca totais de folha de custo de um evento
 */
function buscarFolhaCusto(idEvento) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('EVENTOS');
    const dados = sheet.getDataRange().getValues();
    
    for (let i = 1; i < dados.length; i++) {
      if (dados[i][0] === idEvento) {
        return {
          valor: dados[i][33] || 0,        // Col 34
          descricao: dados[i][34] || ''    // Col 35
        };
      }
    }
    
    return { valor: 0, descricao: '' };
    
  } catch (error) {
    Logger.log('Erro ao buscar folha de custo: ' + error.message);
    return { valor: 0, descricao: '' };
  }
}
