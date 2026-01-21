/**
 * ========================================
 * ADICIONAR CIDADE E ESTADO EM ENDERECOS
 * VERSÃO ROBUSTA COM DEBUG
 * ========================================
 */

/**
 * Versão simplificada SEM confirmação (para debug)
 */
function adicionarCidadeEstadoEnderecosDirect() {
  try {
    Logger.log('Iniciando adição de colunas...');
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    Logger.log('Planilha obtida: ' + ss.getName());
    
    const sheet = ss.getSheetByName('ENDERECOS');
    
    if (!sheet) {
      Logger.log('ERRO: Aba ENDERECOS não encontrada');
      Browser.msgBox('❌ Aba ENDERECOS não encontrada!');
      return;
    }
    
    Logger.log('Aba ENDERECOS encontrada');
    
    const lastCol = sheet.getLastColumn();
    Logger.log('Última coluna: ' + lastCol);
    
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    Logger.log('Headers atuais: ' + JSON.stringify(headers));
    
    // Verifica se já existem
    if (headers.indexOf('CIDADE') >= 0) {
      Logger.log('CIDADE já existe na posição: ' + headers.indexOf('CIDADE'));
      Browser.msgBox('⚠️ Coluna CIDADE já existe!');
      return;
    }
    
    if (headers.indexOf('ESTADO') >= 0) {
      Logger.log('ESTADO já existe na posição: ' + headers.indexOf('ESTADO'));
      Browser.msgBox('⚠️ Coluna ESTADO já existe!');
      return;
    }
    
    // Adiciona CIDADE
    Logger.log('Adicionando coluna CIDADE na posição: ' + (lastCol + 1));
    sheet.getRange(1, lastCol + 1).setValue('CIDADE');
    
    // Adiciona ESTADO
    Logger.log('Adicionando coluna ESTADO na posição: ' + (lastCol + 2));
    sheet.getRange(1, lastCol + 2).setValue('ESTADO');
    
    // Formata headers
    Logger.log('Formatando headers...');
    sheet.getRange(1, lastCol + 1, 1, 2)
      .setBackground('#1a1a1a')
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setHorizontalAlignment('center');
    
    // Cria dropdown de ESTADOS
    Logger.log('Criando dropdown de estados...');
    criarDropdownEstadosSafe(sheet, lastCol + 2);
    
    Logger.log('Concluído com sucesso!');
    Browser.msgBox('✅ Colunas CIDADE e ESTADO adicionadas com sucesso!');
    
  } catch (error) {
    Logger.log('ERRO CAPTURADO: ' + error.toString());
    Logger.log('Stack: ' + error.stack);
    Browser.msgBox('❌ ERRO: ' + error.toString());
  }
}

/**
 * Versão com confirmação (original melhorada)
 */
function adicionarCidadeEstadoEnderecos() {
  try {
    const ui = SpreadsheetApp.getUi();
    
    const resposta = ui.alert(
      '🗺️ ADICIONAR CIDADE/ESTADO',
      'Esta operação vai adicionar 2 colunas na aba ENDERECOS:\n\n' +
      '• CIDADE (texto livre)\n' +
      '• ESTADO (dropdown com UFs)\n\n' +
      'Continuar?',
      ui.ButtonSet.YES_NO
    );
    
    if (resposta !== ui.Button.YES) {
      ui.alert('Operação cancelada');
      return;
    }
    
    // Chama versão direta
    adicionarCidadeEstadoEnderecosDirect();
    
  } catch (error) {
    Logger.log('Erro: ' + error.toString());
    Browser.msgBox('❌ ERRO: ' + error.toString());
  }
}

/**
 * Cria dropdown de Estados (versão segura)
 */
function criarDropdownEstadosSafe(sheet, colIndex) {
  try {
    const estados = [
      'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
      'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
      'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
    ];
    
    const lastRow = sheet.getLastRow();
    const targetRows = Math.max(lastRow, 100); // Pelo menos 100 linhas
    
    Logger.log('Criando dropdown na coluna ' + colIndex + ' para ' + targetRows + ' linhas');
    
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(estados, true)
      .setAllowInvalid(false)
      .build();
    
    // Aplica validação (de linha 2 até targetRows)
    if (targetRows > 1) {
      sheet.getRange(2, colIndex, targetRows - 1, 1).setDataValidation(rule);
    }
    
    Logger.log('Dropdown criado com sucesso');
    
  } catch (error) {
    Logger.log('Erro ao criar dropdown: ' + error.toString());
    // Não interrompe - dropdown é opcional
  }
}

/**
 * DIAGNÓSTICO - Execute esta para ver o estado atual
 */
function diagnosticarEnderecos() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('ENDERECOS');
    
    if (!sheet) {
      Logger.log('❌ Aba ENDERECOS NÃO EXISTE');
      Browser.msgBox('❌ Aba ENDERECOS não existe!\n\nCrie a aba primeiro.');
      return;
    }
    
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    
    Logger.log('='.repeat(60));
    Logger.log('DIAGNÓSTICO DA ABA ENDERECOS');
    Logger.log('='.repeat(60));
    Logger.log('Última linha: ' + lastRow);
    Logger.log('Última coluna: ' + lastCol);
    
    if (lastCol > 0) {
      const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      Logger.log('Headers atuais:');
      headers.forEach((h, i) => {
        Logger.log('  Coluna ' + (i+1) + ': ' + h);
      });
      
      // Verifica se CIDADE e ESTADO existem
      const hasCidade = headers.indexOf('CIDADE') >= 0;
      const hasEstado = headers.indexOf('ESTADO') >= 0;
      
      Logger.log('');
      Logger.log('CIDADE existe? ' + (hasCidade ? 'SIM (coluna ' + (headers.indexOf('CIDADE')+1) + ')' : 'NÃO'));
      Logger.log('ESTADO existe? ' + (hasEstado ? 'SIM (coluna ' + (headers.indexOf('ESTADO')+1) + ')' : 'NÃO'));
    } else {
      Logger.log('❌ Aba está vazia (sem colunas)');
    }
    
    Logger.log('='.repeat(60));
    
    Browser.msgBox(
      '📊 DIAGNÓSTICO COMPLETO\n\n' +
      'Última linha: ' + lastRow + '\n' +
      'Última coluna: ' + lastCol + '\n\n' +
      'Veja o log (Ctrl+Enter) para detalhes'
    );
    
  } catch (error) {
    Logger.log('Erro no diagnóstico: ' + error.toString());
    Browser.msgBox('❌ Erro: ' + error.toString());
  }
}

/**
 * CRIAR ABA ENDERECOS (se não existir)
 */
function criarAbaEnderecos() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('ENDERECOS');
    
    if (sheet) {
      Browser.msgBox('⚠️ Aba ENDERECOS já existe!');
      return;
    }
    
    // Cria aba
    sheet = ss.insertSheet('ENDERECOS');
    
    // Headers iniciais
    const headers = [
      'ID_ENDERECO',
      'NOME_LOCAL',
      'ENDERECO_COMPLETO',
      'LINK_MAPS',
      'OBSERVACOES',
      'DATA_CADASTRO'
    ];
    
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    
    // Formata
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#1a1a1a')
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setHorizontalAlignment('center');
    
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 200);
    sheet.setColumnWidth(3, 250);
    
    Browser.msgBox('✅ Aba ENDERECOS criada com sucesso!');
    Logger.log('Aba ENDERECOS criada com 6 colunas iniciais');
    
  } catch (error) {
    Logger.log('Erro: ' + error.toString());
    Browser.msgBox('❌ Erro: ' + error.toString());
  }
}