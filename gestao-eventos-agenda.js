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
          // Observações para agenda semanal passam a ser preenchidas manualmente no GerarAgenda.
          observacoes: ''
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
      const horaFim = calcularHoraFimAgenda_(horaInicio, evento.duracao);
      
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
      
      // Observações para o resumo semanal não são puxadas automaticamente da aba EVENTOS.
      
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
function calcularHoraFimAgendaLegacy_(horaInicio, duracao) {
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

/**
 * =====================================================
 * AGENDA SEMANAL (FRONTEND EXTERNO) — PREVIEW EDITÁVEL
 * =====================================================
 */
function carregarAgendaSemanalPreview(params) {
  const periodo = construirPeriodoAgendaSemanal_(params || {});
  const eventos = listarEventosAgendaSemanal_(periodo.dataInicio, periodo.dataFim);

  return {
    sucesso: true,
    periodo: {
      dataInicioISO: formatDateISO_(periodo.dataInicio),
      dataFimISO: formatDateISO_(periodo.dataFim),
      dataInicioBR: formatDateBR_(periodo.dataInicio),
      dataFimBR: formatDateBR_(periodo.dataFim)
    },
    quantidadeEventos: eventos.length,
    eventos: eventos
  };
}

function gerarTextoAgendaSemanal(params) {
  const payload = params || {};
  const periodo = construirPeriodoAgendaSemanal_(payload);
  const eventos = Array.isArray(payload.eventos)
    ? payload.eventos
    : listarEventosAgendaSemanal_(periodo.dataInicio, periodo.dataFim);
  const eventosOrdenados = ordenarEventosAgendaSemanalComVirada_(eventos);
  const incluirLinksCalendario = String(payload.incluirLinksCalendario || '').toUpperCase() === 'TRUE';
  const baseUrlCalendario = String(payload.baseUrlCalendario || '').trim();
  const lembreteCalendarioMinutos = normalizarLembreteCalendarioAgenda_(payload.lembreteCalendarioMinutos);

  const texto = montarTextoAgendaWhatsApp_(eventosOrdenados, periodo.dataInicio, periodo.dataFim, {
    incluirLinksCalendario: incluirLinksCalendario,
    baseUrlCalendario: baseUrlCalendario,
    lembreteCalendarioMinutos: lembreteCalendarioMinutos
  });

  return {
    sucesso: true,
    texto: texto,
    quantidadeEventos: eventosOrdenados.length,
    periodo: {
      dataInicioISO: formatDateISO_(periodo.dataInicio),
      dataFimISO: formatDateISO_(periodo.dataFim)
    }
  };
}

function construirPeriodoAgendaSemanal_(params) {
  const hoje = new Date();
  const tz = Session.getScriptTimeZone();

  const inicioRaw = String(params.dataInicio || '').trim();
  const fimRaw = String(params.dataFim || '').trim();
  const preset = String(params.preset || 'semana_atual').trim().toLowerCase();

  let dataInicio = null;
  let dataFim = null;

  if (inicioRaw && fimRaw) {
    dataInicio = parseISODateOnly_(inicioRaw);
    dataFim = parseISODateOnly_(fimRaw);
  } else {
    const base = new Date(hoje);
    base.setHours(0, 0, 0, 0);
    const diaSemana = base.getDay();
    const diasAteSegunda = diaSemana === 0 ? -6 : -(diaSemana - 1);

    dataInicio = new Date(base);
    dataInicio.setDate(base.getDate() + diasAteSegunda);
    dataFim = new Date(dataInicio);
    dataFim.setDate(dataInicio.getDate() + 6);

    if (preset === 'proxima_semana') {
      dataInicio.setDate(dataInicio.getDate() + 7);
      dataFim.setDate(dataFim.getDate() + 7);
    }
  }

  if (!dataInicio || !dataFim) {
    throw new Error('Período inválido para agenda semanal');
  }
  if (dataInicio > dataFim) {
    throw new Error('Data de início deve ser menor ou igual à data fim');
  }

  dataInicio.setHours(0, 0, 0, 0);
  dataFim.setHours(23, 59, 59, 999);

  return {
    dataInicio: dataInicio,
    dataFim: dataFim,
    timezone: tz
  };
}

function listarEventosAgendaSemanal_(dataInicio, dataFim) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetEventos = ss.getSheetByName('EVENTOS');
  const sheetEnderecos = ss.getSheetByName('ENDERECOS');
  const dados = sheetEventos.getDataRange().getValues();
  const enderecosMap = mapearLinksEndereco_(sheetEnderecos);

  const eventos = [];

  for (let i = 1; i < dados.length; i++) {
    const row = dados[i];
    if (String(row[1] || '') !== 'Evento') continue;

    const dataEvento = parseDataEventoSheet_(row[2]);
    if (!dataEvento) continue;
    if (dataEvento < dataInicio || dataEvento > dataFim) continue;

    const horaInicio = formatarHoraAgenda_(row[4]);
    const duracao = formatarDuracaoAgenda_(row[5]);
    const horaFim = calcularHoraFimAgenda_(horaInicio, row[5]);
    const local = String(row[13] || '').trim();

    eventos.push({
      idEvento: String(row[0] || ''),
      dataISO: formatDateISO_(dataEvento),
      dataBR: formatDateBR_(dataEvento),
      diaSemana: getDiaSemana(dataEvento),
      horaInicio: horaInicio,
      horaFim: horaFim,
      duracao: duracao,
      tipoEvento: String(row[6] || '').trim(),
      contratante: String(row[9] || '').trim(),
      local: local,
      linkMaps: local ? (enderecosMap[local.toLowerCase()] || '') : '',
      cerimonialista: String(row[11] || '').trim(),
      formato: String(row[7] || '').trim(),
      look: String(row[35] || '').trim(),
      somResponsavel: String(row[36] || '').trim(),
      // Campo começa em branco para ajuste manual no GerarAgenda.
      observacoes: ''
    });
  }

  return ordenarEventosAgendaSemanalComVirada_(eventos);
}

function ordenarEventosAgendaSemanalComVirada_(lista) {
  const eventos = Array.isArray(lista) ? lista.slice() : [];
  eventos.sort(function (a, b) {
    const dataCmp = compararDataISOAgendaSemanal_(a && a.dataISO, b && b.dataISO);
    if (dataCmp !== 0) return dataCmp;
    return minutosOrdenacaoAgendaSemanal_(a && a.horaInicio) - minutosOrdenacaoAgendaSemanal_(b && b.horaInicio);
  });
  return eventos;
}

function compararDataISOAgendaSemanal_(aISO, bISO) {
  const a = parseISODateOnly_(aISO);
  const b = parseISODateOnly_(bISO);
  if (a && b) return a.getTime() - b.getTime();
  if (a && !b) return -1;
  if (!a && b) return 1;
  return 0;
}

function obterHoraViradaMadrugadaAgendaSemanal_() {
  try {
    const cfg = (typeof getConfig === 'function') ? (getConfig() || {}) : {};
    const bruto = cfg.AGENDA_HORA_VIRADA_MADRUGADA;
    const n = Number(String(bruto || '').trim());
    if (!isNaN(n) && n >= 0 && n <= 12) return Math.floor(n);
  } catch (_) {}
  return 6;
}

function minutosOrdenacaoAgendaSemanal_(horaStr) {
  const m = String(horaStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 99 * 60;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (isNaN(h) || isNaN(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return 99 * 60;
  let total = (h * 60) + mm;
  if (h < obterHoraViradaMadrugadaAgendaSemanal_()) total += 24 * 60;
  return total;
}

function montarTextoAgendaWhatsApp_(eventos, dataInicio, dataFim) {
  const lista = Array.isArray(eventos) ? eventos : [];
  const opcoes = arguments[3] || {};
  const incluirLinksCalendario = opcoes.incluirLinksCalendario === true;
  const baseUrlCalendario = String(opcoes.baseUrlCalendario || '').trim();
  const lembreteCalendarioMinutos = normalizarLembreteCalendarioAgenda_(opcoes.lembreteCalendarioMinutos);
  const linhas = [];

  linhas.push('*AGENDA SEMANAL*');
  linhas.push('');
  linhas.push('*Período:* ' + formatDateBR_(dataInicio) + ' a ' + formatDateBR_(dataFim));
  linhas.push('');

  if (!lista.length) {
    linhas.push('Nenhum evento agendado neste período.');
    return linhas.join('\n');
  }

  for (let i = 0; i < lista.length; i++) {
    const ev = lista[i] || {};
    const dia = String(ev.diaSemana || obterDiaSemanaDeISO_(ev.dataISO) || '').toUpperCase();
    const dataBR = String(ev.dataBR || formatDateBR_(parseISODateOnly_(ev.dataISO)) || '');
    const horaInicio = String(ev.horaInicio || '').trim();
    const horaFim = String(ev.horaFim || '').trim();
    const tituloEvento = [String(ev.tipoEvento || '').trim(), String(ev.contratante || '').trim()]
      .filter(function (x) { return x; })
      .join(' ');

    const faixaHora = horaInicio && horaFim ? (horaInicio + ' ÀS ' + horaFim) : (horaInicio || 'HORÁRIO A DEFINIR');
    linhas.push('*' + dia + ' ' + dataBR + ' – ' + faixaHora + '*');
    linhas.push('*Evento:* ' + (tituloEvento || 'EVENTO').toUpperCase());

    if (ev.local) {
      linhas.push('*Local:* ' + String(ev.local).toUpperCase() + (ev.linkMaps ? (' - ' + ev.linkMaps) : ''));
    }
    if (ev.cerimonialista) linhas.push('*Cerimonial:* ' + String(ev.cerimonialista).toUpperCase());
    if (ev.formato) linhas.push('*Formato:* ' + String(ev.formato).toUpperCase());
    if (ev.look) linhas.push('*Look:* ' + String(ev.look).toUpperCase());
    if (ev.somResponsavel) linhas.push('*Som:* ' + String(ev.somResponsavel).toUpperCase());
    if (ev.observacoes) linhas.push('*Obs:* ' + String(ev.observacoes).toUpperCase());

    if (i < lista.length - 1) linhas.push('');
  }

  if (incluirLinksCalendario) {
    const linkCalendarioLote = gerarLinkCalendarioLoteAgenda_(lista, baseUrlCalendario, lembreteCalendarioMinutos);
    if (linkCalendarioLote) {
      linhas.push('');
      linhas.push('*Adicionar lembrete no calendário:* ' + linkCalendarioLote);
    }
  }

  return linhas.join('\n');
}

function gerarLinkCalendarioLoteAgenda_(eventos, baseUrlCalendario, lembreteCalendarioMinutos) {
  const base = resolverBaseCalendarioAgenda_(baseUrlCalendario);
  if (!base) return '';

  const lista = Array.isArray(eventos) ? eventos : [];
  const payloadEventos = [];

  for (let i = 0; i < lista.length; i++) {
    const ev = lista[i] || {};
    const dataCompacta = normalizarDataCompactaAgenda_(ev.dataISO, ev.dataBR);
    if (!dataCompacta) continue;

    const tituloCompleto = (String(ev.tipoEvento || 'Evento').trim()
      + (ev.contratante ? (' - ' + String(ev.contratante).trim()) : '')).trim();
    const item = {
      e: String(ev.idEvento || '').trim(),
      t: tituloCompleto.substring(0, 72),
      d: dataCompacta,
      s: String(ev.horaInicio || '').trim().replace(':', ''),
      f: String(ev.horaFim || '').trim().replace(':', '')
    };

    const local = String(ev.local || '').trim();
    if (local) item.l = local.substring(0, 80);
    payloadEventos.push(item);
  }

  if (!payloadEventos.length) return '';

  const payload = {
    r: lembreteCalendarioMinutos > 0 ? lembreteCalendarioMinutos : 180,
    evs: payloadEventos,
    exp: Date.now() + (1000 * 60 * 60 * 24 * 365)
  };

  const json = JSON.stringify(payload);
  const blobJson = Utilities.newBlob(json, 'application/json');
  const blobGzip = Utilities.gzip(blobJson);
  const token = 'gz1.' + Utilities.base64EncodeWebSafe(blobGzip.getBytes());
  return base + '/.netlify/functions/calendar-ics-lote?token=' + token;
}

function normalizarLembreteCalendarioAgenda_(valor) {
  const n = Number(String(valor || '').trim());
  if (!isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function normalizarDataCompactaAgenda_(dataISO, dataBR) {
  const iso = String(dataISO || '').trim();
  const mIso = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mIso) return mIso[1] + mIso[2] + mIso[3];

  const br = String(dataBR || '').trim();
  const mBr = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (mBr) return mBr[3] + mBr[2] + mBr[1];

  return '';
}

function resolverBaseCalendarioAgenda_(baseUrlCalendario) {
  const raw = String(baseUrlCalendario || '').trim();
  if (!raw) return '';
  const limpo = raw.replace(/\/+$/, '');
  if (limpo.indexOf('http://') === 0 || limpo.indexOf('https://') === 0) return limpo;
  return '';
}

function mapearLinksEndereco_(sheetEnderecos) {
  const mapa = {};
  if (!sheetEnderecos) return mapa;
  const dados = sheetEnderecos.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    const nome = String(dados[i][1] || '').trim();
    const link = String(dados[i][3] || '').trim();
    if (!nome) continue;
    mapa[nome.toLowerCase()] = link;
  }
  return mapa;
}

function parseDataEventoSheet_(valor) {
  if (!valor) return null;
  if (Object.prototype.toString.call(valor) === '[object Date]' && !isNaN(valor.getTime())) {
    const d = new Date(valor);
    d.setHours(12, 0, 0, 0);
    return d;
  }
  const str = String(valor).trim();
  if (!str) return null;

  const br = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    const d = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), 12, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  const iso = parseISODateOnly_(str);
  if (iso) return iso;

  const generic = new Date(str);
  if (isNaN(generic.getTime())) return null;
  generic.setHours(12, 0, 0, 0);
  return generic;
}

function parseISODateOnly_(iso) {
  const str = String(iso || '').trim();
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  if (isNaN(d.getTime())) return null;
  return d;
}

function formatDateISO_(date) {
  if (!date) return '';
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatDateBR_(date) {
  if (!date) return '';
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd/MM/yyyy');
}

function formatarHoraAgenda_(hora) {
  if (!hora) return '';
  if (Object.prototype.toString.call(hora) === '[object Date]' && !isNaN(hora.getTime())) {
    return Utilities.formatDate(hora, Session.getScriptTimeZone(), 'HH:mm');
  }
  const str = String(hora).trim();
  const hhmm = str.match(/^(\d{1,2}):(\d{2})/);
  if (hhmm) {
    return String(Number(hhmm[1])).padStart(2, '0') + ':' + hhmm[2];
  }
  return str;
}

function formatarDuracaoAgenda_(duracao) {
  if (duracao === null || typeof duracao === 'undefined' || duracao === '') return '';
  const n = Number(duracao);
  if (!isNaN(n) && n > 0) {
    const h = Math.floor(n / 60);
    const m = n % 60;
    if (m === 0) return h + 'h';
    return h + 'h' + String(m).padStart(2, '0');
  }
  return String(duracao).trim();
}

function calcularHoraFimAgenda_(horaInicio, duracaoRaw) {
  if (!horaInicio) return '';
  const base = horaInicio.match(/^(\d{2}):(\d{2})$/);
  if (!base) return '';

  const h = Number(base[1]);
  const m = Number(base[2]);
  let duracaoMin = 0;

  const n = Number(duracaoRaw);
  if (!isNaN(n) && n > 0) {
    duracaoMin = n;
  } else {
    const str = String(duracaoRaw || '').trim().toLowerCase();
    const hm = str.match(/^(\d+)\s*h(?:\s*(\d{1,2}))?$/);
    if (hm) {
      duracaoMin = (Number(hm[1]) * 60) + Number(hm[2] || 0);
    } else {
      const colon = str.match(/^(\d{1,2}):(\d{2})$/);
      if (colon) duracaoMin = Number(colon[1]) * 60 + Number(colon[2]);
    }
  }

  if (duracaoMin <= 0) return '';
  const total = h * 60 + m + duracaoMin;
  const fimH = Math.floor(total / 60) % 24;
  const fimM = total % 60;
  return String(fimH).padStart(2, '0') + ':' + String(fimM).padStart(2, '0');
}

function obterDiaSemanaDeISO_(iso) {
  const d = parseISODateOnly_(iso);
  if (!d) return '';
  return getDiaSemana(d);
}
