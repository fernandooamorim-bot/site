/**
 * Base anual, somente leitura, para a formação da agenda futura.
 * A Agenda operacional limita o histórico por desempenho; esta leitura não.
 */

function construirEventosFormacaoAgendaFutura_(linhas, colunas, anoBase) {
  const ano = Number(anoBase);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
    throw new Error('Ano inválido para formação da agenda futura.');
  }

  const col = colunas || {};
  return (Array.isArray(linhas) ? linhas : []).reduce(function (eventos, linha) {
    const id = String(linha[col.id] || '').trim();
    const tipo = String(linha[col.tipo] || '').trim().toUpperCase();
    const status = String(linha[col.status] || 'ATIVO').trim().toUpperCase();
    if (!id || tipo !== 'EVENTO' || status === 'CANCELADO') return eventos;

    const dataEvento = normalizarData(linha[col.dataEvento]);
    if (!dataEvento || isNaN(dataEvento.getTime())) return eventos;
    const anoEvento = dataEvento.getFullYear();
    if (anoEvento !== ano && anoEvento !== ano + 1) return eventos;

    const dataCriacao = normalizarData(linha[col.dataCriacao]);
    const criadoPor = String(linha[col.criadoPor] || '');
    eventos.push({
      dataEventoMs: dataEvento.getTime(),
      dataCriacaoMs: dataCriacao && !isNaN(dataCriacao.getTime()) ? dataCriacao.getTime() : 0,
      valor: Number(linha[col.valor]) || 0,
      importado: /migracao|import/i.test(criadoPor)
    });
    return eventos;
  }, []);
}

function obterFormacaoAgendaFutura(params) {
  const ano = Number((params && params.ano) || new Date().getFullYear());
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('EVENTOS');
  if (!sheet) throw new Error('Planilha EVENTOS não encontrada.');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { sucesso: true, ano: ano, eventos: [] };

  const colunas = {
    id: COL.ID_EVENTO,
    tipo: COL.TIPO_REGISTRO,
    dataEvento: COL.DATA_EVENTO,
    valor: COL.VALOR_TOTAL,
    status: COL.STATUS_GERAL,
    dataCriacao: COL.DATA_CRIACAO,
    criadoPor: COL.CRIADO_POR
  };
  const ultimaColuna = Math.max.apply(null, Object.keys(colunas).map(function (chave) {
    return Number(colunas[chave]);
  })) + 1;
  const linhas = sheet.getRange(2, 1, lastRow - 1, ultimaColuna).getValues();

  return {
    sucesso: true,
    ano: ano,
    eventos: construirEventosFormacaoAgendaFutura_(linhas, colunas, ano)
  };
}
