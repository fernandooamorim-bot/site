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
  const busca = String(nomeParcial).toLowerCase();
  const eventos = [];

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const nome = String(linha[COL.NOME_CONTRATANTE] || '').toLowerCase();
    if (!nome.includes(busca)) continue;

    eventos.push(mapEventoResumo(linha));
    if (eventos.length >= 20) break;
  }

  Logger.log('✅ Encontrados: ' + eventos.length);
  return eventos;
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
    const dataEvento = dados[i][COL.DATA_EVENTO];
    if (!(dataEvento instanceof Date)) continue;
    if (dataEvento >= inicio && dataEvento <= fim) {
      eventos.push(mapEventoResumo(dados[i]));
      if (eventos.length >= 20) break;
    }
  }

  Logger.log('✅ Encontrados: ' + eventos.length);
  return eventos;
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

      const refContratanteExiste = idContratanteAtual
        ? referenciaExisteNaAbaPorId_('CONTRATANTES', idContratanteAtual)
        : false;
      const refEnderecoExiste = idEnderecoAtual
        ? referenciaExisteNaAbaPorId_('ENDERECOS', idEnderecoAtual)
        : false;

      const evento = {
  id: l[COL.ID_EVENTO],

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
  referenciaContratanteOk: !idContratanteAtual || refContratanteExiste,
  referenciaEnderecoOk: !idEnderecoAtual || refEnderecoExiste,

  valorTotal: Number(l[COL.VALOR_TOTAL]) || 0,
  valorBV: Number(l[COL.VALOR_BV]) || 0,
  valorNF: Number(l[COL.VALOR_NF]) || 0,
  temNF: l[COL.TEM_NF] === true ? 'SIM' : 'NÃO',

  look: l[COL.LOOK] || '',
  somResponsavel: l[COL.SOM_RESPONSAVEL] || '',
  observacoes: l[COL.OBSERVACOES] || ''
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
  const financeiroNovo = calcularFinanceiroEvento({
    valorTotal: Number(dadosEditados.valorTotal) || eventoOriginal.valorTotal,
    valorBV: Number(dadosEditados.valorBV) || eventoOriginal.valorBV || 0,
    temNF:
      dadosEditados.temNF === true ||
      dadosEditados.temNF === 'SIM'
        ? true
        : false,
    comissaoTipo: dadosEditados.comissaoTipo || eventoOriginal.comissaoTipo || 'Padrão',
    comissaoValor: Number(dadosEditados.comissaoValor) || eventoOriginal.comissaoValor || 0,
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
    nomeContratanteFallback: dadosFormulario.nomeContratanteFallback || arguments[1]?.nomeContratanteFallback,
    nomeLocalFallback: dadosFormulario.nomeLocalFallback || arguments[1]?.nomeLocalFallback,

    valorTotal: Number(dadosFormulario.valorTotal ?? arguments[1]?.valorTotal) || 0,
    valorBV: Number(dadosFormulario.valorBV ?? arguments[1]?.valorBV) || 0,

    // 🔑 AQUI ESTAVA O BUG
    temNF:
      dadosFormulario.temNF === true ||
      dadosFormulario.temNF === 'SIM' ||
      dadosFormulario.temNF === 'TRUE',

    look: dadosFormulario.look || arguments[1]?.look,
    somResponsavel: dadosFormulario.somResponsavel || arguments[1]?.somResponsavel,
    observacoes: dadosFormulario.observacoes || arguments[1]?.observacoes
  };

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

    // ================================
    // DETECTAR ATIVAÇÃO DE NF / BV NA EDIÇÃO
    // ================================
    // Normalização explícita de NF (boolean definitivo)
    // NF normalizada é a fonte da verdade
    linha[COL.TEM_NF] = dados.temNF === true;
    const querNFAgora = linha[COL.TEM_NF] === true;

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
    linha[COL.TIPO_EVENTO] = dados.tipoEvento || '';
    linha[COL.PROJETO] = dados.projeto || '';

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

    linha[COL.ID_CERIMONIALISTA] = dados.idCerimonialista || '';
    linha[COL.NOME_CERIMONIALISTA] = dados.idCerimonialista
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

    linha[COL.ID_VENDEDOR] = dados.idVendedor || '';
    linha[COL.ID_BV] = dados.idBV || '';

    // ───────── CONTROLE DE EDIÇÃO FINANCEIRA ─────────
    // ACL moderna para alteração de VALOR_TOTAL ou VALOR_BV
    let podeAlterarFinanceiro = false;
    let permissaoFinanceira = verificarPermissaoEdicaoFinanceira(idEvento);
    // Substituir lógica de perfil por ACL moderna:
    const usuario = getUsuarioAtual();
    if (usuario.PERFIL === 'Proprietário') {
      // mantém comportamento atual
      podeAlterarFinanceiro = permissaoFinanceira.permitido;
    } else {
      // exige permissão extra
      podeAlterarFinanceiro = permissaoFinanceira.permitido;
    }

    if (podeAlterarFinanceiro) {
      // BV agora depende da definição acima
      const querBVAgora =
        Number(dados.valorBV) > 0;

      linha[COL.VALOR_TOTAL] =
        Number(dados.valorTotal) || linha[COL.VALOR_TOTAL];

      // BV
      if (querBVAgora) {
        linha[COL.VALOR_BV] = Number(dados.valorBV);
        linha[COL.ID_BV] = dados.idBV || '';
      } else {
        linha[COL.VALOR_BV] = 0;
        linha[COL.ID_BV] = '';
      }

      // Comissões e BV
      // (O recálculo de NF será feito para todos logo abaixo)
      linha[COL.VALOR_COMISSAO_CALCULADO] = null; // será recalculado no bloco de NF
      linha[COL.STATUS_BV] = null;
      linha[COL.STATUS_COMISSAO] = null;

      // Resolver nome do BV no espelho EVENTOS
      if (linha[COL.ID_BV]) {
        linha[COL.NOME_BV] = buscarNomePorId('PARCEIROS_BV', linha[COL.ID_BV]);
      } else {
        linha[COL.NOME_BV] = '';
      }
    } else {
      Logger.log('🔒 Financeiro bloqueado: ' + permissaoFinanceira.motivo);
    }

    // ================================
    // 🔁 BLOCO FINANCEIRO DEFINITIVO
    // MESMA LÓGICA DO CADASTRO DE EVENTO
    // ================================

    // Percentual oficial de NF vem da CONFIG (fonte da verdade)
    const percentualNFConfig = Number(obterConfig('NF_PERCENTUAL')) || 0;

    const financeiro = calcularFinanceiroEvento({
      valorTotal: Number(linha[COL.VALOR_TOTAL]) || 0,
      valorBV: Number(linha[COL.VALOR_BV]) || 0,
      temNF: linha[COL.TEM_NF] === true,
      percentualNF: linha[COL.TEM_NF] === true ? percentualNFConfig : 0,
      comissaoTipo: linha[COL.COMISSAO_TIPO],
      comissaoValor: linha[COL.COMISSAO_VALOR]
    });

    // Grava NF
    linha[COL.VALOR_NF] = Number(financeiro.valorNF) || 0;
    linha[COL.STATUS_NF] = financeiro.statusNF || 'N/A';

    // Comissão
    linha[COL.VALOR_COMISSAO_CALCULADO] = financeiro.valorComissaoCalculado || 0;
    linha[COL.STATUS_COMISSAO] = financeiro.statusComissao || 'N/A';

    // BV
    linha[COL.STATUS_BV] = financeiro.statusBV || 'N/A';

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
      (eventoAtualizado.temNF && eventoAtualizado.valorNF > 0) ||
      (eventoAtualizado.valorBV > 0)
    ) {
      garantirMovimentacoesNF_BV(eventoAtualizado, emailExecutor);
    }

    Logger.log('✅ Evento salvo com sucesso!');

    // Retorno padronizado de sucesso (conforme instrução)
    return {
      sucesso: true,
      mensagem: 'Evento atualizado com sucesso',
      eventoId: linha[COL.ID_EVENTO]
    };

  } catch (erro) {
    Logger.log('🔥 ERRO ao salvar: ' + (erro && erro.message ? erro.message : erro));
    return {
      sucesso: false,
      mensagem: erro && erro.message ? erro.message : 'Erro inesperado ao salvar evento'
    };
  }
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
    if (nomeLookup) {
      return { id: idNovo, nome: nomeLookup };
    }
    // Referência fora do mestre: preserva texto para evitar zerar espelho.
    return { id: idNovo, nome: nomeFallback || nomeAtual };
  }

  // Sem seleção nova: mantém referência atual para evitar falso positivo de limpeza.
  return { id: idAtual, nome: nomeFallback || nomeAtual };
}

/* =========================
   LISTAR PARA DROPDOWNS (NOVAS!)
========================= */
/* FUNÇÃO DUPLICADA
function listarContratantes() {
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
function listarCerimonialistas() {
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

function listarEnderecos() {
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
function listarVendedores() {
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

function listarParceirosBV() {
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

  return {
    id: l[COL.ID_EVENTO],
    tipoEvento: l[COL.TIPO_EVENTO] || '',
    contratante: l[COL.NOME_CONTRATANTE] || '—',
    valor: l[COL.VALOR_TOTAL] || 0,
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

function obterConfig(chave) {
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

function listarTiposEvento() {
  const valor = obterConfig('TIPOS_EVENTO');
  if (!valor) return ['Casamento', 'Aniversário', 'Formatura', 'Corporativo', 'Festa', 'Outro'];
  return String(valor).split(';').map(function(t) { return t.trim(); }).filter(function(t) { return t; });
}

function listarDuracoesPadrao() {
  const valor = obterConfig('DURACOES_PADRAO');
  if (!valor) return ['60','90','120','150','180','210','240'];
  return String(valor).split(';').map(function(d) { return d.trim(); }).filter(function(d) { return d; });
}

function listarProjetosSugeridos() {
  const valor = obterConfig('PROJETOS_SUGERIDOS');
  if (!valor) return ['Banda Completa', 'Banda Reduzida', 'Banda Personalizada'];
  return String(valor).split(';').map(function(p) { return p.trim(); }).filter(function(p) { return p; });
}

/* =========================
   CADASTRO RÁPIDO CONTRATANTE
========================= */

function cadastrarContratanteRapido(dados) {
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
