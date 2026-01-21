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

      const evento = {
  id: l[COL.ID_EVENTO],

  // 🔑 PADRÃO DEFINITIVO
  dataEvento: formatarDataISO(l[COL.DATA_EVENTO]),
  dataFim: formatarDataISO(l[COL.DATA_FIM]),

  horaInicio: horaFormatada,
  duracao: l[COL.DURACAO] || '',
  tipoEvento: l[COL.TIPO_EVENTO] || '',
  projeto: l[COL.PROJETO] || '',

  idContratante: String(l[COL.ID_CONTRATANTE] || '').trim(),
  idCerimonialista: String(l[COL.ID_CERIMONIALISTA] || '').trim(),
  idEndereco: String(l[COL.ID_ENDERECO] || '').trim(),
  idVendedor: String(l[COL.ID_VENDEDOR] || '').trim(),
  idBV: String(l[COL.ID_BV] || '').trim(),

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
        statusFinanceiro: {
          tipo: 'info',
          mensagem: 'Status financeiro carregado com sucesso'
        }
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
    temNF: eventoOriginal.temNF === true, // NF não pode ser alterada aqui
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
  const PRAZO_HORAS_SOCIO =
    Number(obterConfig('PRAZO_EDICAO_FINANCEIRA_SOCIO_HORAS')) || 24;

  if (!idEvento) {
    return { permitido: false, motivo: 'ID do evento não informado' };
  }

  const evento = buscarEvento(idEvento);
  if (!evento) {
    return { permitido: false, motivo: 'Evento não encontrado' };
  }

  const usuario = obterUsuarioLogado();
  const perfil = usuario?.perfil || 'DESCONHECIDO';

  const valorRecebido = Number(evento.valorRecebido || 0);

  // =====================================================
  // 🔒 REGRA MÁXIMA — RECEBEU DINHEIRO = BLOQUEIO
  // =====================================================
  if (valorRecebido > 0) {
    // 🔑 Somente o Proprietário pode ignorar
    if (perfil === 'Proprietário') {
      return {
        permitido: true,
        override: true,
        motivo: 'Edição permitida por override do proprietário após recebimento'
      };
    }

    return {
      permitido: false,
      motivo: 'Edição financeira bloqueada: evento já possui recebimento'
    };
  }

  // =====================================================
  // 🔑 PROPRIETÁRIO (sem recebimento)
  // =====================================================
  if (perfil === 'Proprietário') {
    return { permitido: true };
  }

  // =====================================================
  // 👥 SÓCIO
  // =====================================================
  if (perfil === 'Sócio') {
    const dataCriacao =
      evento.dataCriacao ||
      evento.dataCadastro ||
      evento.dataEvento;

    if (!(dataCriacao instanceof Date)) {
      return {
        permitido: false,
        motivo: 'Data de criação do evento inválida'
      };
    }

    const agora = new Date();
    const horasDecorridas =
      (agora.getTime() - dataCriacao.getTime()) / (1000 * 60 * 60);

    if (horasDecorridas > PRAZO_HORAS_SOCIO) {
      return {
        permitido: false,
        motivo: `Prazo de ${PRAZO_HORAS_SOCIO}h para edição financeira expirado`
      };
    }

    // ❌ Comissão já gerada bloqueia
    const stats = calcularEstatisticasComissaoEvento(idEvento);
    if (stats.totalComissaoGerada > 0) {
      return {
        permitido: false,
        motivo: 'Já existe comissão gerada para este evento'
      };
    }

    return { permitido: true };
  }

  // =====================================================
  // 🚫 DEMAIS PERFIS
  // =====================================================
  return {
    permitido: false,
    motivo: 'Usuário sem permissão para editar financeiro'
  };
}

function salvarEdicaoEvento(idEvento, dadosFormulario) {
  Logger.log('═══════════════════════════════════════════════');
  Logger.log('💾 salvarEdicaoEvento: ' + idEvento);
  Logger.log('═══════════════════════════════════════════════');
  
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName('EVENTOS');
    if (!sheet) {
      return { sucesso: false, mensagem: 'Planilha EVENTOS não encontrada' };
    }

    const dados = sheet.getDataRange().getValues();
    let linhaIndex = -1;

    for (let i = 1; i < dados.length; i++) {
      if (String(dados[i][COL.ID_EVENTO]) === String(idEvento)) {
        linhaIndex = i;
        break;
      }
    }

    if (linhaIndex === -1) {
      Logger.log('❌ Evento não encontrado');
      return { sucesso: false, mensagem: 'Evento não encontrado' };
    }

    Logger.log('✅ Evento encontrado na linha ' + (linhaIndex + 1));

    const linha = dados[linhaIndex];
    
    // DATA EVENTO
    if (dadosFormulario.dataEvento) {
      const [ano, mes, dia] = dadosFormulario.dataEvento.split('-').map(Number);
      linha[COL.DATA_EVENTO] = new Date(ano, mes - 1, dia);
    }
    
    // DATA FIM
    if (dadosFormulario.dataFim) {
      const [ano, mes, dia] = dadosFormulario.dataFim.split('-').map(Number);
      linha[COL.DATA_FIM] = new Date(ano, mes - 1, dia);
    } else {
      linha[COL.DATA_FIM] = '';
    }
    
    // HORA
    if (dadosFormulario.horaInicio) {
      linha[COL.HORA_INICIO] = dadosFormulario.horaInicio;
    }
    
    // Outros campos
    linha[COL.DURACAO] = dadosFormulario.duracao || '';
    linha[COL.TIPO_EVENTO] = dadosFormulario.tipoEvento || '';
    linha[COL.PROJETO] = dadosFormulario.projeto || '';
    
    // IDs
    linha[COL.ID_CONTRATANTE] = dadosFormulario.idContratante || '';
    linha[COL.ID_CERIMONIALISTA] = dadosFormulario.idCerimonialista || '';
    linha[COL.ID_ENDERECO] = dadosFormulario.idEndereco || '';
    linha[COL.ID_VENDEDOR] = dadosFormulario.idVendedor || '';
    linha[COL.ID_BV] = dadosFormulario.idBV || '';
    
    // ───────── CONTROLE DE EDIÇÃO FINANCEIRA ─────────
    const permissaoFinanceira = verificarPermissaoEdicaoFinanceira(idEvento);

    if (permissaoFinanceira.permitido) {
      linha[COL.VALOR_TOTAL] = Number(dadosFormulario.valorTotal) || linha[COL.VALOR_TOTAL];
      linha[COL.VALOR_BV] = Number(dadosFormulario.valorBV) || linha[COL.VALOR_BV];
    } else {
      Logger.log('🔒 Financeiro bloqueado: ' + permissaoFinanceira.motivo);
    }

    // NF não é editável via edição comum
    linha[COL.VALOR_NF] = linha[COL.VALOR_NF];
    linha[COL.TEM_NF] = linha[COL.TEM_NF];
    
    // Outros
    linha[COL.LOOK] = dadosFormulario.look || '';
    linha[COL.SOM_RESPONSAVEL] = dadosFormulario.somResponsavel || '';
    linha[COL.OBSERVACOES] = dadosFormulario.observacoes || '';
    
    // Auditoria
    linha[COL.ULTIMA_EDICAO] = new Date();
    linha[COL.EDITADO_POR] = Session.getActiveUser().getEmail();
    
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

    garantirMovimentacoesNF_BV(eventoAtualizado);
    
    Logger.log('✅ Evento salvo com sucesso!');
    
    return {
      sucesso: true,
      mensagem: 'Evento atualizado com sucesso!'
    };
    
  } catch (erro) {
    Logger.log('🔥 ERRO ao salvar: ' + erro.message);
    return {
      sucesso: false,
      mensagem: 'Erro ao salvar: ' + erro.message
    };
  }
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
  if (!valor) return ['1h', '1h30', '2h', '2h30', '3h', '3h30', '4h'];
  return String(valor).split(';').map(function(d) { return d.trim(); }).filter(function(d) { return d; });
}

function listarProjetosSugeridos() {
  const valor = obterConfig('PROJETOS_SUGERIDOS');
  if (!valor) return ['Banda Completa', 'Banda Reduzida', 'DJ', 'Trio', 'Violão e Voz'];
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

function setValueSafe(id, valor, tentativas = 0) {
  const el = document.getElementById(id);
  if (!el) return;

  const val = String(valor ?? '').trim();

  // se já existe a opção, seta
  const existe = [...el.options].some(o => o.value === val);
  if (existe) {
    el.value = val;
    return;
  }

  // tenta novamente (dropdown ainda carregando)
  if (tentativas < 10) {
    setTimeout(() => setValueSafe(id, valor, tentativas + 1), 100);
  }
}
