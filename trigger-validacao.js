/**
 * ========================================
 * TRIGGER DE VALIDAÇÃO AUTOMÁTICA
 * VERSÃO COMPATÍVEL (sem getUi)
 * ========================================
 */

/**
 * Instala trigger onEdit (executar 1 vez)
 */
function instalarTriggerOnEdit() {
  try {
    Logger.log('Instalando trigger onEdit...');
    
    // Remove triggers antigos
    const triggers = ScriptApp.getProjectTriggers();
    let removidos = 0;
    
    triggers.forEach(trigger => {
      if (trigger.getHandlerFunction() === 'onEditValidacao') {
        ScriptApp.deleteTrigger(trigger);
        removidos++;
      }
    });
    
    Logger.log('Triggers antigos removidos: ' + removidos);
    
    // Cria novo trigger
    ScriptApp.newTrigger('onEditValidacao')
      .forSpreadsheet(SpreadsheetApp.getActive())
      .onEdit()
      .create();
    
    Logger.log('Trigger instalado com sucesso!');
    
    Browser.msgBox(
      '✅ TRIGGER INSTALADO!\n\n' +
      'Validações automáticas estão ativas.\n\n' +
      'O sistema agora executa automaticamente:\n' +
      '• Atualização de recebimentos\n' +
      '• Status de recebimento\n' +
      '• Cores e validações\n' +
      '• Auto-fill de endereços'
    );
    
    registrarLog('TRIGGER_INSTALADO', 'onEdit validação');
    
  } catch (error) {
    Logger.log('Erro ao instalar trigger: ' + error.toString());
    Browser.msgBox('❌ ERRO ao instalar trigger:\n\n' + error.toString());
  }
}

/**
 * Função principal do trigger
 */
function onEditValidacao(e) {
  if (!e || !e.range) return;
  
  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();
  const row = e.range.getRow();
  const col = e.range.getColumn();
  
  // Ignora edições no header
  if (row === 1) return;
  
  try {
    // EVENTOS: Recalcula valores financeiros
    if (sheetName === 'EVENTOS') {
      validarERecalcularEvento(sheet, row, col);
    }
    
    // MOVIMENTACOES_FINANCEIRAS: Atualiza status e cores
    if (sheetName === 'MOVIMENTACOES_FINANCEIRAS') {
      validarMovimentacao(sheet, row, col);
    }
    
    // AUTO-FILL: Quando preenche LOCAL, completa endereço
    if (sheetName === 'EVENTOS' && colunaNome(sheet, col) === 'LOCAL') {
      autoFillEnderecoNaLinha(sheet, row);
    }
    
  } catch (error) {
    Logger.log('Erro no onEdit: ' + error.message);
  }
}

/**
 * Recalcula valores financeiros de um evento
 */
/**
 * Recalcula valores financeiros de um evento
 * BLINDAGEM: Só processa tipo EVENTO
 */
function validarERecalcularEvento(sheet, row, col) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const dados = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
  
  const idx = (name) => headers.indexOf(name);
  
  // CRÍTICO: Só processa EVENTO
  const tipoRegistro = dados[idx('TIPO_REGISTRO')] || 'Evento';
  if (tipoRegistro !== 'Evento') {
    Logger.log('Ignorando recálculo - tipo: ' + tipoRegistro);
    return; // NÃO processa REUNIÃO ou BLOQUEIO
  }
  
  const colName = headers[col - 1];
  
  // Só recalcula se editou campo financeiro
  const camposFinanceiros = [
    'VALOR_RECEBIDO'
  ];
  
  if (!camposFinanceiros.includes(colName)) return;
  
  const valorTotal = Number(dados[idx('VALOR_TOTAL')]) || 0;
  const valorBV = Number(dados[idx('VALOR_BV')]) || 0;
  const temNF = dados[idx('TEM_NF')] || false;
  const valorRecebido = Number(dados[idx('VALOR_RECEBIDO')]) || 0;
  const comissaoTipo = dados[idx('COMISSAO_TIPO')] || 'Padrão';
  const comissaoValor = Number(dados[idx('COMISSAO_VALOR')]) || 0;
  
  // 2. Recalcula VALOR_PENDENTE
  if (idx('VALOR_PENDENTE') >= 0) {
    const valorPendente = Math.max(0, valorTotal - valorRecebido);
    sheet.getRange(row, idx('VALOR_PENDENTE') + 1).setValue(valorPendente);
  }
  
  // 3. Recalcula STATUS_RECEBIMENTO
  if (idx('STATUS_RECEBIMENTO') >= 0) {
    let statusRecebimento = 'Pendente';
    if (valorRecebido >= valorTotal && valorTotal > 0) {
      statusRecebimento = 'Quitado';
    } else if (valorRecebido > 0) {
      statusRecebimento = 'Parcial';
    }
    sheet.getRange(row, idx('STATUS_RECEBIMENTO') + 1).setValue(statusRecebimento);
  }
  
  // 5. Atualiza timestamp
  ensureTimestampsOnRow('EVENTOS', row);
  
  Logger.log(`Evento linha ${row} recalculado`);
}

/**
 * Valida movimentação financeira
 */
function validarMovimentacao(sheet, row, col) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colName = headers[col - 1];
  
  // Se editou STATUS ou VALOR, atualiza cor
  if (colName === 'STATUS' || colName === 'VALOR (R$)') {
    const dados = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
    const idx = (name) => headers.indexOf(name);
    
    const status = String(dados[idx('STATUS')] || '').toUpperCase();
    
    // Define cor baseada no status
    let cor = '#ffffff';
    if (status === 'PROCESSADO' || status === 'PAGO') {
      cor = '#d4edda'; // Verde claro
    } else if (status === 'PENDENTE') {
      cor = '#fff3cd'; // Amarelo claro
    } else if (status === 'ERRO') {
      cor = '#f8d7da'; // Vermelho claro
    }
    
    sheet.getRange(row, 1, 1, headers.length).setBackground(cor);
  }
}

/**
 * Auto-fill de endereço quando LOCAL é preenchido
 */
function autoFillEnderecoNaLinha(sheetEventos, row) {
  const headers = sheetEventos.getRange(1, 1, 1, sheetEventos.getLastColumn()).getValues()[0];
  const dados = sheetEventos.getRange(row, 1, 1, headers.length).getValues()[0];
  
  const idx = (name) => headers.indexOf(name);
  
  const localValue = dados[idx('LOCAL')];
  if (!localValue) return;
  
  // Busca endereço na aba ENDERECOS
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetEnd = ss.getSheetByName('ENDERECOS');
  
  if (!sheetEnd) return;
  
  const dataEnd = sheetEnd.getDataRange().getValues();
  const headersEnd = dataEnd[0];
  
  const idxEndId = headersEnd.indexOf('ID_ENDERECO');
  const idxEndNome = headersEnd.indexOf('NOME_LOCAL');
  const idxEndEndereco = headersEnd.indexOf('ENDERECO_COMPLETO');
  const idxEndCidade = headersEnd.indexOf('CIDADE');
  const idxEndEstado = headersEnd.indexOf('ESTADO');
  
  // Procura o local
  for (let i = 1; i < dataEnd.length; i++) {
    const id = dataEnd[i][idxEndId];
    const nome = dataEnd[i][idxEndNome];
    
    if (id == localValue || String(nome).toUpperCase().trim() === String(localValue).toUpperCase().trim()) {
      // Encontrou! Preenche campos VAZIOS
      
      const idxEndCompleto = idx('ENDERECO_COMPLETO');
      if (idxEndCompleto >= 0) {
        const atual = dados[idxEndCompleto];
        if (!atual && dataEnd[i][idxEndEndereco]) {
          sheetEventos.getRange(row, idxEndCompleto + 1).setValue(dataEnd[i][idxEndEndereco]);
        }
      }
      
      const idxCidade = idx('CIDADE');
      if (idxCidade >= 0) {
        const atual = dados[idxCidade];
        if (!atual && dataEnd[i][idxEndCidade]) {
          sheetEventos.getRange(row, idxCidade + 1).setValue(dataEnd[i][idxEndCidade]);
        }
      }
      
      const idxEstado = idx('ESTADO');
      if (idxEstado >= 0) {
        const atual = dados[idxEstado];
        if (!atual && dataEnd[i][idxEndEstado]) {
          sheetEventos.getRange(row, idxEstado + 1).setValue(dataEnd[i][idxEndEstado]);
        }
      }
      
      break;
    }
  }
}

/**
 * Helper: retorna nome da coluna
 */
function colunaNome(sheet, colIndex) {
  return sheet.getRange(1, colIndex).getValue();
}

/**
 * Remover trigger (se necessário)
 */
function removerTriggerOnEdit() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    let removidos = 0;
    
    triggers.forEach(trigger => {
      if (trigger.getHandlerFunction() === 'onEditValidacao') {
        ScriptApp.deleteTrigger(trigger);
        removidos++;
      }
    });
    
    Logger.log('Triggers removidos: ' + removidos);
    Browser.msgBox('✅ ' + removidos + ' trigger(s) removido(s)');
    
  } catch (error) {
    Logger.log('Erro ao remover trigger: ' + error.toString());
    Browser.msgBox('❌ Erro: ' + error.toString());
  }
}

/**
 * Listar todos os triggers instalados
 */
function listarTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  
  Logger.log('='.repeat(60));
  Logger.log('TRIGGERS INSTALADOS');
  Logger.log('='.repeat(60));
  
  if (triggers.length === 0) {
    Logger.log('Nenhum trigger instalado');
  } else {
    triggers.forEach((trigger, i) => {
      Logger.log((i+1) + '. Função: ' + trigger.getHandlerFunction());
      Logger.log('   Tipo: ' + trigger.getEventType());
    });
  }
  
  Logger.log('='.repeat(60));
  
  Browser.msgBox(
    '📋 TRIGGERS\n\n' +
    'Total: ' + triggers.length + '\n\n' +
    'Veja o log para detalhes'
  );
}