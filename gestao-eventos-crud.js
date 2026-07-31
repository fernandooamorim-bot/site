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
  const perfilNorm = String(perfilUsuario || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (!selectTipo) return;

  // Limpa opções
  selectTipo.innerHTML = '';

  if (perfilNorm === 'proprietario') {
    // Todas as opções
    selectTipo.innerHTML += '<option value="Padrão">Padrão</option>';
    selectTipo.innerHTML += '<option value="Percentual">Percentual</option>';
    selectTipo.innerHTML += '<option value="Fixo">Fixo</option>';
    selectTipo.innerHTML += '<option value="Sem Comissão">Sem Comissão</option>';
    if (campoValor) campoValor.style.display = 'block';
  } else if (perfilNorm === 'socio' || perfilNorm === 'administrador' || perfilNorm === 'admin') {
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

function normalizarPerfilComissaoCadastro_(perfil) {
  return String(perfil || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizarRegraComissaoCadastro_(dados, user, isEvento) {
  if (!isEvento) {
    return { tipo: 'N/A', valor: '' };
  }

  const tipo = String(dados.comissaoTipo || 'Padrão').trim() || 'Padrão';
  const tiposValidos = ['Padrão', 'Percentual', 'Fixo', 'Sem Comissão'];
  if (!tiposValidos.includes(tipo)) {
    throw new Error('Tipo de comissão inválido.');
  }

  const perfilNorm = normalizarPerfilComissaoCadastro_((user && user.PERFIL) || '');
  const proprietario = perfilNorm === 'proprietario';
  if (!proprietario && (tipo === 'Percentual' || tipo === 'Fixo')) {
    throw new Error('Apenas proprietário pode cadastrar comissão fixa ou percentual customizada.');
  }

  if (tipo === 'Padrão') {
    return {
      tipo: 'Padrão',
      valor: Number(obterConfig('COMISSAO_PADRAO_PERCENTUAL')) || 0
    };
  }

  if (tipo === 'Sem Comissão') {
    return { tipo: 'Sem Comissão', valor: 0 };
  }

  const valor = tipo === 'Fixo'
    ? normalizarValorMonetario_(dados.comissaoValor, { allowZero: true })
    : normalizarNumeroEntrada_(dados.comissaoValor, {
        decimals: 2,
        allowNegative: false,
        allowZero: true
      });

  if (valor === null || isNaN(valor)) {
    throw new Error('Valor da comissão inválido.');
  }

  return { tipo: tipo, valor: valor };
}

function criarEvento(dados, email) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('EVENTOS');
    const user = requireUserByEmail(email);
    requirePermission(user, 'eventos:criar');
    const usuario = user.email || user.EMAIL || email;
    const usuarioFinal = usuario || email || 'SYSTEM';

    const tipoRegistro = dados.tipoRegistro || 'Evento';
    const isEvento = tipoRegistro === 'Evento';
    const isReuniao = tipoRegistro === 'Reunião';
    const isBloqueio = tipoRegistro === 'Bloqueio';
    const isReserva = tipoRegistro === 'Reserva';

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
      : String(dados.nomeContratanteDigitado || '').trim();

    const nomeCerimonialista = (isEvento || isReserva || isReuniao)
      ? (dados.idCerimonialista
        ? buscarNomePorId('CERIMONIALISTAS', dados.idCerimonialista)
        : String(dados.nomeCerimonialistaDigitado || '').trim())
      : '';

    const nomeVendedor = isEvento
      ? buscarNomePorId('VENDEDORES', dados.idVendedor)
      : '';

    const nomeLocal = dados.idEndereco
      ? buscarNomePorId('ENDERECOS', dados.idEndereco)
      : (isBloqueio ? 'N/A' : String(dados.nomeLocalDigitado || '').trim());

    const nomeBV = isEvento
      ? buscarNomePorId('PARCEIROS_BV', dados.idBV)
      : '';

    // =====================================================
    // NORMALIZAÇÃO DE VALORES (evita variáveis indefinidas)
    // =====================================================
    const valorTotal = isEvento
      ? normalizarValorMonetario_(dados.valorTotal, { allowZero: false })
      : 0;
    const valorBV = isEvento
      ? (normalizarValorMonetario_(dados.valorBV, { allowZero: true }) || 0)
      : 0;
    const temNF = isEvento ? normalizarTemNF(dados.temNF) : false;
    const regraComissao = normalizarRegraComissaoCadastro_(dados, user, isEvento);
    const comissaoTipo = regraComissao.tipo;
    const comissaoValor = regraComissao.valor;

    if (isEvento && !(valorTotal > 0)) {
      throw new Error('Valor Total inválido. Use apenas números e separadores válidos.');
    }
    if (isEvento && valorBV < 0) {
      throw new Error('Valor BV inválido.');
    }
    if (isEvento && (comissaoTipo === 'Fixo' || comissaoTipo === 'Percentual') && (comissaoValor === null || isNaN(comissaoValor))) {
      throw new Error('Valor da comissão inválido.');
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
      isEvento ? dados.tipoEvento || '' : (isReserva ? (dados.tipoEvento || 'RESERVA') : ''), // 7
      (isEvento || isReserva) ? (dados.projeto || '') : '',               // 8
      dados.idContratante || '',         // 9
      nomeContratante,                   // 10 NOME_CONTRATANTE
      dados.idCerimonialista || '',      // 11
      nomeCerimonialista,                // 12 NOME_CERIMONIALISTA
      dados.idEndereco || '',            // 13
      nomeLocal,                         // 14 LOCAL
      valorTotal,                        // 15 VALOR_TOTAL
      0,                                 // 16 VALOR_RECEBIDO
      valorTotal, // 17 VALOR_PENDENTE (no cadastro é sempre o valor cheio)
      isEvento ? 'EM_ABERTO' : 'N/A', // 18
      dados.idVendedor || '',            // 19
      nomeVendedor,                      // 20 NOME_VENDEDOR
      comissaoTipo,                      // 21 COMISSAO_TIPO
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

    const payloadLogCriacao = {
      tipo: 'CRIACAO_EVENTO',
      tipoRegistro: tipoRegistro,
      tipoEvento: isEvento ? String(dados.tipoEvento || '').trim() : '',
      dataEvento: String(dados.data || '').trim(),
      contratante: String(nomeContratante || '').trim(),
      tituloEvento: montarTituloEventoParaLog_(tipoRegistro, dados, nomeContratante)
    };
    registrarLog('CRIAR', 'EVENTOS', idEvento, JSON.stringify(payloadLogCriacao));

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

function montarTituloEventoParaLog_(tipoRegistro, dados, nomeContratante) {
  const tipo = String(tipoRegistro || '').trim();
  const tipoEvento = String((dados && dados.tipoEvento) || '').trim();
  const contratante = String(nomeContratante || '').trim();
  const observacoes = String((dados && dados.observacoes) || '').trim();

  if (tipo === 'Reunião') {
    return ('Reunião' + (contratante ? (' - ' + contratante) : '')).trim();
  }
  if (tipo === 'Bloqueio') {
    return ('Bloqueio' + (observacoes ? (' - ' + observacoes) : '')).trim();
  }
  if (tipo === 'Reserva') {
    const baseReserva = contratante || observacoes || tipoEvento || 'Sem detalhes';
    return ('Reserva - ' + baseReserva).trim();
  }
  if (tipo === 'Evento') {
    const tipoEventoGenerico = !tipoEvento || /^evento$/i.test(tipoEvento);
    if (tipoEventoGenerico) return contratante || 'Evento';
    return contratante ? (tipoEvento + ' - ' + contratante) : tipoEvento;
  }
  const base = observacoes || contratante || tipoEvento;
  return (tipo + (base ? (' - ' + base) : '')).trim() || 'Registro';
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
  // Compatibilidade com ACL atual: criação de evento pode registrar metadados de BV.
  requirePermission(user, 'eventos:criar');
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
    requirePermission(user, 'eventos:editar');
    const usuario = user.email || user.EMAIL || email;
    
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
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    
    const eventos = [];
    const passadoDiasRaw = Number(String(
      filtros && (filtros.passadoDiasBoot !== undefined ? filtros.passadoDiasBoot : filtros.passadoDias)
    ).trim());
    const aplicarJanelaPassado = !isNaN(passadoDiasRaw) && passadoDiasRaw >= 0 && passadoDiasRaw <= 3650;
    let inicioPassado = null;
    if (aplicarJanelaPassado) {
      inicioPassado = new Date();
      inicioPassado.setHours(0, 0, 0, 0);
      inicioPassado.setDate(inicioPassado.getDate() - Math.floor(passadoDiasRaw));
    }
    
    // Começa da linha 2 (pula o cabeçalho)
    for (let i = 1; i < data.length; i++) {
      // Pula linhas vazias
      if (!data[i][0]) {
        continue;
      }

      const statusGeral = String(data[i][COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase();
      const incluirCancelados = filtros && filtros.incluirCancelados === true;
      if (!incluirCancelados && statusGeral === 'CANCELADO') {
        continue;
      }

      // Janela de histórico (somente para bootstrap operacional):
      // mantém todo futuro e corta apenas eventos finalizados antes do limite.
      if (aplicarJanelaPassado && inicioPassado) {
        const dataEventoRaw = data[i][COL.DATA_EVENTO];
        const dataFimRaw = data[i][COL.DATA_FIM];
        const dtEvento = parseDataComMeioDia(dataEventoRaw);
        const dtFim = parseDataComMeioDia(dataFimRaw);
        const dtReferencia = dtFim || dtEvento;
        if (dtReferencia && dtReferencia < inicioPassado) {
          continue;
        }
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
        cerimonialista: data[i][COL.NOME_CERIMONIALISTA], // Cerimonialista
        local: data[i][COL.LOCAL],              // "PALLATIUM"
        look: data[i][COL.LOOK],                // Look
        somResponsavel: data[i][COL.SOM_RESPONSAVEL], // Som responsável
        valor: data[i][COL.VALOR_TOTAL],        // 20000
        valorRecebido: data[i][COL.VALOR_RECEBIDO],
        valorPendente: data[i][COL.VALOR_PENDENTE],
        valorNF: data[i][COL.VALOR_NF],
        statusNF: data[i][COL.STATUS_NF],
        valorBV: data[i][COL.VALOR_BV],
        statusBV: data[i][COL.STATUS_BV],
        folhaCustoValor: data[i][COL.FOLHA_CUSTO_VALOR], // espelho EVENTOS
        status: data[i][COL.STATUS_RECEBIMENTO], // "Pendente"
        observacoes: data[i][COL.OBSERVACOES],   // Observações do evento
        statusGeral: statusGeral,
        dataCriacaoMs: normalizarTimestampMs_(data[i][COL.DATA_CRIACAO]),
        ultimaEdicaoMs: normalizarTimestampMs_(data[i][COL.ULTIMA_EDICAO]),
        criadoPor: String(data[i][COL.CRIADO_POR] || ''),
        editadoPor: String(data[i][COL.EDITADO_POR] || '')
      };
      
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
    
    // ========================================
    // DETECTA EVENTOS DENTRO DE INTERVALOS
    // ========================================
    const eventosComRelacoes = detectarEventosDentroDeIntervalos(eventos);

    // Auditoria opcional (desligada por padrão para performance em produção).
    if (deveAuditarAgenda_()) {
      const auditoria = auditarOrdemCronologica(eventosComRelacoes);
      if (!auditoria.passou) {
        Logger.log('⚠️ Auditoria agenda identificou problemas: ' + auditoria.erros.length);
      }
    }
    
  
    return eventosComRelacoes;
    
  } catch (error) {
    Logger.log('ERRO em listarEventos: ' + error.message);
    throw error;
  }
}

/**
 * Lista eventos conforme perfil do usuário autenticado.
 * Músico: apenas Eventos dentro da janela de hoje até +1 mês, sem dados financeiros.
 */
function listarEventosPorUsuario(email, opts) {
  return listarEventosBootstrap(email, opts).eventos || [];
}

function listarEventosBootstrap(email, opts) {
  const user = requireUserByEmail(email);
  return obterPayloadAgendaPorUsuario_(user, opts || {});
}

function obterPayloadAgendaPorUsuario_(user, opts) {
  opts = opts || {};
  const cfgCache = obterConfiguracaoCacheCompartilhadoAgenda_();
  const incluirCancelados = !!opts.incluirCancelados;
  const perfilNormAgenda = normalizarPerfilCacheAgenda_(user && user.PERFIL);
  const podeVerFinanceiroAgenda = perfilPodeVerFinanceiroAgenda_(user && user.PERFIL);
  const escopoPerfil = podeVerFinanceiroAgenda
    ? 'financeiro'
    : (perfilNormAgenda === 'musico' ? 'musico' : 'restrito');
  const passadoDiasBootNum = escopoPerfil === 'musico' ? null : obterPassadoDiasBootAgenda_(opts);
  const optsAgenda = Object.assign({}, opts, {
    incluirCancelados: incluirCancelados,
    passadoDiasBoot: passadoDiasBootNum
  });

  if (!cfgCache.ativo) {
    const syncVersion = obterSyncVersionAgendaPorPerfil_(String(user && user.PERFIL || ''));
    return montarPayloadAgendaPorUsuarioSemCache_(user, syncVersion, optsAgenda);
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('EVENTOS');
    if (!sh) {
      return {
        eventos: [],
        syncVersion: 'NO_EVENTOS_SHEET'
      };
    }

    const sync = montarSyncAgendaInfo_(String(user.PERFIL || ''), ss, sh);
    const passadoDiasBoot = escopoPerfil === 'musico'
      ? 'musico_janela_fixa'
      : String(passadoDiasBootNum);
    const diaBucket = escopoPerfil === 'musico'
      ? Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd')
      : 'all';

    const chaveCache = [
      'AGENDA_SHARED_V2',
      escopoPerfil,
      'passado_boot_' + passadoDiasBoot,
      diaBucket,
      incluirCancelados ? 'inc_cancelados' : 'sem_cancelados',
      sync.version
    ].join('|');

    const cache = CacheService.getScriptCache();
    const parsed = lerJsonCacheCompartilhadoAgenda_(cache, chaveCache);
    if (parsed) {
      if (Array.isArray(parsed)) {
        return {
          eventos: parsed,
          syncVersion: String(sync.version || '')
        };
      }

      if (Array.isArray(parsed.eventos)) {
        return {
          eventos: parsed.eventos,
          syncVersion: String(parsed.syncVersion || sync.version || '')
        };
      }
    }

    const payload = montarPayloadAgendaPorUsuarioSemCache_(user, String(sync.version || ''), optsAgenda);
    salvarJsonCacheCompartilhadoAgenda_(cache, chaveCache, payload, cfgCache.ttlSegundos);
    return payload;
  } catch (e) {
    Logger.log('Falha no cache compartilhado da agenda: ' + e.message);
    return montarPayloadAgendaPorUsuarioSemCache_(user, '', optsAgenda);
  }
}

function montarPayloadAgendaPorUsuarioSemCache_(user, syncVersion, opts) {
  opts = opts || {};
  return {
    eventos: listarEventosPorUsuarioSemCache_(user, opts),
    syncVersion: String(syncVersion || '')
  };
}

function obterSyncVersionAgendaPorPerfil_(perfil) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('EVENTOS');
    if (!sh) return 'NO_EVENTOS_SHEET';
    return String(montarSyncAgendaInfo_(String(perfil || ''), ss, sh).version || '');
  } catch (_) {
    return '';
  }
}

function listarEventosPorUsuarioSemCache_(user, opts) {
  opts = opts || {};
  const ehMusico = !!(user && normalizarPerfilCacheAgenda_(user.PERFIL) === 'musico');
  const podeVerFinanceiroAgenda = perfilPodeVerFinanceiroAgenda_(user && user.PERFIL);
  const passadoDiasBoot = ehMusico ? null : obterPassadoDiasBootAgenda_(opts);
  const eventos = listarEventos({
    incluirCancelados: !!opts.incluirCancelados,
    passadoDiasBoot: passadoDiasBoot
  });

  if (!podeVerFinanceiroAgenda && !ehMusico) {
    return eventos.map(function (evento) {
      return sanitizarEventoFinanceiroAgenda_(evento);
    });
  }

  if (!ehMusico) {
    return eventos;
  }

  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);

  const limite = new Date(inicio);
  limite.setMonth(limite.getMonth() + 1);
  limite.setHours(23, 59, 59, 999);

  return eventos
    .filter(function (evento) {
      if (!evento || evento.tipo !== 'Evento') return false;
      const data = parseDataBR(evento.data);
      if (!data) return false;
      data.setHours(0, 0, 0, 0);
      return data >= inicio && data <= limite;
    })
    .map(function (evento) {
      return sanitizarEventoFinanceiroAgenda_(evento);
    });
}

function obterPassadoDiasBootAgenda_(opts) {
  const fromOpts = Number(String(
    opts && (opts.passadoDiasBoot !== undefined ? opts.passadoDiasBoot : opts.passadoDias)
  ).trim());
  if (!isNaN(fromOpts) && fromOpts >= 0 && fromOpts <= 3650) return Math.floor(fromOpts);

  try {
    const cfg = getConfig ? getConfig() : {};
    const bruto = Number(String(cfg && cfg.AGENDA_PASSADO_DIAS_BOOT || '').trim());
    if (!isNaN(bruto) && bruto >= 0 && bruto <= 3650) return Math.floor(bruto);
  } catch (_) {}

  return 90;
}

function lerJsonCacheCompartilhadoAgenda_(cache, chaveBase) {
  try {
    const raw = cache.get(chaveBase);
    if (!raw) return null;

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return null;
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.__chunkedAgenda) {
      return parsed;
    }

    const total = Number(parsed.total || 0);
    if (!total || total < 1) return null;

    const keys = [];
    for (var i = 0; i < total; i++) {
      keys.push(chaveBase + '|part|' + i);
    }

    const partes = cache.getAll(keys);
    if (!partes) return null;

    let json = '';
    for (var j = 0; j < keys.length; j++) {
      const parte = partes[keys[j]];
      if (typeof parte !== 'string') return null;
      json += parte;
    }

    return JSON.parse(json);
  } catch (e) {
    Logger.log('Falha ao ler cache compartilhado chunked da agenda: ' + e.message);
    return null;
  }
}

function salvarJsonCacheCompartilhadoAgenda_(cache, chaveBase, valor, ttlSegundos) {
  try {
    const json = typeof valor === 'string' ? valor : JSON.stringify(valor);
    if (!json) return false;

    if (json.length <= 90000) {
      cache.put(chaveBase, json, ttlSegundos);
      return true;
    }

    const chunkSize = 80000;
    const total = Math.ceil(json.length / chunkSize);
    if (total > 10) {
      Logger.log(
        'Agenda shared cache ignorado por tamanho excessivo (bytes=' +
        String(json.length) +
        ', partes=' +
        String(total) +
        ')'
      );
      return false;
    }

    for (var i = 0; i < total; i++) {
      const chunk = json.slice(i * chunkSize, (i + 1) * chunkSize);
      cache.put(chaveBase + '|part|' + i, chunk, ttlSegundos);
    }

    cache.put(
      chaveBase,
      JSON.stringify({ __chunkedAgenda: true, total: total }),
      ttlSegundos
    );
    return true;
  } catch (e) {
    Logger.log('Falha ao salvar cache compartilhado da agenda: ' + e.message);
    return false;
  }
}

/**
 * Retorna versão leve da agenda para revalidação de cache no frontend.
 * Usa metadados do arquivo + tamanho da aba EVENTOS.
 */
function obterAgendaSyncInfo(email) {
  const user = requireUserByEmail(email);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('EVENTOS');

  if (!sh) {
    return {
      ok: true,
      perfil: user.PERFIL,
      rows: 0,
      version: 'NO_EVENTOS_SHEET'
    };
  }

  const sync = montarSyncAgendaInfo_(String(user.PERFIL || ''), ss, sh);

  return {
    ok: true,
    perfil: user.PERFIL,
    rows: sync.rows,
    syncMode: 'EVENTOS',
    syncOptions: {
      verificarAbaEventos: sync.verificarAbaEventos,
      verificarArquivo: sync.verificarArquivo
    },
    assinaturaEventos: sync.assinaturaEventos,
    assinaturaAbaEventos: sync.assinaturaAbaEventos,
    arquivoAtualizadoMs: sync.arquivoAtualizadoMs,
    version: sync.version
  };
}

function montarSyncAgendaInfo_(perfil, ss, sh) {
  const rows = sh.getLastRow();
  const assinatura = obterAssinaturaEventos_(sh);
  const cfgSync = obterConfiguracaoSyncAgenda_();
  const assinaturaAbaEventos = cfgSync.verificarAbaEventos
    ? obterAssinaturaConteudoAbaEventos_(sh)
    : 'OFF';
  const arquivoAtualizadoMs = cfgSync.verificarArquivo
    ? obterUltimaAtualizacaoArquivoAgendaMs_(ss)
    : 0;

  const version = [
    String(perfil || ''),
    'EVENTOS',
    String(rows || 0),
    assinatura,
    assinaturaAbaEventos,
    String(arquivoAtualizadoMs || 0)
  ].join('|');

  return {
    rows: rows,
    assinaturaEventos: assinatura,
    assinaturaAbaEventos: assinaturaAbaEventos,
    arquivoAtualizadoMs: arquivoAtualizadoMs,
    verificarAbaEventos: cfgSync.verificarAbaEventos,
    verificarArquivo: cfgSync.verificarArquivo,
    version: version
  };
}

function obterConfiguracaoSyncAgenda_() {
  try {
    const cfg = getConfig ? getConfig() : {};
    return {
      verificarAbaEventos: configBoolSyncAgenda_(cfg, 'AGENDA_SYNC_VERIFICAR_ABA_EVENTOS', false),
      verificarArquivo: configBoolSyncAgenda_(cfg, 'AGENDA_SYNC_VERIFICAR_ARQUIVO', false)
    };
  } catch (_) {
    return {
      verificarAbaEventos: false,
      verificarArquivo: false
    };
  }
}

function configBoolSyncAgenda_(cfg, chave, padrao) {
  const bruto = cfg && Object.prototype.hasOwnProperty.call(cfg, chave) ? cfg[chave] : null;
  if (bruto === null || typeof bruto === 'undefined' || String(bruto).trim() === '') return !!padrao;
  const s = String(bruto).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'sim' || s === 'yes' || s === 'on';
}

function obterConfiguracaoCacheCompartilhadoAgenda_() {
  try {
    const cfg = getConfig ? getConfig() : {};
    const ativo = configBoolSyncAgenda_(cfg, 'AGENDA_CACHE_COMPARTILHADO_ATIVO', false);
    const ttlRaw = Number(String(cfg && cfg.AGENDA_CACHE_COMPARTILHADO_TTL_SEGUNDOS || '').trim());
    const ttlSegundos = (!isNaN(ttlRaw) && ttlRaw >= 30 && ttlRaw <= 21600)
      ? Math.floor(ttlRaw)
      : 120;

    return {
      ativo: ativo,
      ttlSegundos: ttlSegundos
    };
  } catch (_) {
    return {
      ativo: false,
      ttlSegundos: 120
    };
  }
}

function normalizarPerfilCacheAgenda_(perfil) {
  return String(perfil || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function perfilPodeVerFinanceiroAgenda_(perfil) {
  const p = normalizarPerfilCacheAgenda_(perfil);
  return p === 'proprietario' || p === 'socio' || p === 'administrador' || p === 'admin';
}

function obterAssinaturaConteudoAbaEventos_(sheet) {
  try {
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow <= 1 || lastColumn <= 0) return 'EMPTY';

    const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
    const idxTipo = headers.indexOf('TIPO_REGISTRO');
    const idxData = headers.indexOf('DATA_EVENTO');
    const idxDataFim = headers.indexOf('DATA_FIM');
    const idxHora = headers.indexOf('HORA_INICIO');
    const idxDur = headers.indexOf('DURACAO');
    const idxTipoEvento = headers.indexOf('TIPO_EVENTO');
    const idxProjeto = headers.indexOf('PROJETO');
    const idxContratante = headers.indexOf('NOME_CONTRATANTE');
    const idxLocal = headers.indexOf('LOCAL');
    const idxStatus = headers.indexOf('STATUS_GERAL');
    const idxId = headers.indexOf('ID_EVENTO');

    const relevantes = [
      idxId, idxTipo, idxData, idxDataFim, idxHora,
      idxDur, idxTipoEvento, idxProjeto, idxContratante, idxLocal, idxStatus
    ].filter(function (i) { return i >= 0; });

    if (!relevantes.length) return 'NO_COLUMNS';

    const totalRegistros = lastRow - 1;
    const data = sheet.getRange(2, 1, totalRegistros, lastColumn).getValues();

    let hash = 2166136261; // FNV-1a 32-bit seed
    for (let r = 0; r < data.length; r++) {
      for (let c = 0; c < relevantes.length; c++) {
        const idx = relevantes[c];
        const raw = data[r][idx];
        const valor = normalizarValorAssinaturaAgenda_(raw);
        for (let k = 0; k < valor.length; k++) {
          hash ^= valor.charCodeAt(k);
          hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        hash ^= 31;
      }
    }

    const finalHash = (hash >>> 0).toString(16);
    return String(totalRegistros) + ':' + finalHash;
  } catch (e) {
    Logger.log('Aviso obterAssinaturaConteudoAbaEventos_: ' + e.message);
    return 'ERR';
  }
}

function normalizarValorAssinaturaAgenda_(valor) {
  if (valor === null || typeof valor === 'undefined') return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    if (isNaN(valor.getTime())) return '';
    return String(valor.getTime());
  }
  if (typeof valor === 'number') {
    if (isNaN(valor)) return '';
    return String(Number(valor.toFixed(6)));
  }
  return String(valor).trim();
}

function obterUltimaAtualizacaoArquivoAgendaMs_(ss) {
  try {
    const file = DriveApp.getFileById(ss.getId());
    const dt = file.getLastUpdated();
    if (!dt) return 0;
    const ms = dt.getTime();
    return isNaN(ms) ? 0 : ms;
  } catch (e) {
    Logger.log('Aviso obterUltimaAtualizacaoArquivoAgendaMs_: ' + e.message);
    return 0;
  }
}

function obterAssinaturaEventos_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow <= 1) return 'EMPTY';

  const cabecalho = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const idxId = cabecalho.indexOf('ID_EVENTO');
  const idxUltimaEdicao = cabecalho.indexOf('ULTIMA_EDICAO');
  const idxCriacao = cabecalho.indexOf('DATA_CRIACAO');

  const totalRegistros = lastRow - 1;

  const ids = idxId >= 0
    ? sheet.getRange(2, idxId + 1, totalRegistros, 1).getValues()
    : [];
  const ultimaEdicao = idxUltimaEdicao >= 0
    ? sheet.getRange(2, idxUltimaEdicao + 1, totalRegistros, 1).getValues()
    : [];
  const criacao = idxCriacao >= 0
    ? sheet.getRange(2, idxCriacao + 1, totalRegistros, 1).getValues()
    : [];

  let maxTs = 0;
  let ultimoId = '';
  for (let i = 0; i < totalRegistros; i++) {
    const idAtual = ids[i] ? String(ids[i][0] || '').trim() : '';
    if (idAtual) ultimoId = idAtual;

    const c1 = ultimaEdicao[i] ? ultimaEdicao[i][0] : null;
    const c2 = criacao[i] ? criacao[i][0] : null;
    const ts = Math.max(normalizarTimestampMs_(c1), normalizarTimestampMs_(c2));
    if (ts > maxTs) maxTs = ts;
  }

  return [String(totalRegistros), String(ultimoId), String(maxTs)].join(':');
}

function normalizarTimestampMs_(valor) {
  if (!valor) return 0;
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return isNaN(valor.getTime()) ? 0 : valor.getTime();
  }
  const num = Number(valor);
  if (!isNaN(num) && num > 0) return Math.floor(num);
  const d = new Date(String(valor));
  if (isNaN(d.getTime())) return 0;
  return d.getTime();
}

function sanitizarEventoFinanceiroAgenda_(evento) {
  if (!evento || typeof evento !== 'object') return evento;

  // Remove campos financeiros sensíveis para perfis sem acesso financeiro na Agenda.
  return Object.assign({}, evento, {
    valor: '',
    valorRecebido: '',
    valorPendente: '',
    valorNF: '',
    statusNF: '',
    valorBV: '',
    statusBV: '',
    status: ''
  });
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
 * Hora de virada para ordenação comercial da agenda.
 * Ex.: 06 => horários entre 00:00 e 05:59 contam como "depois" da noite anterior.
 */
function obterHoraViradaMadrugada_() {
  try {
    const config = getConfig ? getConfig() : {};
    const bruto = config && config.AGENDA_HORA_VIRADA_MADRUGADA;
    const num = Number(String(bruto || '').trim());
    if (!isNaN(num) && num >= 0 && num <= 12) return Math.floor(num);
  } catch (_) {}
  return 6;
}

function horaParaMinutosOrdenacaoAgenda_(horaStr) {
  const str = String(horaStr || '').trim();
  const m = str.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 99 * 60;

  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (isNaN(h) || isNaN(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return 99 * 60;

  let total = (h * 60) + mm;
  const virada = obterHoraViradaMadrugada_();
  if (h < virada) total += 24 * 60;
  return total;
}

function compararEventosPorDataHoraAgenda_(a, b) {
  const dataA = parseDataBR(a && a.data);
  const dataB = parseDataBR(b && b.data);

  if (dataA && dataB) {
    if (dataA.getTime() !== dataB.getTime()) return dataA - dataB;
    return horaParaMinutosOrdenacaoAgenda_(a && a.hora) - horaParaMinutosOrdenacaoAgenda_(b && b.hora);
  }

  if (dataA && !dataB) return -1;
  if (!dataA && dataB) return 1;
  return horaParaMinutosOrdenacaoAgenda_(a && a.hora) - horaParaMinutosOrdenacaoAgenda_(b && b.hora);
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
        if (
          evt.data === intervalo.data &&
          evt.hora &&
          horaParaMinutosOrdenacaoAgenda_(evt.hora) < horaParaMinutosOrdenacaoAgenda_(horaInicioIntervalo)
        ) {
          return false;
        }

        return true;
      });

      if (eventosDentro.length > 0) {
        eventosDentro.sort(compararEventosPorDataHoraAgenda_);

        intervalo.eventosDentro = eventosDentro;
        intervalo.inicioIntervalo = horaInicioIntervalo;
      }
    });

    // Mantém TODOS os eventos na lista principal
    const eventosFinais = [...eventos];

    // Ordenação final: data → hora
    eventosFinais.sort(compararEventosPorDataHoraAgenda_);

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
  if (!dataStr) return null;
  
  try {
    // Converte para string
    const str = String(dataStr).trim();
    
    // Valida formato DD/MM/YYYY
    const regex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const match = str.match(regex);
    
    if (!match) return null;
    
    const dia = parseInt(match[1], 10);
    const mes = parseInt(match[2], 10) - 1; // 0-based
    const ano = parseInt(match[3], 10);
    
    // Validações básicas
    if (ano < 1900 || ano > 2100) return null;
    
    if (mes < 0 || mes > 11) return null;
    
    if (dia < 1 || dia > 31) return null;
    
    // Cria data
    const data = new Date(ano, mes, dia, 12, 0, 0, 0);
    
    // Valida se data é válida
    if (isNaN(data.getTime())) return null;
    
    // Valida se componentes batem (31/02 vira 03/03)
    if (data.getDate() !== dia || 
        data.getMonth() !== mes || 
        data.getFullYear() !== ano) return null;
    
    return data;
    
  } catch (e) {
    return null;
  }
}

function deveAuditarAgenda_() {
  try {
    const valor = String(obterConfig('AGENDA_AUDITORIA_ATIVA') || '').toLowerCase().trim();
    return valor === 'true' || valor === '1' || valor === 'sim';
  } catch (_) {
    return false;
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
    const tzPlanilha = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'America/Fortaleza';

    const dados = sheet.getDataRange().getValues();
    const eventos = [];

    const dataBuscaDate = normalizarData(dataBusca);
    if (!dataBuscaDate) return [];

    for (let i = 1; i < dados.length; i++) {
      if (!dados[i][0]) continue;
      const statusGeral = String(dados[i][38] || 'ATIVO').trim().toUpperCase();
      if (statusGeral === 'CANCELADO') continue;

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
        const valorHora = dados[i][4];
        if (valorHora instanceof Date) {
          // Usa o fuso da planilha para evitar distorções (ex.: 00:00 virar 23:34)
          horaStr = Utilities.formatDate(valorHora, tzPlanilha, 'HH:mm');
        } else if (typeof valorHora === 'string' && /^\d{1,2}:\d{2}$/.test(valorHora.trim())) {
          horaStr = valorHora.trim().padStart(5, '0');
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

    eventos.sort(compararEventosPorDataHoraAgenda_);
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
        AGENDA_OFFLINE_ATIVO: false,
        AGENDA_OFFLINE_INDEX_CARD: true,
        AGENDA_CORES_PERSONALIZADAS: true,
        AGENDA_LIMITE_TODOS: 200,
        AGENDA_PASSADO_DIAS_BOOT: 90
      };
    }
    
    const data = configSheet.getDataRange().getValues();
    const config = {};
    
    // Le cada linha (CHAVE | VALOR)
    for (let i = 1; i < data.length; i++) {
      const chave = data[i][0];
      const valor = data[i][1];
      
      if (chave) {
        config[chave] = normalizarValorConfig_(valor);
      }
    }
    
    Logger.log('Configurações carregadas: ' + Object.keys(config).length + ' chave(s).');
    return config;
    
  } catch (e) {
    Logger.log('Erro ao carregar configurações:', e.message);
    return {
      AGENDA_FILTRO_PADRAO: 'proximos',
      AGENDA_CACHE_TIMEOUT: 300000,
      AGENDA_OFFLINE_ATIVO: false,
      AGENDA_OFFLINE_INDEX_CARD: true,
      AGENDA_CORES_PERSONALIZADAS: true,
      AGENDA_LIMITE_TODOS: 200,
      AGENDA_PASSADO_DIAS_BOOT: 90
    };
  }
}

/**
 * Configurações que podem ser enviadas ao navegador.
 *
 * A aba CONFIG também contém credenciais de integrações. Por isso, nenhum
 * endpoint público deve devolver a aba inteira ou aceitar uma chave arbitrária.
 * Novas chaves visíveis no frontend precisam ser incluídas explicitamente aqui.
 */
const CONFIG_PUBLICA_CHAVES = [
  'COMISSAO_PADRAO_PERCENTUAL',
  'REUNIAO_MOTIVOS_PADRAO',
  'RESERVA_MOTIVOS_PADRAO',
  'AGENDA_FILTRO_PADRAO',
  'AGENDA_CACHE_TIMEOUT',
  'AGENDA_CACHE_INSTANT_BOOT',
  'AGENDA_CACHE_NOTIFY_UPDATE',
  'AGENDA_OFFLINE_ATIVO',
  'AGENDA_OFFLINE_INDEX_CARD',
  'AGENDA_CORES_PERSONALIZADAS',
  'AGENDA_LIMITE_TODOS',
  'AGENDA_PASSADO_DIAS_BOOT',
  'AGENDA_TITULO_CASE_MODE',
  'AGENDA_TITULO_STOPWORDS_PT',
  'AGENDA_HORA_VIRADA_MADRUGADA',
  'AGENDA_VIRTUALIZACAO_ENABLED',
  'AGENDA_VIRTUALIZACAO_THRESHOLD',
  'AGENDA_VIRTUALIZACAO_BUFFER',
  'AGENDA_VIRTUALIZACAO_DEBUG'
];

function chaveConfigPublica_(chave) {
  return CONFIG_PUBLICA_CHAVES.indexOf(String(chave || '').trim()) !== -1;
}

function carregarConfiguracoesPublicas() {
  const todas = carregarConfiguracoes() || {};
  const publicas = {};
  CONFIG_PUBLICA_CHAVES.forEach(function (chave) {
    if (Object.prototype.hasOwnProperty.call(todas, chave)) {
      publicas[chave] = todas[chave];
    }
  });
  return publicas;
}

function obterConfigPublica(chave) {
  const nome = String(chave || '').trim();
  if (!chaveConfigPublica_(nome)) {
    throw new Error('CONFIG_CHAVE_NAO_PUBLICA');
  }
  return obterConfig(nome);
}

function normalizarValorConfig_(valor) {
  if (valor === null || typeof valor === 'undefined') return '';
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') return valor;

  const texto = String(valor).trim();
  const lower = texto.toLowerCase();

  if (lower === 'true' || lower === 'sim' || lower === '1') return true;
  if (lower === 'false' || lower === 'nao' || lower === 'não' || lower === '0') return false;

  if (texto !== '' && /^-?\d+(\.\d+)?$/.test(texto)) {
    return Number(texto);
  }

  return texto;
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
  // Compatibilidade com ACL atual: criação de evento pode preparar movimentos de NF/BV.
  requirePermission(user, 'eventos:criar');
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

  const usuario = user.email || user.EMAIL || email;
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
