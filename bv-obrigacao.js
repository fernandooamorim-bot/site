/**
 * Ciclo canônico de BV: uma obrigação por evento, baixada no próprio livro.
 * Pagamentos parciais não fazem parte deste contrato; valor divergente exige
 * ajuste financeiro explícito, nunca uma segunda baixa de BV.
 */
function bvObrigacaoStatus_(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
}

function bvObrigacaoLocalizar_(movimentos, indice, idEvento) {
  const resultado = { pendentes: [], processados: [], ativos: [] };
  if (!Array.isArray(movimentos) || !indice) return resultado;
  for (let i = 1; i < movimentos.length; i++) {
    const linha = movimentos[i];
    if (String(linha[indice('ID_EVENTO')] || '').trim() !== String(idEvento || '').trim()) continue;
    if (String(linha[indice('TIPO_MOVIMENTACAO')] || '').trim() !== 'BV_EVENTO') continue;
    const status = bvObrigacaoStatus_(linha[indice('STATUS')]);
    if (status === 'CANCELADO') continue;
    const movimento = { linhaIndex: i + 1, linha: linha, status: status };
    resultado.ativos.push(movimento);
    if (status === 'PENDENTE') resultado.pendentes.push(movimento);
    if (status === 'PROCESSADO') resultado.processados.push(movimento);
  }
  return resultado;
}

function bvObrigacaoHistoricoBaixa_(observacoes, dataSaida, usuario, origem) {
  const anterior = String(observacoes || '').trim();
  const data = dataSaida instanceof Date ? dataSaida : new Date(dataSaida);
  const dataTexto = isNaN(data.getTime()) ? '' : Utilities.formatDate(data, Session.getScriptTimeZone() || 'America/Fortaleza', 'dd/MM/yyyy');
  const marcador = '[BV_BAIXADO] status=PENDENTE>PROCESSADO' +
    (dataTexto ? ' data=' + dataTexto : '') +
    (usuario ? ' por=' + String(usuario) : '') +
    (origem ? ' origem=' + String(origem) : '');
  return anterior.indexOf('[BV_BAIXADO]') >= 0 ? anterior : (anterior ? anterior + ' | ' : '') + marcador;
}

function bvObrigacaoRevisaoFinanceira_() {
  try { return PropertiesService.getDocumentProperties().getProperty('FINANCEIRO_DASHBOARD_REVISAO') || '0'; } catch (_) { return '0'; }
}

function bvObrigacaoInvalidarCachesFinanceiros_() {
  try { PropertiesService.getDocumentProperties().setProperty('FINANCEIRO_DASHBOARD_REVISAO', String(Date.now())); } catch (_) {}
}
