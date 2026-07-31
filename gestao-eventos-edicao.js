/**
 * =====================================================
 * GESTÃO DE EVENTOS – EDIÇÃO (VERSÃO COMPLETA)
 * Backend Apps Script - TODAS AS FUNÇÕES
 * =====================================================
 */


/* =========================
   BUSCAS
========================= */

function buscarEventoPorID(idParcial) {
  exigirAcao('eventos:editar');
  Logger.log('🔍 buscarEventoPorID: ' + idParcial);
  const sheet = SpreadsheetApp.getActive().getSheetByName('EVENTOS');
  if (!sheet) return [];

  const dados = sheet.getDataRange().getValues();
  const busca = String(idParcial).toUpperCase();
  const eventos = [];

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    if (!linha[COL.ID_EVENTO]) continue;
    const statusGeral = String(linha[COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase();
    if (statusGeral === 'CANCELADO') continue;

    const id = String(linha[COL.ID_EVENTO]).toUpperCase();
    if (!id.includes(busca)) continue;

    eventos.push(mapEventoResumo(linha));
    if (eventos.length >= 20) break;
  }

  Logger.log('✅ Encontrados: ' + eventos.length);
  return eventos;
}

function buscarEventoPorContratante(nomeParcial) {
  exigirAcao('eventos:editar');
  Logger.log('🔍 buscarEventoPorContratante: ' + nomeParcial);
  const sheet = SpreadsheetApp.getActive().getSheetByName('EVENTOS');
  if (!sheet) return [];

  const dados = sheet.getDataRange().getValues();
  const busca = String(nomeParcial || '').trim().toLowerCase();
  const eventos = [];
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const statusGeral = String(linha[COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase();
    if (statusGeral === 'CANCELADO') continue;
    const id = String(linha[COL.ID_EVENTO] || '').trim();
    const nome = String(linha[COL.NOME_CONTRATANTE] || '').toLowerCase();
    const tipoEvento = String(linha[COL.TIPO_EVENTO] || '').trim();
    const matchNome = nome.includes(busca);
    const matchId = id.toLowerCase().includes(busca);
    if (!matchNome && !matchId) continue;

    const resumo = mapEventoResumo(linha);
    const dataEvento = normalizarData(linha[COL.DATA_EVENTO]);
    const pendente = Number(linha[COL.VALOR_PENDENTE] || 0);
    const statusRecebimento = String(linha[COL.STATUS_RECEBIMENTO] || '').toUpperCase();
    const temPendencia = pendente > 0 ||
      statusRecebimento === 'PENDENTE' ||
      statusRecebimento === 'EM_ABERTO' ||
      statusRecebimento === 'PARCIAL';

    let prioridadeData = 999999;
    if (dataEvento instanceof Date && !isNaN(dataEvento.getTime())) {
      const d = new Date(dataEvento.getFullYear(), dataEvento.getMonth(), dataEvento.getDate());
      prioridadeData = Math.abs(Math.round((d.getTime() - hoje.getTime()) / 86400000));
    }

    const prioridadeMatch = matchId ? 0 : 1;
    const prioridadePendencia = temPendencia ? 0 : 1;

    eventos.push({
      item: resumo,
      k1: prioridadeMatch,
      k2: prioridadePendencia,
      k3: prioridadeData
    });
  }

  eventos.sort((a, b) => {
    if (a.k1 !== b.k1) return a.k1 - b.k1;
    if (a.k2 !== b.k2) return a.k2 - b.k2;
    if (a.k3 !== b.k3) return a.k3 - b.k3;
    return String(a.item.contratante || '').localeCompare(String(b.item.contratante || ''), 'pt-BR');
  });

  const result = eventos.slice(0, 20).map(x => x.item);
  Logger.log('✅ Encontrados: ' + result.length);
  return result;
}

function buscarEventoPorData(dataISO) {
  exigirAcao('eventos:editar');
  Logger.log('🔍 buscarEventoPorData: ' + dataISO);
  if (!dataISO) return [];

  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const dataBusca = new Date(ano, mes - 1, dia);
  dataBusca.setHours(0, 0, 0, 0);

  const sheet = SpreadsheetApp.getActive().getSheetByName('EVENTOS');
  if (!sheet) return [];

  const dados = sheet.getDataRange().getValues();
  const eventos = [];

  for (let i = 1; i < dados.length; i++) {
    const statusGeral = String(dados[i][COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase();
    if (statusGeral === 'CANCELADO') continue;
    const dataEvento = normalizarData(dados[i][COL.DATA_EVENTO]);
    if (!dataEvento) continue;

    const d = new Date(dataEvento);
    d.setHours(0, 0, 0, 0);

    if (d.getTime() === dataBusca.getTime()) {
      eventos.push(mapEventoResumo(dados[i]));
      if (eventos.length >= 20) break;
    }
  }

  Logger.log('✅ Encontrados: ' + eventos.length);
  return eventos;
}

function buscarEventoPorPeriodo(periodo) {
  exigirAcao('eventos:editar');
  Logger.log('🔍 buscarEventoPorPeriodo: ' + periodo);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  let inicio, fim;

  switch (periodo) {
    case 'ultimos-7':
      inicio = new Date(hoje); inicio.setDate(inicio.getDate() - 7); fim = hoje; break;
    case 'ultimos-30':
      inicio = new Date(hoje); inicio.setDate(inicio.getDate() - 30); fim = hoje; break;
    case 'este-mes':
      inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0); break;
    case 'mes-passado':
      inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0); break;
    case 'proximos':
      inicio = hoje;
      fim = new Date(hoje.getFullYear() + 1, hoje.getMonth(), hoje.getDate()); break;
    case 'este-ano':
      inicio = new Date(hoje.getFullYear(), 0, 1);
      fim = new Date(hoje.getFullYear(), 11, 31); break;
    default:
      return [];
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName('EVENTOS');
  if (!sheet) return [];

  const dados = sheet.getDataRange().getValues();
  const eventos = [];

  for (let i = 1; i < dados.length; i++) {
    const statusGeral = String(dados[i][COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase();
    if (statusGeral === 'CANCELADO') continue;
    const dataEvento = normalizarData(dados[i][COL.DATA_EVENTO]);
    if (!dataEvento) continue;
    if (dataEvento >= inicio && dataEvento <= fim) {
      eventos.push(mapEventoResumo(dados[i]));
    }
  }

  eventos.sort((a, b) => {
    const da = normalizarData(a.dataFormatada);
    const db = normalizarData(b.dataFormatada);
    if (da && db) return da - db;
    if (da && !db) return -1;
    if (!da && db) return 1;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  Logger.log('✅ Encontrados: ' + eventos.length);
  return eventos.slice(0, 20);
}

/* =========================
   EDIÇÃO
========================= */

function buscarEventoParaEdicao(idEvento) {
  exigirAcao('eventos:editar');
  Logger.log('═══════════════════════════════════════════════');
  Logger.log('📝 buscarEventoParaEdicao INICIADA');
  Logger.log('ID recebido: ' + idEvento);
  Logger.log('═══════════════════════════════════════════════');

  try {
    if (typeof COL !== 'object') {
      throw new Error('COL não definido');
    }

    const sheet = SpreadsheetApp.getActive().getSheetByName('EVENTOS');
    if (!sheet) {
      throw new Error('Sheet EVENTOS não encontrada');
    }

    const dados = sheet.getDataRange().getValues();
    Logger.log('Total de linhas: ' + dados.length);

    for (let i = 1; i < dados.length; i++) {
      const l = dados[i];
      if (String(l[COL.ID_EVENTO]) !== String(idEvento)) continue;

      Logger.log('✅ Evento encontrado na linha ' + (i + 1));

      let horaFormatada = '';
      if (l[COL.HORA_INICIO] instanceof Date) {
        horaFormatada =
          String(l[COL.HORA_INICIO].getHours()).padStart(2, '0') + ':' +
          String(l[COL.HORA_INICIO].getMinutes()).padStart(2, '0');
      } else if (typeof l[COL.HORA_INICIO] === 'string') {
        horaFormatada = l[COL.HORA_INICIO];
      }

      const idContratanteAtual = String(l[COL.ID_CONTRATANTE] || '').trim();
      const idEnderecoAtual = String(l[COL.ID_ENDERECO] || '').trim();
      const nomeContratanteAtual = String(l[COL.NOME_CONTRATANTE] || '').trim();
      const nomeLocalAtual = String(l[COL.LOCAL] || '').trim();

      const nomeContratanteCadastro = idContratanteAtual
        ? String(buscarNomePorId('CONTRATANTES', idContratanteAtual) || '').trim()
        : '';
      const nomeLocalCadastro = idEnderecoAtual
        ? String(buscarNomePorId('ENDERECOS', idEnderecoAtual) || '').trim()
        : '';

      const refContratanteExiste = !!nomeContratanteCadastro;
      const refEnderecoExiste = !!nomeLocalCadastro;
      const refContratanteDivergente = refContratanteExiste &&
        normalizarTextoComparacao_(nomeContratanteAtual) !== normalizarTextoComparacao_(nomeContratanteCadastro);
      const refEnderecoDivergente = refEnderecoExiste &&
        normalizarTextoComparacao_(nomeLocalAtual) !== normalizarTextoComparacao_(nomeLocalCadastro);

      const evento = {
  id: l[COL.ID_EVENTO],
  tipoRegistro: l[COL.TIPO_REGISTRO] || 'Evento',

  // 🔑 PADRÃO DEFINITIVO
  dataEvento: formatarDataISO(l[COL.DATA_EVENTO]),
  dataFim: formatarDataISO(l[COL.DATA_FIM]),

  horaInicio: horaFormatada,
  duracao: l[COL.DURACAO] || '',
  tipoEvento: l[COL.TIPO_EVENTO] || '',
  projeto: l[COL.PROJETO] || '',

  idContratante: idContratanteAtual,
  idCerimonialista: String(l[COL.ID_CERIMONIALISTA] || '').trim(),
  idEndereco: idEnderecoAtual,
  idVendedor: String(l[COL.ID_VENDEDOR] || '').trim(),
  idBV: String(l[COL.ID_BV] || '').trim(),
  nomeContratanteAtual: nomeContratanteAtual,
  nomeLocalAtual: nomeLocalAtual,
  nomeContratanteCadastro: nomeContratanteCadastro,
  nomeLocalCadastro: nomeLocalCadastro,
  referenciaContratanteOk: !idContratanteAtual || refContratanteExiste,
  referenciaEnderecoOk: !idEnderecoAtual || refEnderecoExiste,
  referenciaContratanteDivergente: !!refContratanteDivergente,
  referenciaEnderecoDivergente: !!refEnderecoDivergente,

  valorTotal: Number(l[COL.VALOR_TOTAL]) || 0,
  valorBV: Number(l[COL.VALOR_BV]) || 0,
  valorNF: Number(l[COL.VALOR_NF]) || 0,
  temNF: l[COL.TEM_NF] === true ? 'SIM' : 'NÃO',
  comissaoTipo: l[COL.COMISSAO_TIPO] || 'Padrão',
  comissaoValor: Number(l[COL.COMISSAO_VALOR]) || 0,

  look: l[COL.LOOK] || '',
  somResponsavel: l[COL.SOM_RESPONSAVEL] || '',
  observacoes: l[COL.OBSERVACOES] || '',
  statusGeral: String(l[COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase()
};

      return {
  sucesso: true,
  evento: evento,
  statusFinanceiro: calcularStatusFinanceiro(l)
};
    }

    return { sucesso: false, mensagem: 'Evento não encontrado' };

  } catch (erro) {
    Logger.log('🔥 ERRO buscarEventoParaEdicao: ' + erro.message);
    return { sucesso: false, mensagem: erro.message };
  }
}

/* =========================
   VALIDAR ALTERAÇÕES (NOVA!)
========================= */

function validarAlteracoesEvento(idEvento, dadosEditados) {
  exigirAcao('eventos:editar');
  Logger.log('═══════════════════════════════════════════════');
  Logger.log('📊 validarAlteracoesEvento / impacto financeiro');
  Logger.log('Evento: ' + idEvento);
  Logger.log('═══════════════════════════════════════════════');

  if (!idEvento) {
    return { sucesso: false, mensagem: 'ID do evento não informado' };
  }

  // Busca evento original
  const eventoOriginal = buscarEvento(idEvento);
  if (!eventoOriginal) {
    return { sucesso: false, mensagem: 'Evento original não encontrado' };
  }

  // Financeiro original (snapshot)
  const financeiroOriginal = calcularFinanceiroEvento({
    valorTotal: eventoOriginal.valorTotal,
    valorBV: eventoOriginal.valorBV || 0,
    temNF: eventoOriginal.temNF === true,
    comissaoTipo: eventoOriginal.comissaoTipo || 'Padrão',
    comissaoValor: eventoOriginal.comissaoValor || 0,
    percentualNF: eventoOriginal.percentualNF || 0
  });

  // Financeiro simulado após edição
  const valorTotalNovo = normalizarValorMonetario_(dadosEditados.valorTotal, { allowZero: false });
  const valorBVNovo = normalizarValorMonetario_(dadosEditados.valorBV, { allowZero: true });
  const linhaComissaoOriginal = [];
  linhaComissaoOriginal[COL.COMISSAO_TIPO] = eventoOriginal.comissaoTipo || 'Padrão';
  linhaComissaoOriginal[COL.COMISSAO_VALOR] = eventoOriginal.comissaoValor || 0;
  const regraComissaoNova = normalizarRegraComissaoEdicao_(
    dadosEditados || {},
    linhaComissaoOriginal,
    getUsuarioAtual()
  );

  const financeiroNovo = calcularFinanceiroEvento({
    valorTotal: valorTotalNovo !== null ? valorTotalNovo : eventoOriginal.valorTotal,
    valorBV: valorBVNovo !== null ? valorBVNovo : (eventoOriginal.valorBV || 0),
    temNF:
      dadosEditados.temNF === true ||
      dadosEditados.temNF === 'SIM'
        ? true
        : false,
    comissaoTipo: regraComissaoNova.tipo,
    comissaoValor: regraComissaoNova.valor,
    percentualNF: eventoOriginal.percentualNF || 0
  });

  // Diferenças
  const diffComissao =
    financeiroNovo.valorComissaoCalculado -
    financeiroOriginal.valorComissaoCalculado;

  const diffBase =
    financeiroNovo.baseComissao -
    financeiroOriginal.baseComissao;

  // Estatísticas atuais de comissão (histórico)
  const stats = calcularEstatisticasComissaoEvento(idEvento);

  let risco = 'OK';
  let alerta = '';

  if (stats.totalComissaoGerada > financeiroNovo.valorComissaoCalculado) {
    risco = 'EXCESSO_GERADO';
    alerta = '⚠️ Comissão já gerada é maior que a nova comissão calculada';
  }

  return {
    sucesso: true,
    impactoFinanceiro: {
      baseAnterior: financeiroOriginal.baseComissao,
      baseNova: financeiroNovo.baseComissao,
      diferencaBase: Number(diffBase.toFixed(2)),

      comissaoAnterior: financeiroOriginal.valorComissaoCalculado,
      comissaoNova: financeiroNovo.valorComissaoCalculado,
      diferencaComissao: Number(diffComissao.toFixed(2)),

      totalComissaoGerada: stats.totalComissaoGerada,
      totalComissaoPaga: stats.totalComissaoPaga,

      risco: risco,
      alerta: alerta
    },
    mensagem:
      diffComissao > 0
        ? 'A edição aumenta o valor total de comissão do evento'
        : diffComissao < 0
        ? 'A edição reduz o valor total de comissão do evento'
        : 'Edição sem impacto financeiro'
  };
}

/* =========================
   SALVAR EDIÇÃO
========================= */

// =========================
// MAPA DE COLUNAS MOVIMENTACOES FINANCEIRAS
// =========================
const COL_MOV = {
  ID_EVENTO: 3,
  VALOR: 6
};

/**
 * =====================================================
 * CONTROLE DE PERMISSÃO – EDIÇÃO FINANCEIRA
 * =====================================================
 * Regras:
 * - OWNER (Proprietário): sempre pode editar
 * - SOCIO: pode editar financeiro até X horas após criação
 * - Após comissão gerada ou prazo: financeiro bloqueado
 */
function verificarPermissaoEdicaoFinanceira(idEvento) {
  exigirAcao('eventos:editar');

  if (!idEvento) {
    return { permitido: false, bloqueio: 'ERRO_VALIDACAO', motivo: 'ID do evento não informado' };
  }

  const evento = buscarEvento(idEvento);
  if (!evento) {
    return { permitido: false, bloqueio: 'ERRO_VALIDACAO', motivo: 'Evento não encontrado' };
  }

  // =====================================================
  // 🔒 REGRA ÚNICA — EXISTE MOVIMENTAÇÃO FINANCEIRA
  // =====================================================
  const sheetMov = SpreadsheetApp.getActive().getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  if (!sheetMov) {
    return {
      permitido: true
    };
  }

  const dadosMov = sheetMov.getDataRange().getValues();
  const possuiMovimentacao = dadosMov.some((l, i) => {
    if (i === 0) return false;

    const eventoMov = String(l[COL_MOV.ID_EVENTO] || '').trim();
    const valor = Number(l[COL_MOV.VALOR]) || 0;

    return eventoMov === String(idEvento) && valor !== 0;
  });

  if (possuiMovimentacao) {
    return {
      permitido: false,
      bloqueio: 'MOVIMENTACAO_FINANCEIRA',
      motivo: 'Evento possui movimentações financeiras registradas.'
    };
  }

  return { permitido: true };
}

function normalizarPerfilComissaoEdicao_(perfil) {
  return String(perfil || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizarRegraComissaoEdicao_(dadosFormulario, linhaAtual, usuario) {
  const tipoAtual = String(linhaAtual[COL.COMISSAO_TIPO] || 'Padrão').trim() || 'Padrão';
  const valorAtual = Number(linhaAtual[COL.COMISSAO_VALOR]) || 0;
  const recebeuTipo = Object.prototype.hasOwnProperty.call(dadosFormulario || {}, 'comissaoTipo');
  const tipoSolicitado = recebeuTipo
    ? String(dadosFormulario.comissaoTipo || '').trim()
    : tipoAtual;
  const tipoFinal = tipoSolicitado || tipoAtual;
  const tiposValidos = ['Padrão', 'Percentual', 'Fixo', 'Sem Comissão'];

  if (!tiposValidos.includes(tipoFinal)) {
    throw new Error('Tipo de comissão inválido.');
  }

  const perfilNorm = normalizarPerfilComissaoEdicao_((usuario && usuario.PERFIL) || '');
  const proprietario = perfilNorm === 'proprietario';
  const tipoCustom = tipoFinal === 'Percentual' || tipoFinal === 'Fixo';
  const tipoAtualCustom = tipoAtual === 'Percentual' || tipoAtual === 'Fixo';
  const valorCustomSolicitado = tipoCustom
    ? (tipoFinal === 'Fixo'
        ? normalizarValorMonetario_(dadosFormulario.comissaoValor, { allowZero: true })
        : normalizarNumeroEntrada_(dadosFormulario.comissaoValor, {
            decimals: 2,
            allowNegative: false,
            allowZero: true
          }))
    : null;
  const preservandoCustomExistente =
    tipoCustom &&
    tipoFinal === tipoAtual &&
    (
      !Object.prototype.hasOwnProperty.call(dadosFormulario || {}, 'comissaoValor') ||
      Math.abs((Number(valorCustomSolicitado) || 0) - valorAtual) < 0.0001
    );

  if (!proprietario && tipoCustom && !preservandoCustomExistente) {
    throw new Error('Apenas proprietário pode definir comissão fixa ou percentual customizada.');
  }

  if (!proprietario && tipoAtualCustom && tipoFinal !== tipoAtual && tipoFinal !== 'Sem Comissão') {
    throw new Error('Comissão customizada só pode ser mantida ou alterada para Sem Comissão por esta conta.');
  }

  if (tipoFinal === 'Padrão') {
    return {
      tipo: 'Padrão',
      valor: Number(obterConfig('COMISSAO_PADRAO_PERCENTUAL')) || 0
    };
  }

  if (tipoFinal === 'Sem Comissão') {
    return { tipo: 'Sem Comissão', valor: 0 };
  }

  if (preservandoCustomExistente) {
    return { tipo: tipoAtual, valor: valorAtual };
  }

  const valor = valorCustomSolicitado;

  if (valor === null || isNaN(valor)) {
    throw new Error('Valor da comissão inválido.');
  }

  return { tipo: tipoFinal, valor: valor };
}

function salvarEdicaoEvento(idEvento, dadosFormulario, email) {
  exigirAcao('eventos:editar');
  Logger.log('═══════════════════════════════════════════════');
  Logger.log('💾 salvarEdicaoEvento: ' + idEvento);
  Logger.log('═══════════════════════════════════════════════');

  // 🔁 NORMALIZAÇÃO DEFINITIVA — edição recebe dados achatados (igual cadastro)
  const dados = {
    dataEvento: dadosFormulario.dataEvento || arguments[1]?.dataEvento,
    dataFim: dadosFormulario.dataFim || arguments[1]?.dataFim,
    horaInicio: dadosFormulario.horaInicio || arguments[1]?.horaInicio,
    duracao: dadosFormulario.duracao || arguments[1]?.duracao,
    tipoEvento: dadosFormulario.tipoEvento || arguments[1]?.tipoEvento,
    projeto: dadosFormulario.projeto || arguments[1]?.projeto,

    idContratante: dadosFormulario.idContratante || arguments[1]?.idContratante,
    idCerimonialista: dadosFormulario.idCerimonialista || arguments[1]?.idCerimonialista,
    idEndereco: dadosFormulario.idEndereco || arguments[1]?.idEndereco,
    idVendedor: dadosFormulario.idVendedor || arguments[1]?.idVendedor,
    idBV: dadosFormulario.idBV || arguments[1]?.idBV,
    nomeContratanteEditado: dadosFormulario.nomeContratanteEditado || dadosFormulario.nomeContratante || arguments[1]?.nomeContratanteEditado,
    nomeLocalEditado: dadosFormulario.nomeLocalEditado || dadosFormulario.nomeLocal || arguments[1]?.nomeLocalEditado,
    nomeContratanteFallback: dadosFormulario.nomeContratanteFallback || arguments[1]?.nomeContratanteFallback,
    nomeLocalFallback: dadosFormulario.nomeLocalFallback || arguments[1]?.nomeLocalFallback,
    aplicarNomeContratanteNoMestre:
      dadosFormulario.aplicarNomeContratanteNoMestre === true ||
      dadosFormulario.aplicarNomeContratanteNoMestre === 'true' ||
      dadosFormulario.aplicarNomeContratanteNoMestre === '1',
    aplicarNomeLocalNoMestre:
      dadosFormulario.aplicarNomeLocalNoMestre === true ||
      dadosFormulario.aplicarNomeLocalNoMestre === 'true' ||
      dadosFormulario.aplicarNomeLocalNoMestre === '1',

    valorTotal: (function() {
      const parsed = normalizarValorMonetario_(dadosFormulario.valorTotal ?? arguments[1]?.valorTotal, { allowZero: false });
      return parsed !== null ? parsed : 0;
    })(),
    valorBV: (function() {
      const parsed = normalizarValorMonetario_(dadosFormulario.valorBV ?? arguments[1]?.valorBV, { allowZero: true });
      return parsed !== null ? parsed : 0;
    })(),

    // 🔑 AQUI ESTAVA O BUG
    temNF:
      dadosFormulario.temNF === true ||
      dadosFormulario.temNF === 'SIM' ||
      dadosFormulario.temNF === 'TRUE',

    look: dadosFormulario.look || arguments[1]?.look,
    somResponsavel: dadosFormulario.somResponsavel || arguments[1]?.somResponsavel,
    // Permite limpar observações com string vazia sem cair no fallback antigo.
    observacoes: Object.prototype.hasOwnProperty.call(dadosFormulario || {}, 'observacoes')
      ? dadosFormulario.observacoes
      : arguments[1]?.observacoes
  };

  const converterReserva =
    dadosFormulario.converterReserva === true ||
    dadosFormulario.converterReserva === 'true' ||
    dadosFormulario.converterReserva === '1';

  // 1) Log explícito para depuração de NF
  Logger.log('DEBUG NF — recebido:', dadosFormulario.temNF, 'normalizado:', dados.temNF);

  // Normaliza o email do executor
  const emailExecutor = email || (getUsuarioAtual()?.email) || (getUsuarioAtual()?.EMAIL) || 'SYSTEM';

  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName('EVENTOS');
    if (!sheet) {
      return { sucesso: false, mensagem: 'Planilha EVENTOS não encontrada' };
    }

    const dadosSheet = sheet.getDataRange().getValues();
    let linhaIndex = -1;

    for (let i = 1; i < dadosSheet.length; i++) {
      if (String(dadosSheet[i][COL.ID_EVENTO]) === String(idEvento)) {
        linhaIndex = i;
        break;
      }
    }

    if (linhaIndex === -1) {
      Logger.log('❌ Evento não encontrado');
      return { sucesso: false, mensagem: 'Evento não encontrado' };
    }

    Logger.log('✅ Evento encontrado na linha ' + (linhaIndex + 1));

    const linha = dadosSheet[linhaIndex];
    const linhaOriginal = linha.slice();
    const tipoRegistroAtual = String(linha[COL.TIPO_REGISTRO] || 'Evento').trim() || 'Evento';
    const estaConvertendoReserva = converterReserva && tipoRegistroAtual === 'Reserva';

    if (estaConvertendoReserva) {
      if (!dados.tipoEvento) {
        throw new Error('Para converter reserva em evento, selecione o Tipo de Evento.');
      }
      if (!dados.idVendedor) {
        throw new Error('Para converter reserva em evento, selecione o Vendedor.');
      }
      if (!(Number(dados.valorTotal) > 0)) {
        throw new Error('Para converter reserva em evento, informe um Valor Total maior que zero.');
      }
      if (!String(dados.idContratante || '').trim()) {
        throw new Error('Para converter reserva em evento, regularize o Contratante (vínculo por ID).');
      }
      if (!String(dados.idEndereco || '').trim()) {
        throw new Error('Para converter reserva em evento, regularize o Local (vínculo por ID).');
      }
      linha[COL.TIPO_REGISTRO] = 'Evento';
      linha[COL.COMISSAO_TIPO] = 'Padrão';
      linha[COL.COMISSAO_VALOR] = Number(obterConfig('COMISSAO_PADRAO_PERCENTUAL')) || 0;
    }

    const tipoRegistroFinal = String(linha[COL.TIPO_REGISTRO] || tipoRegistroAtual || 'Evento').trim() || 'Evento';
    const ehEventoFinal = tipoRegistroFinal === 'Evento';

    // ================================
    // DETECTAR ATIVAÇÃO DE NF / BV NA EDIÇÃO
    // ================================
    // Normalização explícita de NF (boolean definitivo)
    // NF normalizada é a fonte da verdade
    linha[COL.TEM_NF] = ehEventoFinal ? (dados.temNF === true) : false;

    // DATA EVENTO
    if (dados.dataEvento) {
      const [ano, mes, dia] = dados.dataEvento.split('-').map(Number);
      linha[COL.DATA_EVENTO] = new Date(ano, mes - 1, dia);
    }

    // DATA FIM
    if (dados.dataFim) {
      const [ano, mes, dia] = dados.dataFim.split('-').map(Number);
      linha[COL.DATA_FIM] = new Date(ano, mes - 1, dia);
    } else {
      linha[COL.DATA_FIM] = '';
    }

    // HORA
    if (dados.horaInicio) {
      linha[COL.HORA_INICIO] = dados.horaInicio;
    }

    // Outros campos
    linha[COL.DURACAO] = dados.duracao || '';
    linha[COL.TIPO_EVENTO] = (ehEventoFinal || tipoRegistroFinal === 'Reserva')
      ? (dados.tipoEvento || linha[COL.TIPO_EVENTO] || '')
      : '';
    linha[COL.PROJETO] = (ehEventoFinal || tipoRegistroFinal === 'Reserva')
      ? (dados.projeto || '')
      : '';

    // IDs + ESPELHAMENTO DE NOMES (resiliente: nunca apagar por referência ausente)
    const refContratante = resolverReferenciaMestreEdicao_({
      aba: 'CONTRATANTES',
      idNovo: dados.idContratante,
      idAtual: linha[COL.ID_CONTRATANTE],
      nomeAtual: linha[COL.NOME_CONTRATANTE],
      nomeFallback: dados.nomeContratanteFallback
    });
    linha[COL.ID_CONTRATANTE] = refContratante.id;
    linha[COL.NOME_CONTRATANTE] = refContratante.nome;

    const nomeContratanteDigitado = String(dados.nomeContratanteEditado || '').trim();
    if (nomeContratanteDigitado) {
      linha[COL.NOME_CONTRATANTE] = nomeContratanteDigitado;
      if (linha[COL.ID_CONTRATANTE] && dados.aplicarNomeContratanteNoMestre) {
        atualizarNomeNaAbaMestrePorId_('CONTRATANTES', linha[COL.ID_CONTRATANTE], nomeContratanteDigitado);
      }
    }

    const permiteCerimonialista = ehEventoFinal || tipoRegistroFinal === 'Reserva' || tipoRegistroFinal === 'Reunião';
    linha[COL.ID_CERIMONIALISTA] = permiteCerimonialista ? (dados.idCerimonialista || '') : '';
    linha[COL.NOME_CERIMONIALISTA] = (permiteCerimonialista && dados.idCerimonialista)
      ? buscarNomePorId('CERIMONIALISTAS', dados.idCerimonialista)
      : '';

    const refEndereco = resolverReferenciaMestreEdicao_({
      aba: 'ENDERECOS',
      idNovo: dados.idEndereco,
      idAtual: linha[COL.ID_ENDERECO],
      nomeAtual: linha[COL.LOCAL],
      nomeFallback: dados.nomeLocalFallback
    });
    linha[COL.ID_ENDERECO] = refEndereco.id;
    linha[COL.LOCAL] = refEndereco.nome;

    const nomeLocalDigitado = String(dados.nomeLocalEditado || '').trim();
    if (nomeLocalDigitado) {
      linha[COL.LOCAL] = nomeLocalDigitado;
      if (linha[COL.ID_ENDERECO] && dados.aplicarNomeLocalNoMestre) {
        atualizarNomeNaAbaMestrePorId_('ENDERECOS', linha[COL.ID_ENDERECO], nomeLocalDigitado);
      }
    }

    linha[COL.ID_VENDEDOR] = ehEventoFinal ? (dados.idVendedor || '') : '';
    linha[COL.ID_BV] = ehEventoFinal ? (dados.idBV || '') : '';
    linha[COL.NOME_VENDEDOR] = (ehEventoFinal && linha[COL.ID_VENDEDOR])
      ? buscarNomePorId('VENDEDORES', linha[COL.ID_VENDEDOR])
      : '';

    if (ehEventoFinal) {
      if (!linha[COL.COMISSAO_TIPO] || String(linha[COL.COMISSAO_TIPO]).trim() === 'N/A') {
        linha[COL.COMISSAO_TIPO] = 'Padrão';
      }
      if (!linha[COL.COMISSAO_VALOR] || Number(linha[COL.COMISSAO_VALOR]) <= 0) {
        linha[COL.COMISSAO_VALOR] = Number(obterConfig('COMISSAO_PADRAO_PERCENTUAL')) || 0;
      }
    }

    if (ehEventoFinal) {
      // ───────── CONTROLE DE EDIÇÃO FINANCEIRA ─────────
      let podeAlterarFinanceiro = false;
      let permissaoFinanceira = verificarPermissaoEdicaoFinanceira(idEvento);
      const usuario = getUsuarioAtual();
      if (usuario.PERFIL === 'Proprietário') {
        podeAlterarFinanceiro = permissaoFinanceira.permitido;
      } else {
        podeAlterarFinanceiro = permissaoFinanceira.permitido;
      }

      if (podeAlterarFinanceiro || estaConvertendoReserva) {
        const querBVAgora = Number(dados.valorBV) > 0;
        const regraComissao = normalizarRegraComissaoEdicao_(dadosFormulario, linha, usuario);

        linha[COL.VALOR_TOTAL] = Number(dados.valorTotal) || linha[COL.VALOR_TOTAL];
        linha[COL.VALOR_RECEBIDO] = Number(linha[COL.VALOR_RECEBIDO]) || 0;
        linha[COL.VALOR_PENDENTE] = Math.max(0, Number(linha[COL.VALOR_TOTAL]) - Number(linha[COL.VALOR_RECEBIDO]));
        linha[COL.COMISSAO_TIPO] = regraComissao.tipo;
        linha[COL.COMISSAO_VALOR] = regraComissao.valor;

        if (querBVAgora) {
          linha[COL.VALOR_BV] = Number(dados.valorBV);
          linha[COL.ID_BV] = dados.idBV || '';
        } else {
          linha[COL.VALOR_BV] = 0;
          linha[COL.ID_BV] = '';
        }

        linha[COL.VALOR_COMISSAO_CALCULADO] = null;
        linha[COL.STATUS_BV] = null;
        linha[COL.STATUS_COMISSAO] = null;

        if (linha[COL.ID_BV]) {
          linha[COL.NOME_BV] = buscarNomePorId('PARCEIROS_BV', linha[COL.ID_BV]);
        } else {
          linha[COL.NOME_BV] = '';
        }
      } else {
        Logger.log('🔒 Financeiro bloqueado: ' + permissaoFinanceira.motivo);
      }

      // 🔁 BLOCO FINANCEIRO DEFINITIVO (somente Evento)
      const percentualNFConfig = Number(obterConfig('NF_PERCENTUAL')) || 0;
      const financeiro = calcularFinanceiroEvento({
        valorTotal: Number(linha[COL.VALOR_TOTAL]) || 0,
        valorBV: Number(linha[COL.VALOR_BV]) || 0,
        temNF: linha[COL.TEM_NF] === true,
        percentualNF: linha[COL.TEM_NF] === true ? percentualNFConfig : 0,
        comissaoTipo: linha[COL.COMISSAO_TIPO],
        comissaoValor: linha[COL.COMISSAO_VALOR]
      });

      linha[COL.VALOR_NF] = Number(financeiro.valorNF) || 0;
      linha[COL.STATUS_NF] = financeiro.statusNF || 'N/A';
      linha[COL.VALOR_COMISSAO_CALCULADO] = financeiro.valorComissaoCalculado || 0;
      linha[COL.STATUS_COMISSAO] = financeiro.statusComissao || 'N/A';
      linha[COL.STATUS_BV] = financeiro.statusBV || 'N/A';
      const valorRecebidoAtual = Number(linha[COL.VALOR_RECEBIDO]) || 0;
      const valorPendenteAtual = Number(linha[COL.VALOR_PENDENTE]) || 0;
      if (valorPendenteAtual <= 0) {
        linha[COL.STATUS_RECEBIMENTO] = 'QUITADO';
      } else if (valorRecebidoAtual > 0) {
        linha[COL.STATUS_RECEBIMENTO] = 'PARCIAL';
      } else {
        linha[COL.STATUS_RECEBIMENTO] = 'EM_ABERTO';
      }
    } else {
      // Tipos não financeiros: limpa espelho financeiro para evitar poluição.
      linha[COL.VALOR_TOTAL] = 0;
      linha[COL.VALOR_RECEBIDO] = 0;
      linha[COL.VALOR_PENDENTE] = 0;
      linha[COL.STATUS_RECEBIMENTO] = 'N/A';
      linha[COL.ID_VENDEDOR] = '';
      linha[COL.NOME_VENDEDOR] = '';
      linha[COL.COMISSAO_TIPO] = 'N/A';
      linha[COL.COMISSAO_VALOR] = '';
      linha[COL.VALOR_COMISSAO_CALCULADO] = 0;
      linha[COL.VALOR_COMISSAO_PAGO] = 0;
      linha[COL.STATUS_COMISSAO] = 'N/A';
      linha[COL.ID_BV] = '';
      linha[COL.NOME_BV] = '';
      linha[COL.VALOR_BV] = 0;
      linha[COL.STATUS_BV] = 'N/A';
      linha[COL.BV_DATA_PAGAMENTO] = '';
      linha[COL.TEM_NF] = false;
      linha[COL.VALOR_NF] = 0;
      linha[COL.STATUS_NF] = 'N/A';
    }

    // Outros
    linha[COL.LOOK] = dados.look || '';
    linha[COL.SOM_RESPONSAVEL] = dados.somResponsavel || '';
    linha[COL.OBSERVACOES] = dados.observacoes || '';

    // Auditoria
    linha[COL.ULTIMA_EDICAO] = new Date();
    linha[COL.EDITADO_POR] = emailExecutor;

    // Salvar
    sheet.getRange(linhaIndex + 1, 1, 1, linha.length).setValues([linha]);

    // =====================================================
    // GARANTIA DE MOVIMENTAÇÕES NF / BV (EDIÇÃO DE EVENTO)
    // - Não duplica
    // - Apenas garante existência e espelho correto
    // =====================================================
    const eventoAtualizado = {
      idEvento: linha[COL.ID_EVENTO],
      tipoEvento: linha[COL.TIPO_EVENTO],
      nomeContratante: linha[COL.NOME_CONTRATANTE],
      temNF: linha[COL.TEM_NF] === true,
      valorNF: Number(linha[COL.VALOR_NF]) || 0,
      valorBV: Number(linha[COL.VALOR_BV]) || 0,
      idBV: linha[COL.ID_BV],
      nomeBV: linha[COL.NOME_BV]
    };

    if (
      ehEventoFinal &&
      (
        (eventoAtualizado.temNF && eventoAtualizado.valorNF > 0) ||
        (eventoAtualizado.valorBV > 0)
      )
    ) {
      garantirMovimentacoesNF_BV(eventoAtualizado, emailExecutor);
    }

    const alteracoesEvento = resumirAlteracoesEdicaoEvento_(linhaOriginal, linha);

    registrarLog(
      'EDITAR',
      'EVENTOS',
      String(linha[COL.ID_EVENTO] || idEvento || ''),
      JSON.stringify({
        alteracoes: alteracoesEvento,
        origem: 'salvarEdicaoEvento',
        editor: String(emailExecutor || '')
      })
    );

    Logger.log('✅ Evento salvo com sucesso!');

    // Retorno padronizado de sucesso (conforme instrução)
    return {
      sucesso: true,
      mensagem: 'Evento atualizado com sucesso',
      eventoId: linha[COL.ID_EVENTO],
      alteracoes: alteracoesEvento
    };

  } catch (erro) {
    Logger.log('🔥 ERRO ao salvar: ' + (erro && erro.message ? erro.message : erro));
    return {
      sucesso: false,
      mensagem: erro && erro.message ? erro.message : 'Erro inesperado ao salvar evento'
    };
  }
}

function resumirAlteracoesEdicaoEvento_(antes, depois) {
  const campos = [
    { k: 'tipoRegistro', i: COL.TIPO_REGISTRO },
    { k: 'dataEvento', i: COL.DATA_EVENTO },
    { k: 'dataFim', i: COL.DATA_FIM },
    { k: 'horaInicio', i: COL.HORA_INICIO },
    { k: 'duracao', i: COL.DURACAO },
    { k: 'tipoEvento', i: COL.TIPO_EVENTO },
    { k: 'projeto', i: COL.PROJETO },
    { k: 'idContratante', i: COL.ID_CONTRATANTE },
    { k: 'contratante', i: COL.NOME_CONTRATANTE },
    { k: 'idEndereco', i: COL.ID_ENDERECO },
    { k: 'local', i: COL.LOCAL },
    { k: 'idCerimonialista', i: COL.ID_CERIMONIALISTA },
    { k: 'cerimonialista', i: COL.NOME_CERIMONIALISTA },
    { k: 'idVendedor', i: COL.ID_VENDEDOR },
    { k: 'vendedor', i: COL.NOME_VENDEDOR },
    { k: 'idBV', i: COL.ID_BV },
    { k: 'nomeBV', i: COL.NOME_BV },
    { k: 'valorTotal', i: COL.VALOR_TOTAL },
    { k: 'valorBV', i: COL.VALOR_BV },
    { k: 'temNF', i: COL.TEM_NF },
    { k: 'valorNF', i: COL.VALOR_NF },
    { k: 'look', i: COL.LOOK },
    { k: 'somResponsavel', i: COL.SOM_RESPONSAVEL },
    { k: 'statusGeral', i: COL.STATUS_GERAL },
    { k: 'observacoes', i: COL.OBSERVACOES }
  ];

  const delta = [];
  for (let i = 0; i < campos.length; i++) {
    const campo = campos[i];
    const de = normalizarValorAuditoriaEdicao_(antes[campo.i]);
    const para = normalizarValorAuditoriaEdicao_(depois[campo.i]);
    if (de === para) continue;
    delta.push({ campo: campo.k, de: de, para: para });
    if (delta.length >= 30) break;
  }

  return delta;
}

function normalizarValorAuditoriaEdicao_(valor) {
  if (valor === null || typeof valor === 'undefined') return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    if (isNaN(valor.getTime())) return '';
    return Utilities.formatDate(
      valor,
      Session.getScriptTimeZone() || 'America/Fortaleza',
      "yyyy-MM-dd'T'HH:mm:ss"
    );
  }
  if (typeof valor === 'number') {
    if (isNaN(valor)) return '';
    return String(Number(valor.toFixed(2)));
  }
  if (typeof valor === 'boolean') return valor ? 'true' : 'false';
  const txt = String(valor).trim();
  return txt.length > 180 ? (txt.slice(0, 177) + '...') : txt;
}

function cancelarEvento(idEvento, motivo) {
  exigirAcao('eventos:cancelar');

  const alvo = String(idEvento || '').trim();
  if (!alvo) {
    return { sucesso: false, mensagem: 'ID do evento não informado' };
  }

  const motivoLimpo = String(motivo || '').trim();
  if (!motivoLimpo) {
    return { sucesso: false, mensagem: 'Informe o motivo do cancelamento.' };
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName('EVENTOS');
    if (!sheet) return { sucesso: false, mensagem: 'Planilha EVENTOS não encontrada' };

    const dados = sheet.getDataRange().getValues();
    let linhaIndex = -1;
    for (let i = 1; i < dados.length; i++) {
      if (String(dados[i][COL.ID_EVENTO] || '').trim() === alvo) {
        linhaIndex = i;
        break;
      }
    }
    if (linhaIndex === -1) {
      return { sucesso: false, mensagem: 'Evento não encontrado' };
    }

    const linha = dados[linhaIndex];
    const tipoRegistro = String(linha[COL.TIPO_REGISTRO] || 'Evento').trim();
    const statusAtual = String(linha[COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase();
    if (statusAtual === 'CANCELADO') {
      return { sucesso: true, jaCancelado: true, mensagem: 'Registro já está cancelado.' };
    }

    if (tipoRegistro === 'Evento' && temMovimentacaoFinanceiraAtivaPorEvento_(alvo)) {
      return {
        sucesso: false,
        bloqueio: 'EVENTO_COM_MOVIMENTACAO_FINANCEIRA',
        mensagem: 'Não é possível cancelar evento com movimentações financeiras. Use fluxo financeiro (estorno/ajustes).'
      };
    }

    const usuario = (getUsuarioAtual() && getUsuarioAtual().email) || 'SISTEMA';
    const dataTxt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Fortaleza', 'dd/MM/yyyy HH:mm:ss');
    const blocoCancelamento =
      `[CANCELADO ${dataTxt} por ${usuario}] Motivo: ${motivoLimpo}`;
    const obsAtual = String(linha[COL.OBSERVACOES] || '').trim();

    linha[COL.STATUS_GERAL] = 'CANCELADO';
    linha[COL.OBSERVACOES] = obsAtual ? `${obsAtual} | ${blocoCancelamento}` : blocoCancelamento;
    linha[COL.ULTIMA_EDICAO] = new Date();
    linha[COL.EDITADO_POR] = usuario;

    sheet.getRange(linhaIndex + 1, 1, 1, linha.length).setValues([linha]);

    registrarLog(
      'CANCELAR',
      'EVENTOS',
      alvo,
      `tipo=${tipoRegistro}; motivo=${motivoLimpo}; status_anterior=${statusAtual}; usuario=${usuario}`
    );

    return {
      sucesso: true,
      mensagem: 'Registro cancelado com sucesso.',
      idEvento: alvo,
      tipoRegistro: tipoRegistro
    };
  } catch (err) {
    return {
      sucesso: false,
      mensagem: String(err && err.message ? err.message : err)
    };
  }
}

function temMovimentacaoFinanceiraAtivaPorEvento_(idEvento) {
  const shMov = SpreadsheetApp.getActive().getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  if (!shMov) return false;

  const data = shMov.getDataRange().getValues();
  if (!data || data.length < 2) return false;

  const head = data[0];
  const idx = function (nome) { return head.indexOf(nome); };
  const iEvento = idx('ID_EVENTO');
  const iStatus = idx('STATUS');
  if (iEvento === -1) return false;

  const alvo = String(idEvento || '').trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iEvento] || '').trim() !== alvo) continue;
    const st = iStatus >= 0 ? String(data[i][iStatus] || '').trim().toUpperCase() : 'PROCESSADO';
    if (st !== 'CANCELADO') return true;
  }

  return false;
}

function referenciaExisteNaAbaPorId_(nomeAba, id) {
  const alvo = String(id || '').trim();
  if (!alvo) return false;
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(nomeAba);
    if (!sh) return false;
    const dados = sh.getDataRange().getValues();
    for (let i = 1; i < dados.length; i++) {
      if (String(dados[i][0] || '').trim() === alvo) return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function resolverReferenciaMestreEdicao_(ctx) {
  const aba = String((ctx && ctx.aba) || '').trim();
  const idNovo = String((ctx && ctx.idNovo) || '').trim();
  const idAtual = String((ctx && ctx.idAtual) || '').trim();
  const nomeAtual = String((ctx && ctx.nomeAtual) || '').trim();
  const nomeFallback = String((ctx && ctx.nomeFallback) || '').trim();

  if (idNovo) {
    const nomeLookup = String(buscarNomePorId(aba, idNovo) || '').trim();

    // Se não houve troca de ID e o nome no EVENTOS diverge do mestre, preserva texto atual.
    // Isso evita "troca silenciosa" de nome/local em registros legados.
    if (
      idAtual &&
      idNovo === idAtual &&
      nomeAtual &&
      nomeLookup &&
      normalizarTextoComparacao_(nomeAtual) !== normalizarTextoComparacao_(nomeLookup)
    ) {
      return { id: idAtual, nome: nomeAtual };
    }

    if (nomeLookup) {
      return { id: idNovo, nome: nomeLookup };
    }
    // Referência fora do mestre: preserva texto para evitar zerar espelho.
    return { id: idNovo, nome: nomeFallback || nomeAtual };
  }

  // Sem seleção nova: mantém referência atual para evitar falso positivo de limpeza.
  return { id: idAtual, nome: nomeFallback || nomeAtual };
}

function normalizarTextoComparacao_(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function atualizarNomeNaAbaMestrePorId_(nomeAba, id, nomeNovo) {
  const aba = String(nomeAba || '').trim();
  const alvoId = String(id || '').trim();
  const novoNome = String(nomeNovo || '').trim();
  if (!aba || !alvoId || !novoNome) return false;

  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(aba);
    if (!sh) return false;
    const dados = sh.getDataRange().getValues();
    for (let i = 1; i < dados.length; i++) {
      if (String(dados[i][0] || '').trim() === alvoId) {
        sh.getRange(i + 1, 2).setValue(novoNome);
        return true;
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

/* =========================
   LISTAR PARA DROPDOWNS (NOVAS!)
========================= */
/* FUNÇÃO DUPLICADA
function listarContratantesLegacyEdicao_() {
  Logger.log('📋 listarContratantes');
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName('CONTRATANTES');
    if (!sheet) return [];

    const dados = sheet.getDataRange().getValues();
    const lista = [];

    for (let i = 1; i < dados.length; i++) {
      const id = dados[i][0]; // Coluna A
      const nome = dados[i][1]; // Coluna B
      if (id && nome) {
        lista.push({ id: String(id), nome: String(nome) });
      }
    }

    Logger.log('✅ ' + lista.length + ' contratantes');
    return lista;
  } catch (erro) {
    Logger.log('❌ Erro: ' + erro.message);
    return [];
  }
}

*/
/*
function listarCerimonialistasLegacyEdicao_() {
  Logger.log('📋 listarCerimonialistas');
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName('CERIMONIALISTAS');
    if (!sheet) return [];

    const dados = sheet.getDataRange().getValues();
    const lista = [];

    for (let i = 1; i < dados.length; i++) {
      const id = dados[i][0];
      const nome = dados[i][1];
      if (id && nome) {
        lista.push({ id: String(id), nome: String(nome) });
      }
    }

    Logger.log('✅ ' + lista.length + ' cerimonialistas');
    return lista;
  } catch (erro) {
    Logger.log('❌ Erro: ' + erro.message);
    return [];
  }
}
  */

/* FUNÇÃO DUPLICADA

function listarEnderecosLegacyEdicao_() {
  Logger.log('📋 listarEnderecos');
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName('ENDERECOS');
    if (!sheet) return [];

    const dados = sheet.getDataRange().getValues();
    const lista = [];

    for (let i = 1; i < dados.length; i++) {
      const id = dados[i][0];
      const local = dados[i][1]; // Nome do local
      if (id && local) {
        lista.push({ id: String(id), nome: String(local) });
      }
    }

    Logger.log('✅ ' + lista.length + ' endereços');
    return lista;
  } catch (erro) {
    Logger.log('❌ Erro: ' + erro.message);
    return [];
  }
}
  */

/* JÁ EXISTE ESSA FUNÇÃO EM UTILS
function listarVendedoresLegacyEdicao_() {
  Logger.log('📋 listarVendedores');
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName('VENDEDORES');
    if (!sheet) return [];

    const dados = sheet.getDataRange().getValues();
    const lista = [];

    for (let i = 1; i < dados.length; i++) {
      const id = dados[i][0];
      const nome = dados[i][1];
      if (id && nome) {
        lista.push({ id: String(id), nome: String(nome) });
      }
    }

    Logger.log('✅ ' + lista.length + ' vendedores');
    return lista;
  } catch (erro) {
    Logger.log('❌ Erro: ' + erro.message);
    return [];
  }
}

*/

/* funcao duplicada

function listarParceirosBVLegacyEdicao_() {
  Logger.log('📋 listarParceirosBV');
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName('PARCEIROS_BV');
    if (!sheet) return [];

    const dados = sheet.getDataRange().getValues();
    const lista = [];

    for (let i = 1; i < dados.length; i++) {
      const id = dados[i][0];
      const nome = dados[i][1];
      if (id && nome) {
        lista.push({ id: String(id), nome: String(nome) });
      }
    }

    Logger.log('✅ ' + lista.length + ' parceiros BV');
    return lista;
  } catch (erro) {
    Logger.log('❌ Erro: ' + erro.message);
    return [];
  }
}
*/

/* =========================
   AUXILIARES
========================= */

function mapEventoResumo(l) {
  const dataNormalizada = normalizarData(l[COL.DATA_EVENTO]);
  let horaInicio = '';
  const horaRaw = l[COL.HORA_INICIO];
  if (horaRaw instanceof Date) {
    horaInicio = Utilities.formatDate(horaRaw, Session.getScriptTimeZone() || 'America/Fortaleza', 'HH:mm');
  } else if (typeof horaRaw === 'string') {
    horaInicio = horaRaw.trim();
  }

  return {
    id: l[COL.ID_EVENTO],
    tipoRegistro: l[COL.TIPO_REGISTRO] || 'Evento',
    tipoEvento: l[COL.TIPO_EVENTO] || '',
    contratante: l[COL.NOME_CONTRATANTE] || '—',
    local: l[COL.LOCAL] || '',
    horaInicio: horaInicio,
    duracao: Number(l[COL.DURACAO]) || 0,
    valor: l[COL.VALOR_TOTAL] || 0,
    statusGeral: String(l[COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase(),
    dataFormatada: dataNormalizada
      ? Utilities.formatDate(dataNormalizada, 'GMT-3', 'dd/MM/yyyy')
      : ''
  };
}

function formatarDataISO(valor) {
  if (!valor) return '';

  // Date do Sheets
  if (valor instanceof Date) {
    const y = valor.getFullYear();
    const m = String(valor.getMonth() + 1).padStart(2, '0');
    const d = String(valor.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Já está no formato correto
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return valor;
  }

  // dd/mm/yyyy
  if (typeof valor === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(valor)) {
    const [d, m, y] = valor.split('/');
    return `${y}-${m}-${d}`;
  }

  return '';
}

function calcularStatusFinanceiro(l) {
  const total = Number(l[COL.VALOR_TOTAL]) || 0;
  const bv = Number(l[COL.VALOR_BV]) || 0;
  const nf = Number(l[COL.VALOR_NF]) || 0;

  if (total > 0 && nf > total) {
    return { tipo: 'bloqueado', mensagem: 'NF maior que o valor total.' };
  }
  if (bv > 0) {
    return { tipo: 'atencao', mensagem: 'Evento possui BV.' };
  }
  return { tipo: 'safe', mensagem: 'Evento liberado para edição.' };
}

/* =========================
   FUNÇÕES CONFIG
========================= */

function obterConfigLegacyEdicao_(chave) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('CONFIG');
  
  if (!sheet) return null;
  
  const dados = sheet.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] === chave) {
      return dados[i][1];
    }
  }
  return null;
}

function listarTiposEventoLegacyEdicao_() {
  const valor = obterConfig('TIPOS_EVENTO');
  if (!valor) return ['Casamento', 'Aniversário', 'Formatura', 'Corporativo', 'Festa', 'Outro'];
  return String(valor).split(';').map(function(t) { return t.trim(); }).filter(function(t) { return t; });
}

function listarDuracoesPadraoLegacyEdicao_() {
  const valor = obterConfig('DURACOES_PADRAO');
  if (!valor) return ['60','90','120','150','180','210','240'];
  return String(valor).split(';').map(function(d) { return d.trim(); }).filter(function(d) { return d; });
}

function listarProjetosSugeridosLegacyEdicao_() {
  const valor = obterConfig('PROJETOS_SUGERIDOS');
  if (!valor) return ['Banda Completa', 'Banda Reduzida', 'Banda Personalizada'];
  return String(valor).split(';').map(function(p) { return p.trim(); }).filter(function(p) { return p; });
}

/* =========================
   CADASTRO RÁPIDO CONTRATANTE
========================= */

function cadastrarContratanteRapidoLegacyEdicao_(dados) {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName('PESSOAS');
    
    if (!sheet) {
      return { sucesso: false, mensagem: 'Aba PESSOAS não encontrada' };
    }
    
    // Gerar ID único
    const proximaLinha = sheet.getLastRow() + 1;
    const id = 'CONT-' + String(proximaLinha).padStart(4, '0');
    
    // Adicionar nova linha
    sheet.appendRow([
      id,                    // ID
      dados.nome,           // Nome
      dados.telefone || '', // Telefone
      dados.email || '',    // Email
      'Contratante',        // Tipo
      new Date()            // Data Cadastro
    ]);
    
    Logger.log('✅ Contratante cadastrado: ' + id + ' - ' + dados.nome);
    
    return {
      sucesso: true,
      id: id,
      mensagem: 'Contratante cadastrado com sucesso!'
    };
    
  } catch (erro) {
    Logger.log('❌ Erro ao cadastrar contratante: ' + erro);
    return {
      sucesso: false,
      mensagem: erro.toString()
    };
  }
}
