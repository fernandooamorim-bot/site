/**
 * Dashboard Executivo 2.0 (Beta)
 *
 * API somente leitura e isolada do dashboard legado. A previsão de comissão usa
 * o snapshot VALOR_COMISSAO_CALCULADO do evento; pagamentos e demais saídas são
 * reconciliados pelo livro MOVIMENTACOES_FINANCEIRAS.
 */

function dashboardV2Numero_(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

function dashboardV2Dinheiro_(valor) {
  return Number(dashboardV2Numero_(valor).toFixed(2));
}

function dashboardV2TextoNormalizado_(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function dashboardV2Data_(valor) {
  if (typeof normalizarData === 'function') {
    const canonica = normalizarData(valor);
    if (canonica && !isNaN(canonica.getTime())) return canonica;
  }
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return new Date(valor.getFullYear(), valor.getMonth(), valor.getDate());
  }
  const texto = String(valor || '').trim();
  let match = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  match = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return null;
}

function dashboardV2Indice_(cabecalho) {
  const indice = {};
  (cabecalho || []).forEach(function (nome, posicao) {
    indice[String(nome || '').trim()] = posicao;
  });
  return function (nome) {
    return Object.prototype.hasOwnProperty.call(indice, nome) ? indice[nome] : -1;
  };
}

function dashboardV2Valor_(linha, indice, nome, fallback) {
  const posicao = indice(nome);
  return posicao >= 0 ? linha[posicao] : fallback;
}

function dashboardV2MesVazio_(mes) {
  return {
    mes: mes,
    eventos: 0,
    contratado: 0,
    recebido: 0,
    aReceber: 0,
    comissaoPrevista: 0,
    comissaoPaga: 0,
    comissaoAPagar: 0,
    outrasSaidasPagas: 0,
    saidasPagas: 0,
    resultadoCaixa: 0,
    saldoProjetadoEvento: 0
  };
}

function dashboardV2MovimentosPorEvento_(movimentos) {
  const mapa = {};
  if (!Array.isArray(movimentos) || movimentos.length < 2) return mapa;
  const m = dashboardV2Indice_(movimentos[0]);

  for (let i = 1; i < movimentos.length; i++) {
    const linha = movimentos[i];
    const idEvento = String(dashboardV2Valor_(linha, m, 'ID_EVENTO', '') || '').trim();
    if (!idEvento) continue;
    const status = dashboardV2TextoNormalizado_(dashboardV2Valor_(linha, m, 'STATUS', ''));
    if (status === 'CANCELADO') continue;

    const tipo = dashboardV2TextoNormalizado_(dashboardV2Valor_(linha, m, 'TIPO_MOVIMENTACAO', ''));
    const valor = dashboardV2Numero_(dashboardV2Valor_(linha, m, 'VALOR', 0));
    const bucket = mapa[idEvento] || {
      recebido: 0,
      comissaoGerada: 0,
      comissaoPaga: 0,
      bvPago: 0,
      nfPaga: 0,
      folhaPaga: 0
    };

    if (tipo === 'RECEBIMENTO_CLIENTE' && status === 'PROCESSADO') bucket.recebido += valor;
    else if (tipo === 'ESTORNO_RECEBIMENTO' && status === 'PROCESSADO') bucket.recebido -= valor;
    else if (tipo === 'COMISSAO_GERADA') {
      bucket.comissaoGerada += valor;
      if (status === 'PROCESSADO') bucket.comissaoPaga += valor;
    } else if (tipo === 'BV_EVENTO' && status === 'PROCESSADO') bucket.bvPago += valor;
    else if (tipo === 'NF_EVENTO' && status === 'PROCESSADO') bucket.nfPaga += valor;
    else if (tipo === 'FOLHA_EVENTO' && status === 'PROCESSADO') bucket.folhaPaga += valor;

    mapa[idEvento] = bucket;
  }
  return mapa;
}

function construirDashboardGestaoV2_(eventos, movimentos, opcoes) {
  const params = opcoes || {};
  const agora = dashboardV2Data_(params.agora) || new Date();
  const ano = Number(params.ano) || agora.getFullYear();
  const incluirCancelados = params.incluirCancelados === true || String(params.incluirCancelados || '').toUpperCase() === 'TRUE';
  const e = dashboardV2Indice_((eventos && eventos[0]) || []);
  const movPorEvento = dashboardV2MovimentosPorEvento_(movimentos || []);
  const meses = {};
  for (let mes = 1; mes <= 12; mes++) meses[mes] = dashboardV2MesVazio_(mes);

  const totais = {
    eventos: 0,
    eventosFuturos: 0,
    contratado: 0,
    recebido: 0,
    aReceber: 0,
    comissaoPrevista: 0,
    comissaoPaga: 0,
    comissaoAPagar: 0,
    comissaoFutura: 0,
    comissaoProximos90Dias: 0,
    outrasSaidasPagas: 0,
    saidasPagas: 0,
    resultadoCaixa: 0,
    saldoProjetadoEventos: 0
  };
  const qualidade = {
    eventosSemConfiguracaoComissao: 0,
    eventosComComissaoPagaAcimaPrevista: 0,
    eventosComComissaoGeradaAcimaPrevista: 0,
    eventosComFallbackRecebido: 0
  };
  const anos = {};
  const vendedores = {};
  const riscos = [];
  const eventosDetalhe = [];
  const comparativo = { atual: { eventos: 0, contratado: 0, comissaoPrevista: 0 }, anterior: { eventos: 0, contratado: 0, comissaoPrevista: 0 } };
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const limite90 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 90);

  for (let i = 1; Array.isArray(eventos) && i < eventos.length; i++) {
    const linha = eventos[i];
    const idEvento = String(dashboardV2Valor_(linha, e, 'ID_EVENTO', '') || '').trim();
    const tipoRegistro = dashboardV2TextoNormalizado_(dashboardV2Valor_(linha, e, 'TIPO_REGISTRO', ''));
    if (!idEvento || tipoRegistro !== 'EVENTO') continue;
    const dataEvento = dashboardV2Data_(dashboardV2Valor_(linha, e, 'DATA_EVENTO', ''));
    if (!dataEvento) continue;
    const anoEvento = dataEvento.getFullYear();
    anos[anoEvento] = true;
    const statusEvento = dashboardV2TextoNormalizado_(dashboardV2Valor_(linha, e, 'STATUS_GERAL', 'ATIVO')) || 'ATIVO';
    if (!incluirCancelados && statusEvento === 'CANCELADO') continue;

    const valorTotal = dashboardV2Numero_(dashboardV2Valor_(linha, e, 'VALOR_TOTAL', 0));
    const comissaoPrevista = dashboardV2Numero_(dashboardV2Valor_(linha, e, 'VALOR_COMISSAO_CALCULADO', 0));
    if (anoEvento === ano) {
      comparativo.atual.eventos++;
      comparativo.atual.contratado += valorTotal;
      comparativo.atual.comissaoPrevista += comissaoPrevista;
    } else if (anoEvento === ano - 1) {
      comparativo.anterior.eventos++;
      comparativo.anterior.contratado += valorTotal;
      comparativo.anterior.comissaoPrevista += comissaoPrevista;
    }
    if (anoEvento !== ano) continue;

    const mov = movPorEvento[idEvento] || { recebido: 0, comissaoGerada: 0, comissaoPaga: 0, bvPago: 0, nfPaga: 0, folhaPaga: 0 };
    const recebidoEspelho = dashboardV2Numero_(dashboardV2Valor_(linha, e, 'VALOR_RECEBIDO', 0));
    const recebeuPorMovimento = Math.abs(mov.recebido) > 0.009;
    const recebido = recebeuPorMovimento ? mov.recebido : recebidoEspelho;
    if (!recebeuPorMovimento && recebidoEspelho > 0) qualidade.eventosComFallbackRecebido++;
    const aReceber = Math.max(valorTotal - recebido, 0);
    const comissaoPaga = mov.comissaoPaga;
    const comissaoAPagar = Math.max(comissaoPrevista - comissaoPaga, 0);
    const outrasSaidas = mov.bvPago + mov.nfPaga + mov.folhaPaga;
    const saidasPagas = comissaoPaga + outrasSaidas;
    const futuro = dataEvento >= hoje;
    const nomeVendedor = String(dashboardV2Valor_(linha, e, 'NOME_VENDEDOR', '') || '').trim() || 'Sem vendedor';
    const idVendedor = String(dashboardV2Valor_(linha, e, 'ID_VENDEDOR', '') || '').trim();
    const comissaoTipo = String(dashboardV2Valor_(linha, e, 'COMISSAO_TIPO', '') || '').trim();
    const comissaoValor = dashboardV2Numero_(dashboardV2Valor_(linha, e, 'COMISSAO_VALOR', 0));
    const nomeEvento = String(dashboardV2Valor_(linha, e, 'NOME_EVENTO', '') || '').trim()
      || [dashboardV2Valor_(linha, e, 'TIPO_EVENTO', ''), dashboardV2Valor_(linha, e, 'NOME_CONTRATANTE', '')].filter(Boolean).join(' - ')
      || idEvento;
    const mes = dataEvento.getMonth() + 1;
    const bucket = meses[mes];

    bucket.eventos++;
    bucket.contratado += valorTotal;
    bucket.recebido += recebido;
    bucket.aReceber += aReceber;
    bucket.comissaoPrevista += comissaoPrevista;
    bucket.comissaoPaga += comissaoPaga;
    bucket.comissaoAPagar += comissaoAPagar;
    bucket.outrasSaidasPagas += outrasSaidas;
    bucket.saidasPagas += saidasPagas;

    totais.eventos++;
    totais.contratado += valorTotal;
    totais.recebido += recebido;
    totais.aReceber += aReceber;
    totais.comissaoPrevista += comissaoPrevista;
    totais.comissaoPaga += comissaoPaga;
    totais.comissaoAPagar += comissaoAPagar;
    totais.outrasSaidasPagas += outrasSaidas;
    totais.saidasPagas += saidasPagas;
    if (futuro) {
      totais.eventosFuturos++;
      totais.comissaoFutura += comissaoAPagar;
      if (dataEvento <= limite90) totais.comissaoProximos90Dias += comissaoAPagar;
    }

    const chaveVendedor = idVendedor || nomeVendedor;
    if (!vendedores[chaveVendedor]) vendedores[chaveVendedor] = { idVendedor: idVendedor, nomeVendedor: nomeVendedor, eventos: 0, prevista: 0, paga: 0, aPagar: 0, futura: 0 };
    vendedores[chaveVendedor].eventos++;
    vendedores[chaveVendedor].prevista += comissaoPrevista;
    vendedores[chaveVendedor].paga += comissaoPaga;
    vendedores[chaveVendedor].aPagar += comissaoAPagar;
    if (futuro) vendedores[chaveVendedor].futura += comissaoAPagar;

    const semConfiguracao = Boolean(idVendedor || nomeVendedor !== 'Sem vendedor') && !comissaoTipo && comissaoValor <= 0 && comissaoPrevista <= 0;
    if (semConfiguracao) {
      qualidade.eventosSemConfiguracaoComissao++;
      riscos.push({ severidade: 'ALTO', tipo: 'COMISSAO_SEM_CONFIGURACAO', idEvento: idEvento, nomeEvento: nomeEvento, dataEvento: dataEvento.getTime(), valor: valorTotal });
    }
    if (comissaoPaga > comissaoPrevista + 0.01) {
      qualidade.eventosComComissaoPagaAcimaPrevista++;
      riscos.push({ severidade: 'CRITICO', tipo: 'COMISSAO_PAGA_ACIMA_DA_PREVISAO', idEvento: idEvento, nomeEvento: nomeEvento, dataEvento: dataEvento.getTime(), valor: comissaoPaga - comissaoPrevista });
    }
    if (mov.comissaoGerada > comissaoPrevista + 0.01) {
      qualidade.eventosComComissaoGeradaAcimaPrevista++;
      riscos.push({ severidade: 'CRITICO', tipo: 'COMISSAO_GERADA_ACIMA_DA_PREVISAO', idEvento: idEvento, nomeEvento: nomeEvento, dataEvento: dataEvento.getTime(), valor: mov.comissaoGerada - comissaoPrevista });
    }
    if (futuro && dataEvento <= limite90 && aReceber > 0) {
      riscos.push({ severidade: 'ATENCAO', tipo: 'EVENTO_PROXIMO_COM_SALDO_A_RECEBER', idEvento: idEvento, nomeEvento: nomeEvento, dataEvento: dataEvento.getTime(), valor: aReceber });
    }

    eventosDetalhe.push({
      idEvento: idEvento,
      nomeEvento: nomeEvento,
      dataEvento: dataEvento.getTime(),
      nomeVendedor: nomeVendedor,
      valorTotal: dashboardV2Dinheiro_(valorTotal),
      recebido: dashboardV2Dinheiro_(recebido),
      aReceber: dashboardV2Dinheiro_(aReceber),
      comissaoPrevista: dashboardV2Dinheiro_(comissaoPrevista),
      comissaoPaga: dashboardV2Dinheiro_(comissaoPaga),
      comissaoAPagar: dashboardV2Dinheiro_(comissaoAPagar),
      futuro: futuro
    });
  }

  const mensal = Object.keys(meses).map(function (chave) {
    const item = meses[chave];
    item.resultadoCaixa = item.recebido - item.saidasPagas;
    item.saldoProjetadoEvento = item.aReceber - item.comissaoAPagar;
    Object.keys(item).forEach(function (campo) {
      if (campo !== 'mes' && campo !== 'eventos') item[campo] = dashboardV2Dinheiro_(item[campo]);
    });
    return item;
  });

  totais.resultadoCaixa = totais.recebido - totais.saidasPagas;
  totais.saldoProjetadoEventos = totais.aReceber - totais.comissaoAPagar;
  Object.keys(totais).forEach(function (campo) {
    if (campo !== 'eventos' && campo !== 'eventosFuturos') totais[campo] = dashboardV2Dinheiro_(totais[campo]);
  });
  Object.keys(comparativo).forEach(function (periodo) {
    comparativo[periodo].contratado = dashboardV2Dinheiro_(comparativo[periodo].contratado);
    comparativo[periodo].comissaoPrevista = dashboardV2Dinheiro_(comparativo[periodo].comissaoPrevista);
  });
  comparativo.variacoes = {
    contratadoPct: comparativo.anterior.contratado > 0 ? Number((((comparativo.atual.contratado / comparativo.anterior.contratado) - 1) * 100).toFixed(1)) : null,
    eventosPct: comparativo.anterior.eventos > 0 ? Number((((comparativo.atual.eventos / comparativo.anterior.eventos) - 1) * 100).toFixed(1)) : null,
    comissaoPct: comparativo.anterior.comissaoPrevista > 0 ? Number((((comparativo.atual.comissaoPrevista / comparativo.anterior.comissaoPrevista) - 1) * 100).toFixed(1)) : null
  };

  const rankingVendedores = Object.keys(vendedores).map(function (chave) {
    const item = vendedores[chave];
    ['prevista', 'paga', 'aPagar', 'futura'].forEach(function (campo) { item[campo] = dashboardV2Dinheiro_(item[campo]); });
    return item;
  }).sort(function (a, b) { return b.aPagar - a.aPagar; });
  riscos.sort(function (a, b) {
    const pesos = { CRITICO: 0, ALTO: 1, ATENCAO: 2 };
    return (pesos[a.severidade] || 9) - (pesos[b.severidade] || 9) || a.dataEvento - b.dataEvento;
  });
  eventosDetalhe.sort(function (a, b) { return a.dataEvento - b.dataEvento; });

  return {
    sucesso: true,
    versao: '2.0-beta',
    ano: ano,
    geradoEm: Date.now(),
    premissas: {
      comissaoPrevista: 'Snapshot VALOR_COMISSAO_CALCULADO de cada evento',
      comissaoPaga: 'COMISSAO_GERADA processada no livro financeiro',
      previsaoMensal: 'Agrupada pelo mês do evento; não representa data contábil de vencimento'
    },
    anosDisponiveis: Object.keys(anos).map(Number).sort(function (a, b) { return a - b; }),
    totais: totais,
    mensal: mensal,
    vendedores: rankingVendedores.slice(0, 20),
    riscos: riscos.slice(0, 60),
    eventos: eventosDetalhe.slice(0, 250),
    qualidade: qualidade,
    comparativo: comparativo
  };
}

function obterDashboardGestaoV2(params) {
  exigirAcao('eventos:visualizarFinanceiro');
  const ano = Number((params && params.ano) || new Date().getFullYear());
  const incluirCancelados = String((params && params.incluirCancelados) || '').toUpperCase() === 'TRUE';
  const forceRefresh = String((params && params.forceRefresh) || '').toUpperCase() === 'TRUE';
  const cache = CacheService.getScriptCache();
  const cacheKey = ['dashboard:gestao:v2beta:1', ano, incluirCancelados ? '1' : '0'].join(':');
  if (!forceRefresh) {
    const armazenado = cache.get(cacheKey);
    if (armazenado) {
      try { return JSON.parse(armazenado); } catch (_) {}
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shEventos = ss.getSheetByName('EVENTOS');
  const shMovimentos = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  if (!shEventos || !shMovimentos) throw new Error('Planilhas EVENTOS ou MOVIMENTACOES_FINANCEIRAS não encontradas');
  const eventos = shEventos.getLastRow() > 0
    ? shEventos.getRange(1, 1, shEventos.getLastRow(), shEventos.getLastColumn()).getValues()
    : [];
  const movimentos = shMovimentos.getLastRow() > 0
    ? shMovimentos.getRange(1, 1, shMovimentos.getLastRow(), shMovimentos.getLastColumn()).getValues()
    : [];
  const resultado = construirDashboardGestaoV2_(eventos, movimentos, { ano: ano, incluirCancelados: incluirCancelados });
  try { cache.put(cacheKey, JSON.stringify(resultado), 90); } catch (_) {}
  return resultado;
}
