/**
 * ========================================
 * AGENDA SEMANAL PARA WHATSAPP
 * ========================================
 * VERSÃO CORRIGIDA - ÍNDICES FIXOS PARA 43 COLUNAS
 */

/**
 * Gera agenda da semana formatada para WhatsApp
 * @param {Date} dataInicio - Data de início da semana
 * @param {Date} dataFim - Data de fim da semana
 * @returns {Object} Resultado com texto da agenda
 */
function gerarAgendaSemanal(dataInicio, dataFim) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('EVENTOS');
    const data = sheet.getDataRange().getValues();
    
    const eventos = [];
    
    // Filtra eventos da semana (apenas tipo EVENTO, não reunião/bloqueio)
    for (let i = 1; i < data.length; i++) {
      const tipoRegistro = data[i][1];  // Col 2: TIPO_REGISTRO
      const dataEvento = new Date(data[i][2]); // Col 3: DATA_EVENTO
      
      if (tipoRegistro === 'Evento' && 
          dataEvento >= dataInicio && 
          dataEvento <= dataFim) {
        
        eventos.push({
          data: dataEvento,
          hora: data[i][4],           // Col 5: HORA_INICIO
          duracao: data[i][5],        // Col 6: DURACAO
          tipoEvento: data[i][6],     // Col 7: TIPO_EVENTO
          contratante: data[i][9],    // Col 10: NOME_CONTRATANTE ← CORRIGIDO!
          cerimonialista: data[i][11],// Col 12: NOME_CERIMONIALISTA ← CORRIGIDO!
          local: data[i][13],         // Col 14: LOCAL ← CORRIGIDO!
          projeto: data[i][7],        // Col 8: PROJETO
          look: data[i][35],          // Col 36: LOOK
          som: data[i][36],           // Col 37: SOM_RESPONSAVEL
          observacoes: data[i][37]    // Col 38: OBSERVACOES
        });
      }
    }
    
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
    let agenda = 'AGENDA DA SEMANA\n\n';
    
    eventos.forEach((evento, index) => {
      // Dia da semana e data
      const diaSemana = getDiaSemana(evento.data);
      const dia = String(evento.data.getDate()).padStart(2, '0');
      const mes = String(evento.data.getMonth() + 1).padStart(2, '0');
      
      // Hora de início e fim
      const horaInicio = formatarHora(evento.hora);
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
    
    registrarLog('GERAR', 'AGENDA_SEMANAL', '', `Agenda gerada: ${eventos.length} eventos`);
    
    return {
      sucesso: true,
      texto: agenda,
      quantidadeEventos: eventos.length
    };
    
  } catch (error) {
    Logger.log('Erro ao gerar agenda: ' + error.message);
    return {
      sucesso: false,
      mensagem: 'Erro ao gerar agenda: ' + error.message
    };
  }
}

/**
 * Formata hora que pode vir como Date object ou string
 */
function formatarHora(hora) {
  if (!hora) return '';
  
  // Se for Date object
  if (hora instanceof Date) {
    const h = String(hora.getHours()).padStart(2, '0');
    const m = String(hora.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  
  // Se já for string
  return hora.toString();
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
  const partes = horaInicio.split(':');
  if (partes.length < 2) return '';
  
  const hora = parseInt(partes[0]);
  const minuto = parseInt(partes[1]);
  
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
 * Gera agenda da próxima semana (segunda a domingo)
 */
function gerarAgendaProximaSemana() {
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
  
  return gerarAgendaSemanal(proximaSegunda, proximoDomingo);
}

/**
 * Gera agenda da semana atual
 */
function gerarAgendaSemanaAtual() {
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
  
  return gerarAgendaSemanal(segundaFeira, domingo);
}

/**
 * TESTE - Exibe agenda da próxima semana no log
 */
function testarAgendaSemanal() {
  const resultado = gerarAgendaProximaSemana();
  Logger.log('='.repeat(60));
  Logger.log(resultado.texto);
  Logger.log('='.repeat(60));
  Logger.log(`Total de eventos: ${resultado.quantidadeEventos}`);
}
