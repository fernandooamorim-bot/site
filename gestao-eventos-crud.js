/**
 * =====================================================
 * ACL APLICADO — AUTENTICAÇÃO VIA EMAIL (FRONTEND OAUTH)
 * Todas as funções sensíveis exigem:
 *   const user = requireUserByEmail(email)
 *   requirePermission(user, 'acao')
 * =====================================================
 */
// Função para aplicar permissões de comissão conforme perfil do usuário
function aplicarPermissoesComissao(perfilUsuario) {
  const selectTipo = document.getElementById('comissaoTipo');
  const campoValor = document.getElementById('comissaoValorContainer');

  if (!selectTipo) return;

  // Limpa opções
  selectTipo.innerHTML = '';

  if (perfilUsuario === 'Proprietário') {
    // Todas as opções
    selectTipo.innerHTML += '<option value="Padrão">Padrão</option>';
    selectTipo.innerHTML += '<option value="Percentual">Percentual</option>';
    selectTipo.innerHTML += '<option value="Fixo">Fixo</option>';
    selectTipo.innerHTML += '<option value="Sem Comissão">Sem Comissão</option>';
    if (campoValor) campoValor.style.display = 'block';
  } else if (perfilUsuario === 'Sócio') {
    // Apenas padrão e sem comissão
    selectTipo.innerHTML += '<option value="Padrão">Padrão</option>';
    selectTipo.innerHTML += '<option value="Sem Comissão">Sem Comissão</option>';
    if (campoValor) campoValor.style.display = 'none';
  } else {
    // Músicos não veem comissão
    selectTipo.style.display = 'none';
    if (campoValor) campoValor.style.display = 'none';
  }
}
// TESTE: Busca eventos por data em formato texto DD/MM/AAAA
function buscarEventosPorDataTexto(dataTexto) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('EVENTOS');
  const dados = sheet.getDataRange().getValues();

  const eventos = [];

  for (let i = 1; i < dados.length; i++) {
    const dataEvento = String(dados[i][2]).trim(); // COLUNA DATA_EVENTO (texto)

    if (dataEvento === dataTexto) {
      eventos.push({
        id: dados[i][0],
        tipoRegistro: dados[i][1],
        tipoEvento: dados[i][6],
        observacoes: dados[i][37]
      });
    }
  }

  return eventos;
}
/**
 * ========================================
 * GESTÃO DE EVENTOS
 * ========================================
 */

/**
 * Cria novo evento
 * @param {Object} dados - Dados do evento
 * @param {string} email - Email do usuário autenticado
 * @returns {Object} Resultado da operação
 */

function normalizarTemNF(valor) {
  return (
    valor === true ||
    valor === 'TRUE' ||
    valor === 'true' ||
    valor === 'on' ||
    valor === 1 ||
    valor === '1'
  );
}

function criarEvento(dados, email) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('EVENTOS');
    const user = requireUserByEmail(email);
    requirePermission(user, 'registrar_evento');
    const usuario = user.email;
    const usuarioFinal = usuario || email || 'SYSTEM';

    const tipoRegistro = dados.tipoRegistro || 'Evento';
    const isEvento = tipoRegistro === 'Evento';
    const isReuniao = tipoRegistro === 'Reunião';
    const isBloqueio = tipoRegistro === 'Bloqueio';

    const idEvento = gerarIDEvento();

    // Datas sempre como TEXTO
    const dataEventoTexto = dados.dataEvento
      ? formatarDataTexto(dados.dataEvento)
      : null;

    const dataFimTexto = dados.dataFim
      ? formatarDataTexto(dados.dataFim)
      : null;

    // Hora
   // Hora (STRING "HH:mm")
const horaInicio = dados.horaInicio
  ? String(dados.horaInicio).trim()
  : '';

    // Duração
    let duracaoNumero = 0;
    if (dados.duracao) {
      if (typeof dados.duracao === 'number') {
        duracaoNumero = dados.duracao;
      } else {
        const match = dados.duracao.match(/(\d+)/);
        if (match) {
          const valor = Number(match[1]);
          duracaoNumero = dados.duracao.toLowerCase().includes('h')
            ? valor * 60
            : valor;
        }
      }
    }

    // ===== RESOLUÇÃO DE NOMES (IGUAL AO WEBAPP, PORÉM CENTRALIZADO) =====
    const nomeContratante = dados.idContratante
  ? buscarNomePorId('CONTRATANTES', dados.idContratante)
  : '';

    const nomeCerimonialista = isEvento
      ? buscarNomePorId('CERIMONIALISTAS', dados.idCerimonialista)
      : '';

    const nomeVendedor = isEvento
      ? buscarNomePorId('VENDEDORES', dados.idVendedor)
      : '';

    const nomeLocal = dados.idEndereco
      ? buscarNomePorId('ENDERECOS', dados.idEndereco)
      : isBloqueio ? 'N/A' : '';

    const nomeBV = isEvento
      ? buscarNomePorId('PARCEIROS_BV', dados.idBV)
      : '';

    // =====================================================
    // NORMALIZAÇÃO DE VALORES (evita variáveis indefinidas)
    // =====================================================
    const valorTotal = isEvento ? Number(dados.valorTotal || 0) : 0;
    const valorBV = isEvento ? Number(dados.valorBV || 0) : 0;
    const temNF = isEvento ? normalizarTemNF(dados.temNF) : false;

    const comissaoTipo = isEvento ? (dados.comissaoTipo || 'Padrão') : 'N/A';
    let comissaoValor = isEvento ? dados.comissaoValor : '';

    if (isEvento && comissaoTipo === 'Padrão') {
      comissaoValor = Number(obterConfig('COMISSAO_PADRAO_PERCENTUAL')) || 0;
    }

    // =====================================================
    // FINANCEIRO CENTRALIZADO
    // =====================================================
    const financeiro = isEvento
      ? calcularFinanceiroEvento({
          valorTotal,
          temNF,
          valorBV,
          comissaoTipo,
          comissaoValor,
          percentualNF: temNF ? Number(obterConfig('NF_PERCENTUAL')) : 0
        })
      : null;

    // Observações unificadas
    const observacoes =
      dados.observacoes ||
      dados.motivo ||
      '';

    const novaLinha = [
      idEvento,                          // 1 ID_EVENTO
      tipoRegistro,                      // 2 TIPO_REGISTRO
      dataEventoTexto,                   // 3 DATA_EVENTO
      dataFimTexto,                      // 4 DATA_FIM
      horaInicio,                    // 5 HORA_INICIO
      duracaoNumero,                     // 6 DURACAO
      isEvento ? dados.tipoEvento || '' : tipoRegistro.toUpperCase(), // 7
      dados.projeto || '',               // 8
      dados.idContratante || '',         // 9
      nomeContratante,                   // 10 NOME_CONTRATANTE
      dados.idCerimonialista || '',      // 11
      nomeCerimonialista,                // 12 NOME_CERIMONIALISTA
      dados.idEndereco || '',            // 13
      nomeLocal,                         // 14 LOCAL
      valorTotal,                        // 15 VALOR_TOTAL
      0,                                 // 16 VALOR_RECEBIDO
      valorTotal, // 17 VALOR_PENDENTE (no cadastro é sempre o valor cheio)
      isEvento ? 'PENDENTE' : 'N/A', // 18
      dados.idVendedor || '',            // 19
      nomeVendedor,                      // 20 NOME_VENDEDOR
      isEvento ? dados.comissaoTipo || 'Padrão' : 'N/A', // 21
      comissaoValor,                     // COMISSAO_VALOR// 22
      financeiro ? financeiro.valorComissaoCalculado : 0, // 23
      0,                                                  // 24 VALOR_COMISSAO_PAGO
      financeiro ? financeiro.statusComissao : 'N/A',     // 25
      dados.idBV || '',                  // 26
      nomeBV,                            // 27 NOME_BV
      valorBV,                           // 28 VALOR_BV
      financeiro ? financeiro.statusBV : 'N/A', // 29
      '',                                // 30 BV_DATA_PAGAMENTO
      temNF, // 31 TEM_NF
      financeiro ? financeiro.valorNF : 0,        // 32
      financeiro ? financeiro.statusNF : 'N/A',   // 33
      0,                                 // 34
      '',                                // 35
      dados.look || '',                  // 36
      dados.somResponsavel || '',        // 37
      observacoes,                       // 38
      'ATIVO',                           // 39 STATUS_GERAL
      new Date(),                        // 40 DATA_CRIACAO
      usuarioFinal,                           // 41 CRIADO_POR
      new Date(),                        // 42 ULTIMA_EDICAO
      usuarioFinal                       // 43 EDITADO_POR
    ];

    sheet.appendRow(novaLinha);

    // 🔐 GARANTE MOVIMENTAÇÕES FINANCEIRAS DE NF E BV (IDEMPOTENTE)
    garantirMovimentacoesNF_BV(
  {
    idEvento: idEvento,
    tipoEvento: isEvento ? (dados.tipoEvento || '') : tipoRegistro,
    nomeContratante: nomeContratante,
    temNF: temNF,
    valorNF: financeiro ? financeiro.valorNF : 0,
    valorBV: valorBV,
    idBV: dados.idBV || '',
    nomeBV: nomeBV
  },
  email
);

    const linha = sheet.getLastRow();
    sheet.getRange(linha, 3).setNumberFormat('@STRING@');
    sheet.getRange(linha, 4).setNumberFormat('@STRING@');

    registrarLog('CRIAR', 'EVENTOS', idEvento, tipoRegistro);

    return {
      sucesso: true,
      idEvento,
      mensagem: tipoRegistro + ' criado com sucesso!'
    };

  } catch (erro) {
    Logger.log(erro);
    return {
      sucesso: false,
      mensagem: erro.message
    };
  }
}
function buscarNomePorId(nomeAba, id) {
  if (!id) return '';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(nomeAba);
  if (!sheet) return '';

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      return String(data[i][1] || '');
    }
  }
  return '';
}

/**
 * Registra BV de parceiro
 */
function registrarBV(idEvento, idParceiro, tipoBV, valorBV, valorContrato, email) {
  const user = requireUserByEmail(email);
  requirePermission(user, 'registrar_bv');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  
  const nomeParceiro = buscarParceiroBV(idParceiro)?.nome || '';
  const valorCalculado = tipoBV === 'Percentual' ? (valorContrato * valorBV) : valorBV;
  
  const idMov = gerarIDMovimentacao();
  const nomeEvento = buscarEvento(idEvento)?.nome || '';
  
  const movimento = [
    idMov,
    'BV_GERADO',
    'SAÍDA',
    idEvento,
    nomeEvento,
    new Date(),
    valorCalculado,
    '',
    nomeParceiro,
    idParceiro,
    '',
    `BV ${tipoBV}: ${tipoBV === 'Percentual' ? (valorBV * 100) + '%' : formatarMoeda(valorBV)}`,
    'SYSTEM',
    new Date(),
    '',
    'PENDENTE'
  ];
  
  const proximaLinha = sheet.getLastRow() + 1;
  sheet.getRange(proximaLinha, 1, 1, movimento.length).setValues([movimento]);
}

/**
 * Busca cerimonialista por ID
 */
function buscarCerimonialista(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('CERIMONIALISTAS');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      return { id: data[i][0], nome: data[i][1] };
    }
  }
  return null;
}

/**
 * Busca endereço por ID
 */
function buscarEndereco(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('ENDERECOS');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      return { id: data[i][0], nome: data[i][1], endereco: data[i][2] };
    }
  }
  return null;
}

/**
 * Busca parceiro BV por ID
 */
function buscarParceiroBV(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('PARCEIROS_BV');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      return { id: data[i][0], nome: data[i][1] };
    }
  }
  return null;
}

/**
 * Edita evento existente
 */
function editarEvento(idEvento, dadosAtualizados, email) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('EVENTOS');
    const data = sheet.getDataRange().getValues();
    const user = requireUserByEmail(email);
    requirePermission(user, 'editar_evento');
    const usuario = user.email;
    
    // Encontra linha do evento
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === idEvento) {
        // Atualiza campos modificados
        Object.keys(dadosAtualizados).forEach(campo => {
          // Mapeia campo para coluna (implementar conforme necessidade)
          // Exemplo: se campo === 'observacoes', atualiza coluna 25
        });
        
        // Atualiza timestamp de edição
        sheet.getRange(i + 1, 28).setValue(new Date());
        sheet.getRange(i + 1, 29).setValue(usuario);
        
        registrarLog('EDITAR', 'EVENTOS', idEvento, JSON.stringify(dadosAtualizados));
        
        return { sucesso: true, mensagem: 'Evento atualizado!' };
      }
    }
    
    return { sucesso: false, mensagem: 'Evento não encontrado' };
    
  } catch (error) {
    return { sucesso: false, mensagem: error.message };
  }
}


/**
 * Lista eventos com filtros - VERSÃO COM DEBUG
 */
/**
 * ========================================
 * FUNÇÃO LISTARVENTOS() - VERSÃO COMPLETA
 * ========================================
 * 
 * MODIFICAÇÕES:
 * - Remove filtro que excluía Bloqueios e Reuniões
 * - Adiciona campo dataFim
 * - Adiciona campo horaFim calculado
 * - Detecta eventos dentro de intervalos
 * - Retorna TODOS os tipos de registro
 */

/**
 * Lista eventos com todos os tipos de registro
 * @param {Object} filtros - Filtros opcionais
 * @returns {Array} Array de eventos
 */
function listarEventos(filtros = {}) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('EVENTOS');
    
    if (!sheet) {
      Logger.log('ERRO: Aba EVENTOS não encontrada');
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    Logger.log('Total de linhas na aba EVENTOS: ' + data.length);
    
    const eventos = [];
    
    // Começa da linha 2 (pula o cabeçalho)
    for (let i = 1; i < data.length; i++) {
      // Pula linhas vazias
      if (!data[i][0]) {
        Logger.log('Linha ' + (i+1) + ' está vazia, pulando...');
        continue;
      }
      
      // ========================================
      // CONVERSÃO DE DATA_EVENTO PARA STRING
      // ========================================
      let dataEvento = data[i][COL.DATA_EVENTO];
      if (dataEvento instanceof Date) {
        const dia = String(dataEvento.getDate()).padStart(2, '0');
        const mes = String(dataEvento.getMonth() + 1).padStart(2, '0');
        const ano = dataEvento.getFullYear();
        dataEvento = `${dia}/${mes}/${ano}`;
      } else if (dataEvento) {
        dataEvento = String(dataEvento);
      }
      
      // ========================================
      // CONVERSÃO DE DATA_FIM PARA STRING
      // ========================================
      let dataFim = data[i][COL.DATA_FIM];
      if (dataFim instanceof Date) {
        const dia = String(dataFim.getDate()).padStart(2, '0');
        const mes = String(dataFim.getMonth() + 1).padStart(2, '0');
        const ano = dataFim.getFullYear();
        dataFim = `${dia}/${mes}/${ano}`;
      } else if (dataFim) {
        dataFim = String(dataFim);
      } else {
        dataFim = null;
      }
      
      // ========================================
      // CONVERSÃO DE HORA_INICIO PARA STRING
      // ========================================
      let horaInicio = data[i][COL.HORA_INICIO];
      if (horaInicio instanceof Date) {
        const h = String(horaInicio.getHours()).padStart(2, '0');
        const m = String(horaInicio.getMinutes()).padStart(2, '0');
        horaInicio = `${h}:${m}`;
      } else if (horaInicio) {
        horaInicio = String(horaInicio);
      }
      
      // ========================================
      // CÁLCULO DA HORA_FIM
      // ========================================
      let horaFim = null;
      const duracao = data[i][COL.DURACAO];
      if (horaInicio && duracao) {
        horaFim = calcularHoraFim(horaInicio, duracao);
      }
      
      // ========================================
      // FORMATAÇÃO DA DURAÇÃO
      // ========================================
      let duracaoFormatada = null;
      if (duracao) {
        if (typeof duracao === 'number') {
          // Duracao em minutos
          const horas = Math.floor(duracao / 60);
          const minutos = duracao % 60;
          if (minutos > 0) {
            duracaoFormatada = `${horas}h${minutos}`;
          } else {
            duracaoFormatada = `${horas}h`;
          }
        } else {
          duracaoFormatada = String(duracao);
        }
      }
      
      // ========================================
      // MONTA OBJETO DO EVENTO
      // ========================================
      const evento = {
        id: data[i][COL.ID_EVENTO],
        tipo: data[i][COL.TIPO_REGISTRO],      // "Evento", "Bloqueio", "Reunião"
        data: dataEvento,                       // "30/01/2026"
        dataFim: dataFim,                       // "05/02/2026" ou null
        hora: horaInicio,                       // "19:00"
        horaFim: horaFim,                       // "21:00"
        duracao: duracaoFormatada,              // "2h" ou "2h30"
        tipoEvento: data[i][COL.TIPO_EVENTO],   // "Casamento", "BLOQUEIO", "REUNIÃO"
        projeto: data[i][COL.PROJETO],          // "Banda Completa"
        contratante: data[i][COL.NOME_CONTRATANTE], // "Fernando Amorim"
        local: data[i][COL.LOCAL],              // "PALLATIUM"
        valor: data[i][COL.VALOR_TOTAL],        // 20000
        status: data[i][COL.STATUS_RECEBIMENTO], // "Pendente"
        observacoes: data[i][COL.OBSERVACOES]   // Observações do evento
      };
      
      Logger.log('Evento encontrado: ' + evento.id + ' - ' + evento.tipoEvento + ' ' + evento.contratante);
      
      // ========================================
      // APLICA FILTROS (SE HOUVER)
      // ========================================
      let incluir = true;
      
      if (filtros.mes && evento.data) {
        const mesEvento = new Date(evento.data).getMonth() + 1;
        if (mesEvento !== filtros.mes) incluir = false;
      }
      
      if (filtros.tipo && evento.tipo !== filtros.tipo) {
        incluir = false;
      }
      
      // ========================================
      // IMPORTANTE: NÃO FILTRA POR TIPO AQUI!
      // O filtro por perfil será feito no frontend
      // ========================================
      
      if (incluir) {
        eventos.push(evento);
      }
    }
    
    Logger.log('Total de eventos retornados: ' + eventos.length);
    
    // ========================================
    // DETECTA EVENTOS DENTRO DE INTERVALOS
    // ========================================
    const eventosComRelacoes = detectarEventosDentroDeIntervalos(eventos);

    // Auditoria automática
  const auditoria = auditarOrdemCronologica(eventosComRelacoes);
    
    if (!auditoria.passou) {
      Logger.log('⚠️ ATENÇÃO: Auditoria identificou problemas!');
      Logger.log('Eventos com problemas: ' + auditoria.erros.length);
    }
    
  
    return eventosComRelacoes;
    
  } catch (error) {
    Logger.log('ERRO em listarEventos: ' + error.message);
    Logger.log('Stack: ' + error.stack);
    throw error;
  }
}

/**
 * Calcula hora de fim baseado em hora início e duração
 * @param {string} horaInicio - Hora no formato "HH:MM"
 * @param {number|string} duracao - Duração em minutos ou formato "2h" ou "2h30"
 * @returns {string} Hora fim no formato "HH:MM"
 */
function calcularHoraFim(horaInicio, duracao) {
  try {
    // Parse hora início
    const [h, m] = horaInicio.split(':').map(Number);
    
    // Parse duração
    let minutosDuracao = 0;
    if (typeof duracao === 'number') {
      minutosDuracao = duracao;
    } else if (typeof duracao === 'string') {
      if (duracao.includes('h')) {
        // Formato "2h" ou "2h30"
        const partes = duracao.replace('h', ':').split(':');
        const horas = parseInt(partes[0]) || 0;
        const mins = parseInt(partes[1]) || 0;
        minutosDuracao = (horas * 60) + mins;
      } else {
        // Apenas número
        minutosDuracao = parseInt(duracao) || 0;
      }
    }
    
    // Calcula hora fim
    const totalMinutos = (h * 60) + m + minutosDuracao;
    const horaFim = Math.floor(totalMinutos / 60) % 24;
    const minutoFim = totalMinutos % 60;
    
    return `${String(horaFim).padStart(2, '0')}:${String(minutoFim).padStart(2, '0')}`;
  } catch (e) {
    Logger.log('Erro ao calcular hora fim: ' + e.message);
    return null;
  }
}

/**
 * Detecta eventos que estão dentro de intervalos (eventos com dataFim)
 * @param {Array} eventos - Array de eventos
 * @returns {Array} Array de eventos com relações
 */
function detectarEventosDentroDeIntervalos(eventos) {
  try {
    // Eventos com intervalo (dataFim preenchida)
    const eventosComIntervalo = eventos.filter(e => e.dataFim !== null);

    // Eventos pontuais (sem dataFim)
    const eventosPontuais = eventos.filter(e => e.dataFim === null);

    eventosComIntervalo.forEach(intervalo => {
      const dataInicio = parseDataBR(intervalo.data);
      const dataFim = parseDataBR(intervalo.dataFim);

      // Hora inicial do intervalo (se não existir, assume 00:00)
      const horaInicioIntervalo = intervalo.hora ? intervalo.hora : '00:00';

      const eventosDentro = eventosPontuais.filter(evt => {
        const dataEvt = parseDataBR(evt.data);
        if (!dataEvt || dataEvt < dataInicio || dataEvt > dataFim) return false;

        // Se for o mesmo dia do início do intervalo, valida horário
        if (evt.data === intervalo.data && evt.hora && evt.hora < horaInicioIntervalo) {
          return false;
        }

        return true;
      });

      if (eventosDentro.length > 0) {
        eventosDentro.sort((a, b) => {
          const dA = parseDataBR(a.data);
          const dB = parseDataBR(b.data);
          if (dA.getTime() === dB.getTime()) {
            return (a.hora || '').localeCompare(b.hora || '');
          }
          return dA - dB;
        });

        intervalo.eventosDentro = eventosDentro;
        intervalo.inicioIntervalo = horaInicioIntervalo;
      }
    });

    // Mantém TODOS os eventos na lista principal
    const eventosFinais = [...eventos];

    // Ordenação final: data → hora
    eventosFinais.sort((a, b) => {
      const dataA = parseDataBR(a.data);
      const dataB = parseDataBR(b.data);

      if (dataA.getTime() === dataB.getTime()) {
        return (a.hora || '').localeCompare(b.hora || '');
      }
      return dataA - dataB;
    });

    return eventosFinais;

  } catch (e) {
    Logger.log('Erro ao detectar eventos em intervalos: ' + e.message);
    return eventos;
  }
}
/**
 * Auditoria de ordem cronológica
 * Verifica se eventos estão ordenados corretamente
 */
function auditarOrdemCronologica(eventos) {
  Logger.log('='.repeat(60));
  Logger.log('AUDITORIA: Verificando ordem cronológica');
  Logger.log('='.repeat(60));
  
  const erros = [];
  let datasInvalidas = 0;
  let foraDeOrdem = 0;
  
  // Verifica cada evento
  for (let i = 0; i < eventos.length; i++) {
    const evt = eventos[i];
    
    // Valida data
    const data = parseDataBR(evt.data);
    if (!data) {
      erros.push(`Evento ${evt.id}: data inválida "${evt.data}"`);
      datasInvalidas++;
      continue;
    }
    
    // Compara com anterior
    if (i > 0) {
      const anterior = parseDataBR(eventos[i-1].data);
      
      if (anterior && data < anterior) {
        erros.push(
          `Eventos fora de ordem: ` +
          `${eventos[i-1].id} (${eventos[i-1].data}) está ANTES de ` +
          `${evt.id} (${evt.data}) mas é cronologicamente DEPOIS`
        );
        foraDeOrdem++;
      }
    }
  }
  
  // Relatório
  Logger.log('');
  Logger.log('RESULTADOS DA AUDITORIA:');
  Logger.log('Total de eventos: ' + eventos.length);
  Logger.log('Datas inválidas: ' + datasInvalidas);
  Logger.log('Fora de ordem: ' + foraDeOrdem);
  Logger.log('');
  
  if (erros.length > 0) {
    Logger.log('⚠️ PROBLEMAS ENCONTRADOS:');
    erros.forEach(erro => Logger.log('  - ' + erro));
    Logger.log('');
    Logger.log('❌ AUDITORIA FALHOU');
  } else {
    Logger.log('✅ AUDITORIA PASSOU - Tudo em ordem!');
  }
  
  Logger.log('='.repeat(60));
  
  return {
    passou: erros.length === 0,
    erros: erros,
    stats: {
      total: eventos.length,
      datasInvalidas: datasInvalidas,
      foraDeOrdem: foraDeOrdem
    }
  };
}
/**
 * Converte string DD/MM/YYYY para Date
 * @param {string} dataStr - Data no formato DD/MM/YYYY
 * @returns {Date} Objeto Date
 */
/**
 * Parse robusto de data DD/MM/YYYY (Backend)
 */
function parseDataBR(dataStr) {
  if (!dataStr) {
    Logger.log('⚠️ parseDataBR: data vazia');
    return null;
  }
  
  try {
    // Converte para string
    const str = String(dataStr).trim();
    
    // Valida formato DD/MM/YYYY
    const regex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const match = str.match(regex);
    
    if (!match) {
      Logger.log('Formato inválido (esperado DD/MM/YYYY): ' + str);
      return null;
    }
    
    const dia = parseInt(match[1], 10);
    const mes = parseInt(match[2], 10) - 1; // 0-based
    const ano = parseInt(match[3], 10);
    
    // Validações básicas
    if (ano < 1900 || ano > 2100) {
      Logger.log('Ano inválido: ' + ano);
      return null;
    }
    
    if (mes < 0 || mes > 11) {
      Logger.log('Mês inválido: ' + (mes + 1));
      return null;
    }
    
    if (dia < 1 || dia > 31) {
      Logger.log('Dia inválido: ' + dia);
      return null;
    }
    
    // Cria data
    const data = new Date(ano, mes, dia, 12, 0, 0, 0);
    
    // Valida se data é válida
    if (isNaN(data.getTime())) {
      Logger.log('Data inválida: ' + str);
      return null;
    }
    
    // Valida se componentes batem (31/02 vira 03/03)
    if (data.getDate() !== dia || 
        data.getMonth() !== mes || 
        data.getFullYear() !== ano) {
      Logger.log('Data inexistente (ex: 31/02): ' + str);
      return null;
    }
    
    return data;
    
  } catch (e) {
    Logger.log('Erro ao fazer parse de data: ' + e.message + ' - ' + dataStr);
    return null;
  }
}

/**
 * ========================================
 * FUNÇÃO DE TESTE
 * ========================================
 */
function testarListarEventosCompleto() {
  Logger.log('='.repeat(60));
  Logger.log('TESTE: listarEventos() - Versão Completa');
  Logger.log('='.repeat(60));
  
  const eventos = listarEventos();
  
  Logger.log('\nTotal de eventos retornados: ' + eventos.length);
  
  // Mostra eventos com intervalo
  const comIntervalo = eventos.filter(e => e.dataFim !== null);
  Logger.log('\nEventos com intervalo (dataFim): ' + comIntervalo.length);
  comIntervalo.forEach(evt => {
    Logger.log(`  ${evt.id}: ${evt.data} → ${evt.dataFim}`);
    if (evt.eventosDentro && evt.eventosDentro.length > 0) {
      Logger.log(`    └─ ${evt.eventosDentro.length} eventos dentro:`);
      evt.eventosDentro.forEach(dentro => {
        Logger.log(`       - ${dentro.id}: ${dentro.data} ${dentro.hora}`);
      });
    }
  });
  
  // Mostra eventos pontuais
  const pontuais = eventos.filter(e => e.dataFim === null);
  Logger.log('\nEventos pontuais (sem dataFim): ' + pontuais.length);
  pontuais.slice(0, 5).forEach(evt => {
    Logger.log(`  ${evt.id}: ${evt.data} ${evt.hora} - ${evt.tipoEvento}`);
  });
  
  Logger.log('\n' + '='.repeat(60));
}

/**
 * FUNÇÃO DE TESTE - Execute esta para ver se os eventos estão sendo listados
 */
function testarListarEventos() {
  const eventos = listarEventos();
  
  Logger.log('='.repeat(60));
  Logger.log('TESTE: listarEventos()');
  Logger.log('='.repeat(60));
  
  if (eventos.length === 0) {
    Logger.log('❌ NENHUM EVENTO ENCONTRADO!');
    Logger.log('Verifique se você cadastrou eventos na aba EVENTOS');
  } else {
    Logger.log('✅ ' + eventos.length + ' evento(s) encontrado(s):');
    eventos.forEach((e, index) => {
      Logger.log(`${index + 1}. ${e.id} - ${e.tipoEvento} ${e.contratante} - ${e.data}`);
    });
  }
  
  Logger.log('='.repeat(60));
}
/**
 * =====================================================
 * FUNÇÕES CONFIG - Buscar valores da aba CONFIG
 * =====================================================
 */

/**
 * Obtém um valor de configuração da aba CONFIG
 * @param {string} chave - Chave da configuração
 * @returns {string|null} - Valor da configuração ou null
 */
function obterConfig(chave) {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName('CONFIG');
    
    if (!sheet) {
      Logger.log('⚠️ Aba CONFIG não encontrada');
      return null;
    }
    
    const dados = sheet.getDataRange().getValues();
    
    // Procura a chave (coluna A)
    for (let i = 1; i < dados.length; i++) {
      if (dados[i][0] === chave) {
        return dados[i][1]; // Retorna valor (coluna B)
      }
    }
    
    Logger.log('⚠️ Chave não encontrada na CONFIG: ' + chave);
    return null;
    
  } catch (error) {
    Logger.log('ERRO em obterConfig: ' + error.message);
    return null;
  }
}

/**
 * Lista as durações padrão da CONFIG
 * @returns {Array<string>} - Array de durações (ex: ['1h', '2h', '3h'])
 */
function listarDuracoesPadrao() {
  try {
    const valor = obterConfig('DURACOES_PADRAO');
    
    if (!valor) {
      Logger.log('⚠️ DURACOES_PADRAO não configurado, usando padrão');
      return ['2h']; // Padrão se não configurado
    }
    
    // Split por ponto e vírgula
    const duracoes = valor.split(';').map(d => d.trim()).filter(d => d);
    
    Logger.log('✅ Durações carregadas: ' + duracoes.join(', '));
    return duracoes;
    
  } catch (error) {
    Logger.log('ERRO em listarDuracoesPadrao: ' + error.message);
    return ['2h'];
  }
}

/**
 * Lista os projetos/formações sugeridos da CONFIG
 * @returns {Array<string>} - Array de projetos
 */
function listarProjetosSugeridos() {
  try {
    const valor = obterConfig('PROJETOS_SUGERIDOS');
    
    if (!valor) {
      Logger.log('⚠️ PROJETOS_SUGERIDOS não configurado, usando padrão');
      return ['Banda Completa', 'Banda Reduzida'];
    }
    
    // Split por ponto e vírgula
    const projetos = valor.split(';').map(p => p.trim()).filter(p => p);
    
    Logger.log('✅ Projetos carregados: ' + projetos.join(', '));
    return projetos;
    
  } catch (error) {
    Logger.log('ERRO em listarProjetosSugeridos: ' + error.message);
    return ['Banda Completa'];
  }
}

/**
 * Obtém o percentual de NF da CONFIG
 * @returns {number} - Percentual de NF (ex: 6.3)
 */
function obterPercentualNF() {
  try {
    const valor = obterConfig('NF_PERCENTUAL');
    
    if (!valor) {
      Logger.log('⚠️ NF_PERCENTUAL não configurado, usando padrão 6.3%');
      return 6.3;
    }
    
    const percentual = parseFloat(valor);
    
    if (isNaN(percentual)) {
      Logger.log('⚠️ NF_PERCENTUAL inválido, usando padrão 6.3%');
      return 6.3;
    }
    
    Logger.log('✅ Percentual NF carregado: ' + percentual + '%');
    return percentual;
    
  } catch (error) {
    Logger.log('ERRO em obterPercentualNF: ' + error.message);
    return 6.3;
  }
}

/**
 * FUNÇÃO DE TESTE - Testa as funções CONFIG
 */
function testarFuncoesConfig() {
  Logger.log('='.repeat(60));
  Logger.log('TESTE: Funções CONFIG');
  Logger.log('='.repeat(60));
  
  Logger.log('\n1. Durações Padrão:');
  const duracoes = listarDuracoesPadrao();
  duracoes.forEach(d => Logger.log('   - ' + d));
  
  Logger.log('\n2. Projetos Sugeridos:');
  const projetos = listarProjetosSugeridos();
  projetos.forEach(p => Logger.log('   - ' + p));
  
  Logger.log('\n3. Percentual NF:');
  const percentual = obterPercentualNF();
  Logger.log('   - ' + percentual + '%');
  
  Logger.log('\n' + '='.repeat(60));
}

/**
 * Lista os tipos de evento da CONFIG
 * @returns {Array<string>} - Array de tipos de evento
 */
function listarTiposEvento() {
  try {
    const valor = obterConfig('TIPOS_EVENTO');
    
    if (!valor) {
      Logger.log('⚠️ TIPOS_EVENTO não configurado, usando padrão');
      return ['Casamento', 'Aniversário', 'Formatura', 'Corporativo', 'Festa', 'Outro'];
    }
    
    // Split por ponto e vírgula
    const tipos = valor.split(';').map(t => t.trim()).filter(t => t);
    
    Logger.log('✅ Tipos de evento carregados: ' + tipos.join(', '));
    return tipos;
    
  } catch (error) {
    Logger.log('ERRO em listarTiposEvento: ' + error.message);
    return ['Casamento', 'Aniversário', 'Formatura', 'Corporativo', 'Festa', 'Outro'];
  }
}

/**
 * =====================================================
 * BUSCAR EVENTOS POR DATA (para verificação de conflitos)
 * =====================================================
 */

/**
 * Busca todos os eventos de uma data específica
 * Usado para verificar conflitos de agenda
 * @param {string} data - Data no formato YYYY-MM-DD
 * @returns {Array} - Array de eventos naquela data
 */
function buscarEventosPorData(dataBusca) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('EVENTOS');
    if (!sheet) return [];

    const dados = sheet.getDataRange().getValues();
    const eventos = [];

    const dataBuscaDate = normalizarData(dataBusca);
    if (!dataBuscaDate) return [];

    for (let i = 1; i < dados.length; i++) {
      if (!dados[i][0]) continue;

      const dataEventoDate = normalizarData(dados[i][2]);
      const dataFimDate = normalizarData(dados[i][3]);

      let incluir = false;

      if (dataEventoDate) {
        if (dataFimDate) {
          if (dataBuscaDate >= dataEventoDate && dataBuscaDate <= dataFimDate) {
            incluir = true;
          }
        } else {
          if (dataBuscaDate.getTime() === dataEventoDate.getTime()) {
            incluir = true;
          }
        }
      }

      if (incluir) {
        let horaStr = '';
        if (dados[i][4] instanceof Date) {
          horaStr = Utilities.formatDate(dados[i][4], 'GMT-3', 'HH:mm');
        }

        eventos.push({
          id: String(dados[i][0]),
          tipoRegistro: String(dados[i][1] || 'Evento'),
          data: formatarDataTexto(dados[i][2]),
          dataFim: dados[i][3] ? formatarDataTexto(dados[i][3]) : null,
          hora: horaStr,
          duracao: dados[i][5] || '',
          tipoEvento: String(dados[i][6] || ''),
          nomeContratante: String(dados[i][9] || ''),
          nomeLocal: String(dados[i][13] || ''),
          observacoes: String(dados[i][37] || '')
        });
      }
    }

    eventos.sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
    return eventos;

  } catch (e) {
    Logger.log('Erro buscarEventosPorData:', e);
    return [];
  }
}

/**
 * Converte string DD/MM/YYYY para Date
 */


/**
 * Converte YYYY-MM-DD ou DD/MM/YYYY para Date no meio-dia
 * Evita bug de fuso horário (data -1)
 */
function parseDataComMeioDia(valor) {
  if (!valor) return null;

  // Se vier como Date, normaliza para meio-dia
  if (valor instanceof Date) {
    return new Date(
      valor.getFullYear(),
      valor.getMonth(),
      valor.getDate(),
      12, 0, 0
    );
  }

  // Formato YYYY-MM-DD
  if (typeof valor === 'string' && valor.includes('-')) {
    const [ano, mes, dia] = valor.split('-').map(Number);
    return new Date(ano, mes - 1, dia, 12, 0, 0);
  }

  // Formato DD/MM/YYYY
  if (typeof valor === 'string' && valor.includes('/')) {
    const [dia, mes, ano] = valor.split('/').map(Number);
    return new Date(ano, mes - 1, dia, 12, 0, 0);
  }

  return null;
}

/**
 * Converte YYYY-MM-DD ou Date para texto DD/MM/YYYY
 * Força armazenamento como TEXTO na planilha
 */
function formatarDataTexto(valor) {
  if (!valor) return null;

  // Se vier como Date, converte para texto DD/MM/YYYY
  if (valor instanceof Date) {
    const d = String(valor.getDate()).padStart(2, '0');
    const m = String(valor.getMonth() + 1).padStart(2, '0');
    const y = valor.getFullYear();
    return `${d}/${m}/${y}`;
  }

  // Se vier como YYYY-MM-DD
  if (typeof valor === 'string' && valor.includes('-')) {
    const [ano, mes, dia] = valor.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  // Se já vier como DD/MM/YYYY
  if (typeof valor === 'string' && valor.includes('/')) {
    return valor;
  }

  return null;
}



/**
 * Carrega configurações globais da planilha CONFIG
 */
function carregarConfiguracoes() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const configSheet = ss.getSheetByName('CONFIG');
    
    if (!configSheet) {
      Logger.log('Aba CONFIG não encontrada, usando padrões');
      return {
        AGENDA_FILTRO_PADRAO: 'proximos',
        AGENDA_CACHE_TIMEOUT: 300000,
        AGENDA_CORES_PERSONALIZADAS: true
      };
    }
    
    const data = configSheet.getDataRange().getValues();
    const config = {};
    
    // Le cada linha (CHAVE | VALOR)
    for (let i = 1; i < data.length; i++) {
      const chave = data[i][0];
      const valor = data[i][1];
      
      if (chave) {
        // Converte tipos
        if (valor === 'TRUE' || valor === 'true') {
          config[chave] = true;
        } else if (valor === 'FALSE' || valor === 'false') {
          config[chave] = false;
        } else if (!isNaN(valor)) {
          config[chave] = Number(valor);
        } else {
          config[chave] = valor;
        }
      }
    }
    
    Logger.log('Configurações carregadas:', JSON.stringify(config));
    return config;
    
  } catch (e) {
    Logger.log('Erro ao carregar configurações:', e.message);
    return {
      AGENDA_FILTRO_PADRAO: 'proximos',
      AGENDA_CACHE_TIMEOUT: 300000,
      AGENDA_CORES_PERSONALIZADAS: true
    };
  }
}
  


function testarMelhorias() {
  // Testa configurações
  const config = carregarConfiguracoes();
  Logger.log('Config:', config);
  
  // Testa validação
  const teste1 = parseDataBR('31/12/2026'); // Deve funcionar
  const teste2 = parseDataBR('31/02/2026'); // Deve retornar null
  Logger.log('Data válida:', teste1);
  Logger.log('Data inválida:', teste2);
  
  // Testa auditoria
  const eventos = listarEventos();
  Logger.log('Total eventos:', eventos.length);
}
/**
 * Garante a existência das movimentações financeiras de NF e BV do evento
 * REGRA CRÍTICA:
 * - Nunca cria duplicado
 * - NF_EVENTO entra como PROCESSADO
 * - BV_EVENTO entra como PENDENTE
 * - Apenas registra a existência do custo
 */
function garantirMovimentacoesNF_BV(evento, email) {
  const user = requireUserByEmail(email);
  requirePermission(user, 'registrar_nf');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  if (!sheetMov) throw new Error('Aba MOVIMENTACOES_FINANCEIRAS não encontrada');

  const dadosMov = sheetMov.getDataRange().getValues();

  const idEvento = evento.idEvento;
  const nomeEvento = `${evento.tipoEvento} - ${evento.nomeContratante}`;

  let existeNF = false;
  let existeBV = false;

  // Verifica se já existem movimentações para este evento
  for (let i = 1; i < dadosMov.length; i++) {
    if (dadosMov[i][3] !== idEvento) continue;

    if (dadosMov[i][1] === 'NF_EVENTO') existeNF = true;
    if (dadosMov[i][1] === 'BV_EVENTO') existeBV = true;
  }

  const usuario = user.email;
  const agora = new Date();

  // =========================
  // NF_EVENTO (PROCESSADO)
  // =========================
  if (evento.temNF && !existeNF) {
    const idMovNF = gerarIDMovimentacao();

    sheetMov.appendRow([
      idMovNF,                    // ID_MOVIMENTACAO
      'NF_EVENTO',                 // TIPO_MOVIMENTACAO
      'SAÍDA',                     // NATUREZA
      idEvento,                    // ID_EVENTO
      nomeEvento,                  // NOME_EVENTO
      formatarDataTexto(agora),    // DATA_MOVIMENTACAO
      Number(evento.valorNF || 0), // VALOR
      '',                          // FORMA_PAGAMENTO
      'Receita Federal',           // CONTRAPARTE
      '',                          // ID_CONTRAPARTE
      '',                          // LINK_COMPROVANTE
      'NF registrada automaticamente no cadastro do evento',
      usuario,                     // PROCESSADO_POR
      agora,                       // TIMESTAMP
      '',                          // INCLUIDO_EM_FECHAMENTO
      'PROCESSADO'                 // STATUS
    ]);
  }

  // =========================
  // BV_EVENTO (PENDENTE)
  // =========================
  if (Number(evento.valorBV || 0) > 0 && !existeBV) {
    const idMovBV = gerarIDMovimentacao();

    sheetMov.appendRow([
      idMovBV,                    // ID_MOVIMENTACAO
      'BV_EVENTO',                 // TIPO_MOVIMENTACAO
      'SAÍDA',                     // NATUREZA
      idEvento,                    // ID_EVENTO
      nomeEvento,                  // NOME_EVENTO
      formatarDataTexto(agora),    // DATA_MOVIMENTACAO
      Number(evento.valorBV),      // VALOR
      '',                          // FORMA_PAGAMENTO
      evento.nomeBV || '',         // CONTRAPARTE
      evento.idBV || '',           // ID_CONTRAPARTE
      '',                          // LINK_COMPROVANTE
      'BV registrada automaticamente no cadastro do evento',
      usuario,                     // PROCESSADO_POR
      agora,                       // TIMESTAMP
      '',                          // INCLUIDO_EM_FECHAMENTO
      'PENDENTE'                   // STATUS
    ]);
  }
}