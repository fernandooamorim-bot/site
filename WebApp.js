/**
 * =====================================================
 * FA PRODUÇÕES - GESTÃO & SHOWS
 * Sistema de Gerenciamento Musical - Versão 2.0
 * =====================================================
 */



function carregarPagina(nomePagina) {
  try {
    return HtmlService
      .createHtmlOutputFromFile(nomePagina)
      .getContent();
  } catch (e) {
    return '<div style="padding:20px;color:red;font-weight:600">Erro ao carregar página: ' + nomePagina + '</div>';
  }
}

function obterUsuarioAtual() {
  try {
    const email = Session.getActiveUser().getEmail();
    
    if (!email) {
      return { valido: false, mensagem: 'Você precisa estar logado' };
    }
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('USUARIOS');
    
    if (!sheet || sheet.getLastRow() <= 1) {
      return {
        valido: true,
        id: 999,
        email: email,
        nome: email.split('@')[0],
        perfil: 'Proprietário',
        modoDev: true
      };
    }
    
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).toLowerCase() === email.toLowerCase()) {
        if (data[i][4] !== 'Ativo') {
          return { valido: false, mensagem: 'Conta inativa' };
        }
        
        return {
          valido: true,
          id: data[i][0],
          email: data[i][1],
          nome: data[i][2],
          perfil: data[i][3]
        };
      }
    }
    
    return {
      valido: false,
      mensagem: 'Email não cadastrado',
      emailDetectado: email
    };
    
  } catch (erro) {
    return { valido: false, mensagem: 'Erro: ' + erro.message };
  }
}


function listarDados(nomeAba) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(nomeAba);
    
    if (!sheet) return [];
    
    const data = sheet.getDataRange().getValues();
    const lista = [];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        lista.push({
          id: data[i][0],
          nome: data[i][1]
        });
      }
    }
    
    return lista;
  } catch (erro) {
    return [];
  }
}

function listarEventosAgenda() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('EVENTOS');
    
    if (!sheet) return [];
    
    const data = sheet.getDataRange().getValues();
    const eventos = [];
    
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      
      const dataEvento = data[i][2];
      if (!dataEvento || !(dataEvento instanceof Date)) continue;
      
      const tipoRegistro = String(data[i][1] || 'Evento');
      
      let horaStr = '';
      if (data[i][4] && data[i][4] instanceof Date) {  // Col 5: HORA_INICIO
        horaStr = Utilities.formatDate(data[i][4], 'GMT-3', 'HH:mm');
      } else if (data[i][4]) {
        horaStr = String(data[i][4]);
      }
      
      eventos.push({
        id: String(data[i][0]),
        tipoRegistro: tipoRegistro,
        dataEvento: Utilities.formatDate(dataEvento, 'GMT-3', 'yyyy-MM-dd'),
        horaInicio: horaStr,
        duracao: String(data[i][5] || ''),        // Col 6: DURACAO
        tipoEvento: String(data[i][6] || ''),     // Col 7: TIPO_EVENTO
        nomeContratante: String(data[i][9] || 'Sem nome'),  // Col 10: NOME_CONTRATANTE
        nomeLocal: String(data[i][13] || 'Sem local'),      // Col 14: LOCAL
        isEvento: tipoRegistro === 'Evento',
        isReuniao: tipoRegistro === 'Reunião',
        isBloqueio: tipoRegistro === 'Bloqueio'
      });
    }
    
    eventos.sort((a, b) => {
      if (a.dataEvento < b.dataEvento) return -1;
      if (a.dataEvento > b.dataEvento) return 1;
      return 0;
    });
    
    return eventos;
    
  } catch (erro) {
    return [];
  }
}







function fecharComissao(idVendedor, dataInicio, dataFim) {
  try {
    const calculo = calcularComissaoVendedor(idVendedor, dataInicio, dataFim);
    
    if (!calculo.sucesso) return calculo;
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('COMISSOES');
    
    if (!sheet) {
      sheet = ss.insertSheet('COMISSOES');
      sheet.appendRow([
        'ID', 'ID_VENDEDOR', 'NOME_VENDEDOR', 'DATA_INICIO', 'DATA_FIM',
        'TOTAL_EVENTOS', 'VALOR_TOTAL', 'COMISSAO', 'DATA_FECHAMENTO', 'STATUS'
      ]);
    }
    
    const id = sheet.getLastRow();
    
    sheet.appendRow([
      id,
      idVendedor,
      calculo.vendedor,
      new Date(dataInicio),
      new Date(dataFim),
      calculo.totalEventos,
      calculo.valorTotal,
      calculo.comissao,
      new Date(),
      'Fechado'
    ]);
    
    return {
      sucesso: true,
      mensagem: 'Comissão fechada! Valor: R$ ' + calculo.comissao.toFixed(2)
    };
    
  } catch (erro) {
    return {
      sucesso: false,
      mensagem: 'Erro: ' + erro.message
    };
  }
}

function gerarAgendaTexto(semana) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('EVENTOS');
    
    if (!sheet) {
      return { sucesso: false, mensagem: 'Aba EVENTOS não encontrada' };
    }
    
    const hoje = new Date();
    let dataInicio, dataFim;
    
    if (semana === 'atual') {
      const dia = hoje.getDay();
      dataInicio = new Date(hoje);
      dataInicio.setDate(hoje.getDate() - dia);
      dataFim = new Date(dataInicio);
      dataFim.setDate(dataInicio.getDate() + 6);
    } else {
      const dia = hoje.getDay();
      dataInicio = new Date(hoje);
      dataInicio.setDate(hoje.getDate() + (7 - dia));
      dataFim = new Date(dataInicio);
      dataFim.setDate(dataInicio.getDate() + 6);
    }
    
    dataInicio.setHours(0, 0, 0, 0);
    dataFim.setHours(23, 59, 59, 999);
    
    const data = sheet.getDataRange().getValues();
    const eventos = [];
    
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      
      const dataEvento = data[i][2];
      if (!(dataEvento instanceof Date)) continue;
      
      if (dataEvento >= dataInicio && dataEvento <= dataFim) {
        let horaStr = '';
        if (data[i][4] && data[i][4] instanceof Date) {  // Col 5: HORA_INICIO
          horaStr = Utilities.formatDate(data[i][4], 'GMT-3', 'HH:mm');
        }
        
        const tipoRegistro = String(data[i][1] || 'Evento');
        
        eventos.push({
          data: dataEvento,
          hora: horaStr,
          tipo: data[i][6] || '',           // Col 7: TIPO_EVENTO
          contratante: data[i][9] || '',    // Col 10: NOME_CONTRATANTE
          local: data[i][13] || '',         // Col 14: LOCAL
          tipoRegistro: tipoRegistro
        });
      }
    }
    
    eventos.sort((a, b) => a.data - b.data);
    
    let texto = '🎵 *AGENDA SEMANAL - FA PRODUÇÕES*\n\n';
    texto += Utilities.formatDate(dataInicio, 'GMT-3', 'dd/MM') + ' a ' + 
             Utilities.formatDate(dataFim, 'GMT-3', 'dd/MM/yyyy') + '\n';
    texto += '━━━━━━━━━━━━━━━━━━━━\n\n';
    
    if (eventos.length === 0) {
      texto += '📭 Nenhum evento agendado\n';
    } else {
      const dias = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
      let diaAnterior = null;
      
      eventos.forEach(ev => {
        const diaStr = Utilities.formatDate(ev.data, 'GMT-3', 'yyyy-MM-dd');
        
        if (diaStr !== diaAnterior) {
          if (diaAnterior) texto += '\n';
          const nomeDia = dias[ev.data.getDay()];
          texto += '📅 *' + nomeDia + ' - ' + 
                   Utilities.formatDate(ev.data, 'GMT-3', 'dd/MM') + '*\n';
          diaAnterior = diaStr;
        }
        
        const icone = ev.tipoRegistro === 'Reunião' ? '📋' : 
                      ev.tipoRegistro === 'Bloqueio' ? '🚫' : '🎵';
        
        texto += '  ' + icone + ' ' + ev.hora + ' - ' + ev.tipo + '\n';
        if (ev.contratante) texto += '  👤 ' + ev.contratante + '\n';
        if (ev.local && ev.local !== 'N/A') texto += '  📍 ' + ev.local + '\n';
        texto += '\n';
      });
    }
    
    texto += '━━━━━━━━━━━━━━━━━━━━\n';
    texto += '✨ FA Produções – Gestão & Shows';
    
    return {
      sucesso: true,
      texto: texto
    };
    
  } catch (erro) {
    return {
      sucesso: false,
      mensagem: 'Erro: ' + erro.message
    };
  }
}

function buscarNome(nomeAba, id) {
  try {
    if (!id) return '';
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(nomeAba);
    
    if (!sheet) return '';
    
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == id) {
        return data[i][1] || '';
      }
    }
    
    return '';
  } catch (erro) {
    return '';
  }
}

/**
 * ========================================
 * CADASTROS RÁPIDOS (INLINE)
 * ========================================
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
      if (String(data[i][1]).toLowerCase() === dados.nome.toLowerCase()) {
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
      if (String(data[i][1]).toLowerCase() === dados.nome.toLowerCase()) {
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
      if (String(data[i][1]).toLowerCase() === dados.nomeLocal.toLowerCase()) {
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
      if (String(data[i][1]).toLowerCase() === dados.nome.toLowerCase()) {
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

function buscarDadosCompletos(tipo, id) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let nomeAba = '';
    
    switch(tipo) {
      case 'contratante': nomeAba = 'CONTRATANTES'; break;
      case 'cerimonialista': nomeAba = 'CERIMONIALISTAS'; break;
      case 'endereco': nomeAba = 'ENDERECOS'; break;
      case 'parceiroBV': nomeAba = 'PARCEIROS_BV'; break;
      default: return null;
    }
    
    const sheet = ss.getSheetByName(nomeAba);
    if (!sheet) return null;
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == id) {
        const obj = {};
        headers.forEach((h, j) => {
          obj[h] = data[i][j];
        });
        return obj;
      }
    }
    
    return null;
  } catch (erro) {
    return null;
  }
}

function registrarLog(acao, detalhes) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('LOGS');
    
    if (!sheet) {
      sheet = ss.insertSheet('LOGS');
      sheet.appendRow(['DATA', 'ACAO', 'DETALHES', 'USUARIO']);
    }
    
    const usuario = obterUsuarioAtual();
    
    sheet.appendRow([
      new Date(),
      acao,
      JSON.stringify(detalhes),
      usuario.email || 'Sistema'
    ]);
    
  } catch (erro) {
    Logger.log('Erro ao registrar log: ' + erro.message);
  }
}