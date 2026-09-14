/**
 * Auditoria unitária da Agenda.
 *
 * Esta leitura é deliberadamente sob demanda: não participa do bootstrap,
 * cache, sincronização ou renderização da agenda. A projeção histórica é uma
 * segunda ação explícita e nunca grava dados.
 */

function auditoriaAgendaNumero_(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

function auditoriaAgendaDinheiro_(valor) {
  return Number(auditoriaAgendaNumero_(valor).toFixed(2));
}

function auditoriaAgendaTexto_(valor) {
  return String(valor || '').trim();
}

function auditoriaAgendaChave_(valor) {
  return auditoriaAgendaTexto_(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function auditoriaAgendaData_(valor) {
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return new Date(valor.getFullYear(), valor.getMonth(), valor.getDate());
  }
  const texto = auditoriaAgendaTexto_(valor);
  let partes = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (partes) return new Date(Number(partes[3]), Number(partes[2]) - 1, Number(partes[1]));
  partes = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (partes) return new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
  return null;
}

function auditoriaAgendaTimestamp_(valor) {
  if (valor instanceof Date && !isNaN(valor.getTime())) return valor.getTime();
  const data = new Date(valor);
  return isNaN(data.getTime()) ? null : data.getTime();
}

function auditoriaAgendaIndice_(cabecalho) {
  const indice = {};
  (cabecalho || []).forEach(function (item, posicao) {
    indice[auditoriaAgendaTexto_(item)] = posicao;
  });
  return function (nome) {
    return Object.prototype.hasOwnProperty.call(indice, nome) ? indice[nome] : -1;
  };
}

function auditoriaAgendaValor_(linha, indice, nome, fallback) {
  const posicao = indice(nome);
  return posicao >= 0 ? linha[posicao] : fallback;
}

function auditoriaAgendaExigirProprietario_() {
  const usuario = exigirAcao('eventos:visualizarFinanceiro');
  if (auditoriaAgendaChave_(usuario && usuario.PERFIL) !== 'PROPRIETARIO') {
    throw new Error('FORBIDDEN_ACTION: agenda:auditarEvento');
  }
  return usuario;
}

function auditoriaAgendaLerEventoPorId_(sheet, idEvento) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) throw new Error('EVENTO_NAO_ENCONTRADO');
  const cabecalho = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const e = auditoriaAgendaIndice_(cabecalho);
  const colunaId = e('ID_EVENTO');
  if (colunaId < 0) throw new Error('COLUNA_ID_EVENTO_AUSENTE');
  const encontrado = sheet.getRange(2, colunaId + 1, lastRow - 1, 1)
    .createTextFinder(String(idEvento))
    .matchEntireCell(true)
    .findNext();
  if (!encontrado) throw new Error('EVENTO_NAO_ENCONTRADO');
  return {
    cabecalho: cabecalho,
    linha: sheet.getRange(encontrado.getRow(), 1, 1, lastColumn).getValues()[0]
  };
}

function auditoriaAgendaLerMovimentosDoEvento_(sheet, idEvento) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return { cabecalho: [], linhas: [] };
  const cabecalho = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const m = auditoriaAgendaIndice_(cabecalho);
  const colunaId = m('ID_EVENTO');
  if (colunaId < 0) throw new Error('COLUNA_MOVIMENTACAO_ID_EVENTO_AUSENTE');
  const ocorrencias = sheet.getRange(2, colunaId + 1, lastRow - 1, 1)
    .createTextFinder(String(idEvento))
    .matchEntireCell(true)
    .findAll();
  const linhasNumero = ocorrencias.map(function (range) { return range.getRow(); }).sort(function (a, b) { return a - b; });
  const linhas = [];
  let inicio = null;
  let fim = null;
  function lerLote() {
    if (inicio === null) return;
    const lote = sheet.getRange(inicio, 1, fim - inicio + 1, lastColumn).getValues();
    lote.forEach(function (linha) { linhas.push(linha); });
  }
  linhasNumero.forEach(function (numero) {
    if (inicio === null) { inicio = numero; fim = numero; return; }
    if (numero === fim + 1) { fim = numero; return; }
    lerLote(); inicio = numero; fim = numero;
  });
  lerLote();
  return { cabecalho: cabecalho, linhas: linhas };
}

function auditoriaAgendaEhReveillon_(data) {
  return !!data && data.getMonth() === 11 && data.getDate() === 31;
}

function auditoriaAgendaPercentil_(valores, percentil) {
  const lista = (valores || []).map(Number).filter(function (n) { return Number.isFinite(n); }).sort(function (a, b) { return a - b; });
  if (!lista.length) return null;
  const posicao = (lista.length - 1) * Math.max(0, Math.min(1, Number(percentil) || 0));
  const base = Math.floor(posicao);
  const resto = posicao - base;
  const proximo = lista[base + 1] === undefined ? lista[base] : lista[base + 1];
  return auditoriaAgendaDinheiro_(lista[base] + resto * (proximo - lista[base]));
}

function auditoriaAgendaResumo_(eventoDados, movimentosDados) {
  const e = auditoriaAgendaIndice_(eventoDados.cabecalho);
  const m = auditoriaAgendaIndice_(movimentosDados.cabecalho);
  const evento = eventoDados.linha;
  const idEvento = auditoriaAgendaTexto_(auditoriaAgendaValor_(evento, e, 'ID_EVENTO', ''));
  const dataEvento = auditoriaAgendaData_(auditoriaAgendaValor_(evento, e, 'DATA_EVENTO', ''));
  const criadoEm = auditoriaAgendaTimestamp_(auditoriaAgendaValor_(evento, e, 'DATA_CRIACAO', ''));
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const valorContrato = auditoriaAgendaNumero_(auditoriaAgendaValor_(evento, e, 'VALOR_TOTAL', 0));
  const comissaoSnapshot = auditoriaAgendaNumero_(auditoriaAgendaValor_(evento, e, 'VALOR_COMISSAO_CALCULADO', 0));
  const bvSnapshot = auditoriaAgendaNumero_(auditoriaAgendaValor_(evento, e, 'VALOR_BV', 0));
  const nfSnapshot = auditoriaAgendaNumero_(auditoriaAgendaValor_(evento, e, 'VALOR_NF', 0));
  const mov = { recebido: 0, estornado: 0, comissaoGerada: 0, comissaoPaga: 0, bvObservado: 0, bvPago: 0, nfObservada: 0, nfPaga: 0, folhaPaga: 0, folhaPendente: 0, outrosPagos: 0, ultimos: [] };
  movimentosDados.linhas.forEach(function (linha) {
    const status = auditoriaAgendaChave_(auditoriaAgendaValor_(linha, m, 'STATUS', ''));
    if (status === 'CANCELADO') return;
    const tipo = auditoriaAgendaChave_(auditoriaAgendaValor_(linha, m, 'TIPO_MOVIMENTACAO', ''));
    const natureza = auditoriaAgendaChave_(auditoriaAgendaValor_(linha, m, 'NATUREZA', ''));
    const valor = auditoriaAgendaNumero_(auditoriaAgendaValor_(linha, m, 'VALOR', 0));
    const processado = status === 'PROCESSADO';
    if (tipo === 'RECEBIMENTO_CLIENTE' && processado) mov.recebido += valor;
    else if (tipo === 'ESTORNO_RECEBIMENTO' && processado) mov.estornado += valor;
    else if (tipo === 'COMISSAO_GERADA') { mov.comissaoGerada += valor; if (processado) mov.comissaoPaga += valor; }
    else if (tipo === 'BV_EVENTO') { mov.bvObservado += valor; if (processado) mov.bvPago += valor; }
    else if (tipo === 'NF_EVENTO') { mov.nfObservada += valor; if (processado) mov.nfPaga += valor; }
    else if (tipo === 'FOLHA_EVENTO') { if (processado) mov.folhaPaga += valor; else mov.folhaPendente += valor; }
    else if (natureza === 'SAIDA' && processado) mov.outrosPagos += valor;
    mov.ultimos.push({ data: auditoriaAgendaTimestamp_(auditoriaAgendaValor_(linha, m, 'DATA_MOVIMENTACAO', '')) || auditoriaAgendaTimestamp_(auditoriaAgendaValor_(linha, m, 'TIMESTAMP', '')), tipo: tipo || 'MOVIMENTACAO', valor: auditoriaAgendaDinheiro_(valor), status: status || 'SEM_STATUS' });
  });
  mov.ultimos.sort(function (a, b) { return (b.data || 0) - (a.data || 0); });
  const recebido = mov.recebido - mov.estornado;
  const comissaoComprometida = Math.max(comissaoSnapshot, mov.comissaoGerada);
  const bvComprometido = Math.max(bvSnapshot, mov.bvObservado);
  const nfComprometido = Math.max(nfSnapshot, mov.nfObservada);
  const folhaConhecida = mov.folhaPaga + mov.folhaPendente;
  const custosPagos = mov.comissaoPaga + mov.bvPago + mov.nfPaga + mov.folhaPaga + mov.outrosPagos;
  const alertas = [];
  const pendenteReceber = Math.max(valorContrato - recebido, 0);
  if (recebido > valorContrato + 0.01) alertas.push('Recebido acima do contrato');
  if (dataEvento && dataEvento < hoje && pendenteReceber > 0) alertas.push(recebido > 0 ? 'Evento realizado com recebimento parcial' : 'Evento realizado sem recebimento');
  if (mov.comissaoPaga > comissaoSnapshot + 0.01 || mov.comissaoGerada > comissaoSnapshot + 0.01) alertas.push('Comissão acima do snapshot previsto');
  if (bvSnapshot > 0 && mov.bvPago < bvSnapshot) alertas.push('BV pendente');
  if (nfSnapshot > 0 && mov.nfPaga < nfSnapshot) alertas.push('NF pendente');
  if (dataEvento && dataEvento < hoje && folhaConhecida <= 0) alertas.push('Folha ainda não registrada');
  if (mov.outrosPagos > 0) alertas.push('Há outras saídas processadas no evento');
  const diasAntecedencia = criadoEm && dataEvento ? Math.round((dataEvento.getTime() - criadoEm) / 86400000) : null;
  return {
    idEvento: idEvento,
    evento: { nome: auditoriaAgendaTexto_(auditoriaAgendaValor_(evento, e, 'NOME_EVENTO', '')) || idEvento, tipo: auditoriaAgendaTexto_(auditoriaAgendaValor_(evento, e, 'TIPO_EVENTO', '')), projeto: auditoriaAgendaTexto_(auditoriaAgendaValor_(evento, e, 'PROJETO', '')), local: auditoriaAgendaTexto_(auditoriaAgendaValor_(evento, e, 'LOCAL', '')), dataEvento: dataEvento ? dataEvento.getTime() : null, status: auditoriaAgendaTexto_(auditoriaAgendaValor_(evento, e, 'STATUS_GERAL', 'ATIVO')), vendedor: auditoriaAgendaTexto_(auditoriaAgendaValor_(evento, e, 'NOME_VENDEDOR', '')) || 'Sem vendedor' },
    registro: { criadoEm: criadoEm, criadoPor: auditoriaAgendaTexto_(auditoriaAgendaValor_(evento, e, 'CRIADO_POR', '')), ultimaEdicao: auditoriaAgendaTimestamp_(auditoriaAgendaValor_(evento, e, 'ULTIMA_EDICAO', '')), editadoPor: auditoriaAgendaTexto_(auditoriaAgendaValor_(evento, e, 'EDITADO_POR', '')), diasAntecedencia: diasAntecedencia, fonte: 'DATA_CRIACAO' },
    financeiro: { contrato: auditoriaAgendaDinheiro_(valorContrato), recebido: auditoriaAgendaDinheiro_(recebido), aReceber: auditoriaAgendaDinheiro_(pendenteReceber), caixaLiquidoAtual: auditoriaAgendaDinheiro_(recebido - custosPagos), custosPagos: auditoriaAgendaDinheiro_(custosPagos), comissao: { prevista: auditoriaAgendaDinheiro_(comissaoComprometida), gerada: auditoriaAgendaDinheiro_(mov.comissaoGerada), paga: auditoriaAgendaDinheiro_(mov.comissaoPaga), pendente: auditoriaAgendaDinheiro_(Math.max(comissaoComprometida - mov.comissaoPaga, 0)) }, bv: { prevista: auditoriaAgendaDinheiro_(bvComprometido), paga: auditoriaAgendaDinheiro_(mov.bvPago) }, nf: { prevista: auditoriaAgendaDinheiro_(nfComprometido), paga: auditoriaAgendaDinheiro_(mov.nfPaga) }, folha: { paga: auditoriaAgendaDinheiro_(mov.folhaPaga), pendente: auditoriaAgendaDinheiro_(mov.folhaPendente), conhecida: auditoriaAgendaDinheiro_(folhaConhecida) }, outrosCustosPagos: auditoriaAgendaDinheiro_(mov.outrosPagos), lucroAntesFolha: auditoriaAgendaDinheiro_(valorContrato - comissaoComprometida - bvComprometido - nfComprometido - mov.outrosPagos), margemAntesFolha: valorContrato > 0 ? Number((((valorContrato - comissaoComprometida - bvComprometido - nfComprometido - mov.outrosPagos) / valorContrato) * 100).toFixed(1)) : null },
    alertas: alertas,
    movimentos: mov.ultimos.slice(0, 8),
    geradoEm: Date.now()
  };
}

function obterAuditoriaEventoAgenda(params) {
  auditoriaAgendaExigirProprietario_();
  const idEvento = auditoriaAgendaTexto_(params && params.idEvento);
  if (!idEvento || idEvento.length > 100) throw new Error('ID_EVENTO_OBRIGATORIO');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shEventos = ss.getSheetByName('EVENTOS');
  const shMovimentos = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  if (!shEventos || !shMovimentos) throw new Error('ABAS_DE_AUDITORIA_AUSENTES');
  return Object.assign({ sucesso: true }, auditoriaAgendaResumo_(auditoriaAgendaLerEventoPorId_(shEventos, idEvento), auditoriaAgendaLerMovimentosDoEvento_(shMovimentos, idEvento)));
}

function obterProjecaoFolhaAuditoriaEventoAgenda(params) {
  auditoriaAgendaExigirProprietario_();
  const idEvento = auditoriaAgendaTexto_(params && params.idEvento);
  if (!idEvento || idEvento.length > 100) throw new Error('ID_EVENTO_OBRIGATORIO');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shEventos = ss.getSheetByName('EVENTOS');
  const shMovimentos = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  if (!shEventos || !shMovimentos) throw new Error('ABAS_DE_AUDITORIA_AUSENTES');
  const atual = auditoriaAgendaLerEventoPorId_(shEventos, idEvento);
  const eAtual = auditoriaAgendaIndice_(atual.cabecalho);
  const linhaAtual = atual.linha;
  const dataAtual = auditoriaAgendaData_(auditoriaAgendaValor_(linhaAtual, eAtual, 'DATA_EVENTO', ''));
  const tipoAtual = auditoriaAgendaChave_(auditoriaAgendaValor_(linhaAtual, eAtual, 'TIPO_EVENTO', ''));
  const projetoAtual = auditoriaAgendaChave_(auditoriaAgendaValor_(linhaAtual, eAtual, 'PROJETO', ''));
  const localAtual = auditoriaAgendaChave_(auditoriaAgendaValor_(linhaAtual, eAtual, 'LOCAL', ''));
  if (!dataAtual || !tipoAtual || !projetoAtual || !localAtual) return { sucesso: true, disponivel: false, motivo: 'Dados insuficientes para formar uma base comparável.' };

  // Esta é a única leitura ampla do recurso e só ocorre após o segundo clique.
  // É necessária para comparar folhas processadas; nunca é chamada pela Agenda.
  const eventos = shEventos.getRange(1, 1, shEventos.getLastRow(), shEventos.getLastColumn()).getValues();
  const movimentos = shMovimentos.getRange(1, 1, shMovimentos.getLastRow(), shMovimentos.getLastColumn()).getValues();
  const e = auditoriaAgendaIndice_(eventos[0]);
  const m = auditoriaAgendaIndice_(movimentos[0]);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const limiteHistorico = new Date(hoje); limiteHistorico.setMonth(limiteHistorico.getMonth() - 24);
  const eventosPorId = {};
  for (let i = 1; i < eventos.length; i++) {
    const row = eventos[i];
    const id = auditoriaAgendaTexto_(auditoriaAgendaValor_(row, e, 'ID_EVENTO', ''));
    if (id) eventosPorId[id] = row;
  }
  const folhasPorEvento = {};
  for (let i = 1; i < movimentos.length; i++) {
    const row = movimentos[i];
    if (auditoriaAgendaChave_(auditoriaAgendaValor_(row, m, 'TIPO_MOVIMENTACAO', '')) !== 'FOLHA_EVENTO') continue;
    if (auditoriaAgendaChave_(auditoriaAgendaValor_(row, m, 'STATUS', '')) !== 'PROCESSADO') continue;
    const id = auditoriaAgendaTexto_(auditoriaAgendaValor_(row, m, 'ID_EVENTO', ''));
    const valor = auditoriaAgendaNumero_(auditoriaAgendaValor_(row, m, 'VALOR', 0));
    if (!id || valor <= 0) continue;
    (folhasPorEvento[id] = folhasPorEvento[id] || []).push(valor);
  }
  const amostra = [];
  Object.keys(folhasPorEvento).forEach(function (id) {
    if (id === idEvento || folhasPorEvento[id].length !== 1) return;
    const row = eventosPorId[id];
    if (!row) return;
    const data = auditoriaAgendaData_(auditoriaAgendaValor_(row, e, 'DATA_EVENTO', ''));
    if (!data || data >= hoje || data < limiteHistorico) return;
    if (auditoriaAgendaChave_(auditoriaAgendaValor_(row, e, 'TIPO_REGISTRO', '')) !== 'EVENTO') return;
    if (auditoriaAgendaChave_(auditoriaAgendaValor_(row, e, 'STATUS_GERAL', 'ATIVO')) === 'CANCELADO') return;
    if (auditoriaAgendaChave_(auditoriaAgendaValor_(row, e, 'TIPO_EVENTO', '')) !== tipoAtual) return;
    if (auditoriaAgendaChave_(auditoriaAgendaValor_(row, e, 'PROJETO', '')) !== projetoAtual) return;
    if (auditoriaAgendaChave_(auditoriaAgendaValor_(row, e, 'LOCAL', '')) !== localAtual) return;
    if (auditoriaAgendaEhReveillon_(data) !== auditoriaAgendaEhReveillon_(dataAtual)) return;
    amostra.push(folhasPorEvento[id][0]);
  });
  if (amostra.length < 3) return { sucesso: true, disponivel: false, motivo: 'Menos de 3 eventos concluídos com mesma formação, tipo, local e condição de Réveillon nos últimos 24 meses.', amostra: amostra.length };
  const p25 = auditoriaAgendaPercentil_(amostra, 0.25);
  const mediana = auditoriaAgendaPercentil_(amostra, 0.5);
  const p75 = auditoriaAgendaPercentil_(amostra, 0.75);
  return { sucesso: true, disponivel: true, amostra: amostra.length, p25: p25, mediana: mediana, p75: p75, confianca: amostra.length >= 6 ? 'ALTA' : 'MEDIA', criterio: 'Mesmo tipo, formação, local e condição de Réveillon; somente folhas processadas dos últimos 24 meses.' };
}
