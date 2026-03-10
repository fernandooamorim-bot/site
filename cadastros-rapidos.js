/**
 * Cadastros rápidos consolidados (canônico)
 * Evita colisão de funções globais vindas de arquivos legados.
 */

function cadastrarContratanteRapido(dados) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('CONTRATANTES');

    if (!sheet) {
      return { sucesso: false, mensagem: 'Aba CONTRATANTES não encontrada' };
    }

    const ultimaLinha = sheet.getLastRow();
    const novoId = ultimaLinha > 1 ? sheet.getRange(ultimaLinha, 1).getValue() + 1 : 1;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).toLowerCase() === String(dados.nome || '').toLowerCase()) {
        return {
          sucesso: false,
          mensagem: 'Contratante "' + dados.nome + '" já existe!',
          idExistente: data[i][0]
        };
      }
    }

    sheet.appendRow([
      novoId,
      dados.nome,
      dados.telefone || '',
      dados.email || '',
      dados.cpfCnpj || '',
      new Date()
    ]);

    return {
      sucesso: true,
      id: novoId,
      nome: dados.nome,
      mensagem: 'Contratante cadastrado!'
    };

  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function cadastrarCerimonialistaRapido(dados) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('CERIMONIALISTAS');

    if (!sheet) {
      return { sucesso: false, mensagem: 'Aba CERIMONIALISTAS não encontrada' };
    }

    const ultimaLinha = sheet.getLastRow();
    const novoId = ultimaLinha > 1 ? sheet.getRange(ultimaLinha, 1).getValue() + 1 : 1;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).toLowerCase() === String(dados.nome || '').toLowerCase()) {
        return {
          sucesso: false,
          mensagem: 'Cerimonialista já existe!',
          idExistente: data[i][0]
        };
      }
    }

    sheet.appendRow([
      novoId,
      dados.nome,
      dados.telefone || '',
      dados.empresa || '',
      new Date()
    ]);

    return {
      sucesso: true,
      id: novoId,
      nome: dados.nome,
      mensagem: 'Cerimonialista cadastrado!'
    };

  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function cadastrarEnderecoRapido(dados) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('ENDERECOS');

    if (!sheet) {
      return { sucesso: false, mensagem: 'Aba ENDERECOS não encontrada' };
    }

    const ultimaLinha = sheet.getLastRow();
    const novoId = ultimaLinha > 1 ? sheet.getRange(ultimaLinha, 1).getValue() + 1 : 1;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).toLowerCase() === String(dados.nomeLocal || '').toLowerCase()) {
        return {
          sucesso: false,
          mensagem: 'Local já existe!',
          idExistente: data[i][0]
        };
      }
    }

    sheet.appendRow([
      novoId,
      dados.nomeLocal,
      dados.enderecoCompleto || '',
      dados.linkMaps || '',
      dados.observacoes || '',
      new Date(),
      dados.cidade || '',
      dados.estado || ''
    ]);

    return {
      sucesso: true,
      id: novoId,
      nome: dados.nomeLocal,
      mensagem: 'Local cadastrado!'
    };

  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function cadastrarParceiroBVRapido(dados) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('PARCEIROS_BV');

    if (!sheet) {
      return { sucesso: false, mensagem: 'Aba PARCEIROS_BV não encontrada' };
    }

    const ultimaLinha = sheet.getLastRow();
    const novoId = ultimaLinha > 1 ? sheet.getRange(ultimaLinha, 1).getValue() + 1 : 1;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).toLowerCase() === String(dados.nome || '').toLowerCase()) {
        return {
          sucesso: false,
          mensagem: 'Parceiro já existe!',
          idExistente: data[i][0]
        };
      }
    }

    sheet.appendRow([
      novoId,
      dados.nome,
      dados.telefone || '',
      dados.tipo || 'BV',
      new Date()
    ]);

    return {
      sucesso: true,
      id: novoId,
      nome: dados.nome,
      mensagem: 'Parceiro cadastrado!'
    };

  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}
