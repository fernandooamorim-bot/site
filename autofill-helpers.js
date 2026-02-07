/**
 * ========================================
 * HELPERS DE AUTO-FILL E TIMESTAMPS
 * ========================================
 * 
 * Funções não destrutivas que respeitam dados existentes
 */

/**
 * Auto-fill de endereço quando LOCAL é preenchido
 * NÃO sobrescreve campos que já têm valor
 */
function autoFillEnderecoFromLocal() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetEventos = ss.getSheetByName('EVENTOS');
    const sheetEnderecos = ss.getSheetByName('ENDERECOS');
    
    if (!sheetEventos || !sheetEnderecos) {
      Logger.log('Abas EVENTOS ou ENDERECOS não encontradas');
      return;
    }
    
    const dataEventos = sheetEventos.getDataRange().getValues();
    const dataEnderecos = sheetEnderecos.getDataRange().getValues();
    
    const headersEventos = dataEventos[0];
    const headersEnderecos = dataEnderecos[0];
    
    // Índices na aba EVENTOS
    const idxLocal = findColumnIndex(headersEventos, ['LOCAL', 'ID_ENDERECO']);
    const idxEndCompleto = findColumnIndex(headersEventos, ['ENDERECO_COMPLETO', 'ENDEREÇO']);
    const idxCidade = findColumnIndex(headersEventos, ['CIDADE']);
    const idxEstado = findColumnIndex(headersEventos, ['ESTADO']);
    
    // Índices na aba ENDERECOS
    const idxEndId = findColumnIndex(headersEnderecos, ['ID_ENDERECO', 'ID']);
    const idxEndNome = findColumnIndex(headersEnderecos, ['NOME_LOCAL', 'LOCAL']);
    const idxEndEndereco = findColumnIndex(headersEnderecos, ['ENDERECO_COMPLETO', 'ENDEREÇO']);
    const idxEndCidade = findColumnIndex(headersEnderecos, ['CIDADE']);
    const idxEndEstado = findColumnIndex(headersEnderecos, ['ESTADO']);
    
    if (idxLocal < 0 || idxEndId < 0) {
      Logger.log('Colunas necessárias não encontradas');
      return;
    }
    
    // Cria mapa de endereços
    const mapaEnderecos = {};
    for (let i = 1; i < dataEnderecos.length; i++) {
      const id = dataEnderecos[i][idxEndId];
      const nome = idxEndNome >= 0 ? dataEnderecos[i][idxEndNome] : '';
      
      if (id) {
        mapaEnderecos[id] = {
          endereco: idxEndEndereco >= 0 ? dataEnderecos[i][idxEndEndereco] : '',
          cidade: idxEndCidade >= 0 ? dataEnderecos[i][idxEndCidade] : '',
          estado: idxEndEstado >= 0 ? dataEnderecos[i][idxEndEstado] : ''
        };
      }
      
      // Também mapeia por nome (case-insensitive)
      if (nome) {
        const nomeKey = String(nome).toUpperCase().trim();
        mapaEnderecos[nomeKey] = mapaEnderecos[id];
      }
    }
    
    let updated = 0;
    
    // Percorre eventos e preenche campos vazios
    for (let i = 1; i < dataEventos.length; i++) {
      const localValue = dataEventos[i][idxLocal];
      if (!localValue) continue;
      
      const key = String(localValue).toUpperCase().trim();
      const endereco = mapaEnderecos[localValue] || mapaEnderecos[key];
      
      if (endereco) {
        const rowNumber = i + 1;
        
        // CRÍTICO: Só preenche se campo estiver VAZIO
        if (idxEndCompleto >= 0) {
          const atual = sheetEventos.getRange(rowNumber, idxEndCompleto + 1).getValue();
          if (!atual && endereco.endereco) {
            sheetEventos.getRange(rowNumber, idxEndCompleto + 1).setValue(endereco.endereco);
            updated++;
          }
        }
        
        if (idxCidade >= 0) {
          const atual = sheetEventos.getRange(rowNumber, idxCidade + 1).getValue();
          if (!atual && endereco.cidade) {
            sheetEventos.getRange(rowNumber, idxCidade + 1).setValue(endereco.cidade);
          }
        }
        
        if (idxEstado >= 0) {
          const atual = sheetEventos.getRange(rowNumber, idxEstado + 1).getValue();
          if (!atual && endereco.estado) {
            sheetEventos.getRange(rowNumber, idxEstado + 1).setValue(endereco.estado);
          }
        }
      }
    }
    
    Logger.log(`AutoFill concluído: ${updated} campos atualizados`);
    registrarLog('AUTO_FILL_ENDERECO', `${updated} campos preenchidos`);
    
  } catch (error) {
    Logger.log('Erro em autoFillEnderecoFromLocal: ' + error.message);
    registrarLog('AUTO_FILL_ERRO', error.message);
  }
}

/**
 * Função helper: busca índice de coluna com múltiplos nomes possíveis (case-insensitive)
 */
function findColumnIndex(headers, possibleNames) {
  const headersUpper = headers.map(h => String(h || '').toUpperCase().trim());
  
  for (let name of possibleNames) {
    const nameUpper = name.toUpperCase().trim();
    const idx = headersUpper.indexOf(nameUpper);
    if (idx >= 0) return idx;
  }
  
  return -1;
}

function getEmailUsuarioSeguro(context) {
  try {
    if (context && context.user && context.user.email) {
      return context.user.email;
    }
  } catch (e) {}
  return 'SYSTEM';
}

/**
 * Garante timestamps em uma linha (inteligente)
 * - CRIADO_EM: só preenche se vazio
 * - ATUALIZADO_EM: sempre atualiza
 */
function ensureTimestampsOnRow(sheetName, rowIndex, context) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) return;
    
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const now = new Date();
    
    // CRIADO_EM - só preenche se vazio
    const idxCriado = findColumnIndex(headers, ['DATA_CRIACAO', 'CRIADO_EM', 'CREATED_AT']);
    if (idxCriado >= 0) {
      const valorAtual = sheet.getRange(rowIndex, idxCriado + 1).getValue();
      if (!valorAtual) {
        sheet.getRange(rowIndex, idxCriado + 1).setValue(now);
      }
    }
    
    // ATUALIZADO_EM - sempre atualiza
    const idxAtualizado = findColumnIndex(headers, ['ULTIMA_EDICAO', 'ATUALIZADO_EM', 'UPDATED_AT']);
    if (idxAtualizado >= 0) {
      sheet.getRange(rowIndex, idxAtualizado + 1).setValue(now);
    }
    
    // CRIADO_POR - só preenche se vazio
    const idxCriadoPor = findColumnIndex(headers, ['CRIADO_POR', 'CREATED_BY']);
    if (idxCriadoPor >= 0) {
      const valorAtual = sheet.getRange(rowIndex, idxCriadoPor + 1).getValue();
      if (!valorAtual) {
        const usuario = getEmailUsuarioSeguro(context);
        sheet.getRange(rowIndex, idxCriadoPor + 1).setValue(usuario);
      }
    }
    
    // EDITADO_POR - sempre atualiza
    const idxEditadoPor = findColumnIndex(headers, ['EDITADO_POR', 'UPDATED_BY']);
    if (idxEditadoPor >= 0) {
      const usuario = getEmailUsuarioSeguro(context);
      sheet.getRange(rowIndex, idxEditadoPor + 1).setValue(usuario);
    }
    
  } catch (error) {
    Logger.log('Erro em ensureTimestampsOnRow: ' + error.message);
  }
}

/**
 * Cria aba se não existir + headers padrão
 */
function safeEnsureSheet(sheetName, defaultHeaders) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    
    // Se headers foram fornecidos, cria
    if (defaultHeaders && defaultHeaders.length > 0) {
      sheet.getRange(1, 1, 1, defaultHeaders.length).setValues([defaultHeaders]);
      sheet.getRange(1, 1, 1, defaultHeaders.length)
        .setBackground('#1a1a1a')
        .setFontColor('#ffffff')
        .setFontWeight('bold')
        .setHorizontalAlignment('center');
      sheet.setFrozenRows(1);
    }
    
    Logger.log(`Aba ${sheetName} criada com sucesso`);
  }
  
  return sheet;
}

/**
 * TESTE
 */
function testarAutoFill() {
  autoFillEnderecoFromLocal();
}