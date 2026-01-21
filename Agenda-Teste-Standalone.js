/**
 * ════════════════════════════════════════════════════════════════
 * AGENDA SEMANAL - VERSÃO STANDALONE (SEM DEPENDÊNCIA DE COL)
 * ════════════════════════════════════════════════════════════════
 * 
 * Esta versão usa índices FIXOS para 43 colunas
 * Use para testar e diagnosticar problemas
 */

/**
 * Gera agenda da semana formatada para WhatsApp
 * VERSÃO DE TESTE - Índices fixos para 43 colunas
 */
function gerarAgendaSemanalTESTE(dataInicio, dataFim) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('EVENTOS');
    const data = sheet.getDataRange().getValues();
    
    Logger.log('═'.repeat(60));
    Logger.log('🔍 DEBUG: gerarAgendaSemanalTESTE');
    Logger.log('═'.repeat(60));
    Logger.log(`Total de colunas: ${data[0].length}`);
    Logger.log(`Total de linhas: ${data.length}`);
    Logger.log('');
    
    const eventos = [];
    
    // Filtra eventos da semana (apenas tipo EVENTO, não reunião/bloqueio)
    for (let i = 1; i < data.length; i++) {
      // ÍNDICES PARA 43 COLUNAS:
      const tipoRegistro = data[i][1];  // Col 2: TIPO_REGISTRO
      const dataEvento = new Date(data[i][2]); // Col 3: DATA_EVENTO
      
      Logger.log(`Linha ${i+1}: Tipo="${tipoRegistro}", Data=${dataEvento}`);
      
      if (tipoRegistro === 'Evento' && 
          dataEvento >= dataInicio && 
          dataEvento <= dataFim) {
        
        // LEITURA COM ÍNDICES FIXOS PARA 43 COLUNAS:
        const evento = {
          data: dataEvento,
          hora: data[i][4],           // Col 5: HORA_INICIO (era 3, +1)
          duracao: data[i][5],        // Col 6: DURACAO (era 4, +1)
          tipoEvento: data[i][6],     // Col 7: TIPO_EVENTO (era 5, +1)
          contratante: data[i][9],    // Col 10: NOME_CONTRATANTE (era 8, +1)
          cerimonialista: data[i][11],// Col 12: NOME_CERIMONIALISTA (era 10, +1)
          local: data[i][13],         // Col 14: LOCAL (era 12, +1)
          projeto: data[i][7],        // Col 8: PROJETO (era 6, +1)
          look: data[i][35],          // Col 36: LOOK (era 31, +4)
          som: data[i][36],           // Col 37: SOM_RESPONSAVEL (era 32, +4)
          observacoes: data[i][37]    // Col 38: OBSERVACOES (era 33, +4)
        };
        
        Logger.log(`  ✅ Evento incluído: ${evento.tipoEvento} - ${evento.contratante}`);
        Logger.log(`     Hora: ${evento.hora}, Local: ${evento.local}`);
        
        eventos.push(evento);
      }
    }
    
    Logger.log('');
    Logger.log(`Total de eventos filtrados: ${eventos.length}`);
    Logger.log('═'.repeat(60));
    
    // Ordena por data
    eventos.sort((a, b) => a.data - b.data);
    
    if (eventos.length === 0) {
      return {
        sucesso: true,
        texto: 'AGENDA DA SEMANA\n\nNenhum evento agendado neste período.',
        quantidadeEventos: 0
      };
    }
    
    // Monta texto formatado
    let agenda = '🎵 AGENDA DA SEMANA 🎵\n\n';
    
    eventos.forEach((evento, index) => {
      // Dia da semana e data
      const diaSemana = getDiaSemana(evento.data);
      const dia = String(evento.data.getDate()).padStart(2, '0');
      const mes = String(evento.data.getMonth() + 1).padStart(2, '0');
      
      // Hora de início e fim
      const horaInicio = evento.hora || '';
      const horaFim = calcularHoraFim(horaInicio, evento.duracao);
      
      agenda += `${diaSemana.toUpperCase()} ${dia}/${mes} – ${horaInicio} ÀS ${horaFim}\n`;
      agenda += `${evento.tipoEvento.toUpperCase()} ${evento.contratante.toUpperCase()}\n`;
      
      // Local com link se tiver
      if (evento.local) {
        const endereco = buscarEnderecoPorNome(evento.local);
        agenda += `LOCAL: ${evento.local.toUpperCase()}`;
        if (endereco && endereco.linkMaps) {
          agenda += ` - ${endereco.linkMaps}`;
        }
        agenda += `\n`;
      }
      
      // Cerimonial
      if (evento.cerimonialista) {
        agenda += `CERIMONIAL: ${evento.cerimonialista.toUpperCase()}\n`;
      }
      
      // Formato (projeto)
      if (evento.projeto) {
        agenda += `FORMATO: ${evento.projeto.toUpperCase()}\n`;
      }
      
      // Look
      if (evento.look) {
        agenda += `LOOK: ${evento.look.toUpperCase()}\n`;
      }
      
      // Som
      if (evento.som) {
        agenda += `SOM: ${evento.som.toUpperCase()}\n`;
      }
      
      // Observações
      if (evento.observacoes) {
        agenda += `OBS: ${evento.observacoes.toUpperCase()}\n`;
      }
      
      // Adiciona quebra de linha entre eventos (exceto no último)
      if (index < eventos.length - 1) {
        agenda += `\n`;
      }
    });
    
    return {
      sucesso: true,
      texto: agenda,
      quantidadeEventos: eventos.length
    };
    
  } catch (error) {
    Logger.log('❌ Erro ao gerar agenda: ' + error.message);
    Logger.log('Stack: ' + error.stack);
    return {
      sucesso: false,
      mensagem: 'Erro ao gerar agenda: ' + error.message
    };
  }
}

/**
 * Retorna nome do dia da semana em português
 */
function getDiaSemana(data) {
  const dias = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
  return dias[data.getDay()];
}

/**
 * Calcula hora de fim baseado na duração
 */
function calcularHoraFim(horaInicio, duracao) {
  if (!horaInicio || !duracao) return '';
  
  // Parse da hora início (formato: HH:MM)
  const [hora, minuto] = horaInicio.split(':').map(Number);
  
  // Parse da duração (formato: 2h, 2:30h, 3h)
  let minutosDuracao = 0;
  if (duracao.includes(':')) {
    const [h, m] = duracao.replace('h', '').split(':').map(Number);
    minutosDuracao = (h * 60) + m;
  } else {
    minutosDuracao = parseInt(duracao) * 60;
  }
  
  // Calcula hora fim
  const totalMinutos = (hora * 60) + minuto + minutosDuracao;
  const horaFim = Math.floor(totalMinutos / 60) % 24;
  const minutoFim = totalMinutos % 60;
  
  return `${String(horaFim).padStart(2, '0')}:${String(minutoFim).padStart(2, '0')}`;
}

/**
 * Busca endereço completo por nome do local
 */
function buscarEnderecoPorNome(nomeLocal) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('ENDERECOS');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === nomeLocal) {
      return {
        id: data[i][0],
        nome: data[i][1],
        endereco: data[i][2],
        linkMaps: data[i][3]
      };
    }
  }
  
  return null;
}

/**
 * TESTE - Gera agenda da próxima semana
 */
function testarAgendaProximaSemana() {
  const hoje = new Date();
  const diaSemana = hoje.getDay();
  
  // Calcula próxima segunda-feira
  const diasAteSegunda = diaSemana === 0 ? 1 : (8 - diaSemana);
  const proximaSegunda = new Date(hoje);
  proximaSegunda.setDate(hoje.getDate() + diasAteSegunda);
  proximaSegunda.setHours(0, 0, 0, 0);
  
  // Calcula próximo domingo
  const proximoDomingo = new Date(proximaSegunda);
  proximoDomingo.setDate(proximaSegunda.getDate() + 6);
  proximoDomingo.setHours(23, 59, 59, 999);
  
  Logger.log('');
  Logger.log('🧪 TESTANDO AGENDA COM ÍNDICES FIXOS (43 COLUNAS)');
  Logger.log(`Período: ${proximaSegunda.toLocaleDateString()} a ${proximoDomingo.toLocaleDateString()}`);
  Logger.log('');
  
  const resultado = gerarAgendaSemanalTESTE(proximaSegunda, proximoDomingo);
  
  Logger.log('═'.repeat(80));
  Logger.log('RESULTADO:');
  Logger.log('═'.repeat(80));
  Logger.log(resultado.texto);
  Logger.log('═'.repeat(80));
  Logger.log(`Total de eventos: ${resultado.quantidadeEventos}`);
}

/**
 * TESTE - Agenda da semana atual
 */
function testarAgendaSemanaAtual() {
  const hoje = new Date();
  const diaSemana = hoje.getDay();
  
  // Calcula segunda-feira desta semana
  const diasAteSegunda = diaSemana === 0 ? -6 : -(diaSemana - 1);
  const segundaFeira = new Date(hoje);
  segundaFeira.setDate(hoje.getDate() + diasAteSegunda);
  segundaFeira.setHours(0, 0, 0, 0);
  
  // Calcula domingo desta semana
  const domingo = new Date(segundaFeira);
  domingo.setDate(segundaFeira.getDate() + 6);
  domingo.setHours(23, 59, 59, 999);
  
  Logger.log('');
  Logger.log('🧪 TESTANDO AGENDA SEMANA ATUAL');
  Logger.log(`Período: ${segundaFeira.toLocaleDateString()} a ${domingo.toLocaleDateString()}`);
  Logger.log('');
  
  const resultado = gerarAgendaSemanalTESTE(segundaFeira, domingo);
  
  Logger.log('═'.repeat(80));
  Logger.log('RESULTADO:');
  Logger.log('═'.repeat(80));
  Logger.log(resultado.texto);
  Logger.log('═'.repeat(80));
  Logger.log(`Total de eventos: ${resultado.quantidadeEventos}`);
}

/**
 * TESTE - Todos os eventos (sem filtro de data)
 */
function testarTodosEventos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('EVENTOS');
  const data = sheet.getDataRange().getValues();
  
  Logger.log('═'.repeat(80));
  Logger.log('🔍 LISTANDO TODOS OS EVENTOS (43 COLUNAS)');
  Logger.log('═'.repeat(80));
  Logger.log(`Total de colunas: ${data[0].length}`);
  Logger.log(`Total de linhas: ${data.length}\n`);
  
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    
    Logger.log(`─── EVENTO ${i} (Linha ${i+1}) ───`);
    Logger.log(`ID: ${data[i][0]}`);
    Logger.log(`Tipo Registro: ${data[i][1]}`);
    Logger.log(`Data: ${data[i][2]}`);
    Logger.log(`Hora: ${data[i][4]} (índice 4, col 5)`);
    Logger.log(`Tipo Evento: ${data[i][6]} (índice 6, col 7)`);
    Logger.log(`Contratante: ${data[i][9]} (índice 9, col 10)`);
    Logger.log(`Local: ${data[i][13]} (índice 13, col 14)`);
    Logger.log('');
  }
  
  Logger.log('═'.repeat(80));
}
