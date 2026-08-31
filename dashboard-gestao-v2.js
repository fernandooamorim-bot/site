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

// Rankings são leitura analítica: quando não há ID, evita fragmentar a mesma
// pessoa por diferenças apenas de acento, caixa ou espaçamento no histórico.
function dashboardV2ChavePessoa_(idPessoa, nomePessoa) {
  const id = String(idPessoa || '').trim();
  if (id) return 'ID:' + id;
  return 'NOME:' + dashboardV2TextoNormalizado_(nomePessoa).replace(/\s+/g, ' ');
}

function dashboardV2RegistrarNomeRanking_(item, nome) {
  const limpo = String(nome || '').trim() || 'Sem informação';
  item.variacoesNome = item.variacoesNome || {};
  item.variacoesNome[limpo] = (item.variacoesNome[limpo] || 0) + 1;
}

function dashboardV2NomeRanking_(item, fallback) {
  const variacoes = (item && item.variacoesNome) || {};
  const nomes = Object.keys(variacoes);
  if (!nomes.length) return fallback;
  nomes.sort(function (a, b) {
    return variacoes[b] - variacoes[a] || a.localeCompare(b, 'pt-BR');
  });
  return nomes[0];
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

function dashboardV2Mediana_(valores) {
  const lista = (valores || []).filter(function (valor) { return Number.isFinite(Number(valor)); }).map(Number).sort(function (a, b) { return a - b; });
  if (!lista.length) return null;
  const meio = Math.floor(lista.length / 2);
  return lista.length % 2 ? lista[meio] : Number(((lista[meio - 1] + lista[meio]) / 2).toFixed(1));
}

function dashboardV2AnaliseAvancada_(eventos, indice, movPorEvento, params) {
  const ano = Number(params.ano);
  const hoje = params.hoje;
  const incluirCancelados = params.incluirCancelados;
  const tipoFiltro = dashboardV2TextoNormalizado_(params.tipoEvento);
  const projetoFiltro = dashboardV2TextoNormalizado_(params.projeto);
  const linhasAno = [];
  const linhasHistoricas = [];
  const funil = { eventos: 0, reservas: 0, reunioes: 0, bloqueios: 0 };
  const tipos = {};
  const projetos = {};
  const cerimonialistas = {};
  const folhasPorTipo = {};
  const antecedenciaPorMes = {};
  const metaAnterior = { contratado: 0 };

  for (let i = 1; Array.isArray(eventos) && i < eventos.length; i++) {
    const row = eventos[i];
    const tipoRegistro = dashboardV2TextoNormalizado_(dashboardV2Valor_(row, indice, 'TIPO_REGISTRO', ''));
    if (tipoRegistro === 'EVENTO') funil.eventos++;
    else if (tipoRegistro === 'RESERVA') funil.reservas++;
    else if (tipoRegistro === 'REUNIAO') funil.reunioes++;
    else if (tipoRegistro === 'BLOQUEIO') funil.bloqueios++;
    if (tipoRegistro !== 'EVENTO') continue;

    const dataEvento = dashboardV2Data_(dashboardV2Valor_(row, indice, 'DATA_EVENTO', ''));
    if (!dataEvento) continue;
    const status = dashboardV2TextoNormalizado_(dashboardV2Valor_(row, indice, 'STATUS_GERAL', 'ATIVO')) || 'ATIVO';
    if (!incluirCancelados && status === 'CANCELADO') continue;
    const anoEvento = dataEvento.getFullYear();
    const valorContrato = dashboardV2Numero_(dashboardV2Valor_(row, indice, 'VALOR_TOTAL', 0));
    const tipoEvento = String(dashboardV2Valor_(row, indice, 'TIPO_EVENTO', '') || '').trim() || 'Sem tipo';
    const projeto = String(dashboardV2Valor_(row, indice, 'PROJETO', '') || '').trim() || 'Sem projeto';
    if (tipoFiltro && dashboardV2TextoNormalizado_(tipoEvento) !== tipoFiltro) continue;
    if (projetoFiltro && dashboardV2TextoNormalizado_(projeto) !== projetoFiltro) continue;
    if (anoEvento === ano - 1) metaAnterior.contratado += valorContrato;

    const idEvento = String(dashboardV2Valor_(row, indice, 'ID_EVENTO', '') || '').trim();
    const mov = movPorEvento[idEvento] || { recebido: 0, comissaoGerada: 0, comissaoPaga: 0, bvPago: 0, nfPaga: 0, folhaPaga: 0 };
    const recebidoEspelho = dashboardV2Numero_(dashboardV2Valor_(row, indice, 'VALOR_RECEBIDO', 0));
    const recebido = Math.abs(mov.recebido) > 0.009 ? mov.recebido : recebidoEspelho;
    const comissaoEsperada = dashboardV2Numero_(dashboardV2Valor_(row, indice, 'VALOR_COMISSAO_CALCULADO', 0));
    const bvEsperado = dashboardV2Numero_(dashboardV2Valor_(row, indice, 'VALOR_BV', 0));
    const nfEsperada = dashboardV2Numero_(dashboardV2Valor_(row, indice, 'VALOR_NF', 0));
    const cerimonialista = String(dashboardV2Valor_(row, indice, 'NOME_CERIMONIALISTA', '') || '').trim() || 'Sem cerimonialista';
    const criadoEm = dashboardV2Data_(dashboardV2Valor_(row, indice, 'DATA_CRIACAO', ''));
    const folhaPaga = dashboardV2Numero_(mov.folhaPaga);
    const custosPagos = dashboardV2Numero_(mov.comissaoPaga) + dashboardV2Numero_(mov.bvPago) + dashboardV2Numero_(mov.nfPaga) + folhaPaga;
    const provisaoComissao = Math.max(comissaoEsperada - dashboardV2Numero_(mov.comissaoPaga), 0);
    const provisaoBv = Math.max(bvEsperado - dashboardV2Numero_(mov.bvPago), 0);
    const provisaoNf = Math.max(nfEsperada - dashboardV2Numero_(mov.nfPaga), 0);
    const provisoes = provisaoComissao + provisaoBv + provisaoNf;
    const futuro = dataEvento >= hoje;
    const pendencias = [];
    if (valorContrato > recebido + 0.01) pendencias.push('Recebimento incompleto');
    if (provisaoComissao > 0.009) pendencias.push('Comissão pendente');
    if (provisaoBv > 0.009) pendencias.push('BV pendente');
    if (provisaoNf > 0.009) pendencias.push('NF pendente');
    if (!folhaPaga && !futuro) pendencias.push('Folha sem movimento');
    const linha = {
      idEvento: idEvento,
      nomeEvento: String(dashboardV2Valor_(row, indice, 'NOME_EVENTO', '') || '').trim() || [tipoEvento, String(dashboardV2Valor_(row, indice, 'NOME_CONTRATANTE', '') || '').trim()].filter(Boolean).join(' - '),
      dataEvento: dataEvento.getTime(), ano: anoEvento, mes: dataEvento.getMonth() + 1,
      tipoEvento: tipoEvento, projeto: projeto, cerimonialista: cerimonialista,
      valorContrato: dashboardV2Dinheiro_(valorContrato), recebido: dashboardV2Dinheiro_(recebido),
      custosPagos: dashboardV2Dinheiro_(custosPagos), provisoes: dashboardV2Dinheiro_(provisoes),
      lucroAtual: dashboardV2Dinheiro_(recebido - custosPagos),
      lucroProjetado: dashboardV2Dinheiro_(valorContrato - custosPagos - provisoes),
      margemProjetada: valorContrato > 0 ? Number((((valorContrato - custosPagos - provisoes) / valorContrato) * 100).toFixed(1)) : null,
      folhaPaga: dashboardV2Dinheiro_(folhaPaga), futuro: futuro, pendencias: pendencias
    };
    linhasHistoricas.push({ dataEvento: dataEvento, criadoEm: criadoEm, tipoEvento: tipoEvento, folhaPaga: folhaPaga, valorContrato: valorContrato, linha: linha });
    if (anoEvento !== ano) continue;
    linhasAno.push(linha);
    tipos[tipoEvento] = (tipos[tipoEvento] || { nome: tipoEvento, eventos: 0, contratado: 0, lucroProjetado: 0 });
    tipos[tipoEvento].eventos++; tipos[tipoEvento].contratado += valorContrato; tipos[tipoEvento].lucroProjetado += linha.lucroProjetado;
    projetos[projeto] = (projetos[projeto] || { nome: projeto, eventos: 0, contratado: 0, lucroProjetado: 0 });
    projetos[projeto].eventos++; projetos[projeto].contratado += valorContrato; projetos[projeto].lucroProjetado += linha.lucroProjetado;
    cerimonialistas[cerimonialista] = (cerimonialistas[cerimonialista] || { nome: cerimonialista, eventos: 0, contratado: 0 });
    cerimonialistas[cerimonialista].eventos++; cerimonialistas[cerimonialista].contratado += valorContrato;
  }

  linhasHistoricas.forEach(function (item) {
    if (item.dataEvento >= hoje || item.folhaPaga <= 0) return;
    const bucket = folhasPorTipo[item.tipoEvento] || { soma: 0, eventos: 0 };
    bucket.soma += item.folhaPaga; bucket.eventos++;
    folhasPorTipo[item.tipoEvento] = bucket;
  });
  linhasHistoricas.forEach(function (item) {
    if (!item.criadoEm || item.dataEvento <= item.criadoEm || item.dataEvento >= hoje) return;
    const meses = antecedenciaPorMes[item.dataEvento.getMonth() + 1] || [];
    meses.push(Math.round((item.dataEvento.getTime() - item.criadoEm.getTime()) / 86400000));
    antecedenciaPorMes[item.dataEvento.getMonth() + 1] = meses;
  });

  const folhaGlobal = Object.keys(folhasPorTipo).reduce(function (acc, chave) { acc.soma += folhasPorTipo[chave].soma; acc.eventos += folhasPorTipo[chave].eventos; return acc; }, { soma: 0, eventos: 0 });
  const mediaFolhaGlobal = folhaGlobal.eventos ? folhaGlobal.soma / folhaGlobal.eventos : 0;
  let folhaEstimadaFutura = 0;
  let eventosComFolhaEstimada = 0;
  linhasAno.forEach(function (linha) {
    if (!linha.futuro || linha.folhaPaga > 0) return;
    const base = folhasPorTipo[linha.tipoEvento];
    const media = base && base.eventos ? base.soma / base.eventos : mediaFolhaGlobal;
    if (media > 0) { folhaEstimadaFutura += media; eventosComFolhaEstimada++; }
  });
  const antecedencia = [];
  for (let mes = 1; mes <= 12; mes++) {
    const dias = antecedenciaPorMes[mes] || [];
    const eventosMes = linhasAno.filter(function (linha) { return linha.mes === mes; });
    antecedencia.push({ mes: mes, eventosAtuais: eventosMes.length, valorAtual: dashboardV2Dinheiro_(eventosMes.reduce(function (s, linha) { return s + linha.valorContrato; }, 0)), amostraHistorica: dias.length, medianaDias: dashboardV2Mediana_(dias), mediaDias: dias.length ? Number((dias.reduce(function (s, n) { return s + n; }, 0) / dias.length).toFixed(1)) : null });
  }
  const realizado = linhasAno.filter(function (linha) { return !linha.futuro; });
  const futuro = linhasAno.filter(function (linha) { return linha.futuro; });
  const ticket = linhasAno.length ? linhasAno.reduce(function (s, linha) { return s + linha.valorContrato; }, 0) / linhasAno.length : 0;
  const metaPctRaw = typeof obterConfig === 'function' ? Number(obterConfig('DASHBOARD_META_ANUAL_PCT')) : 30;
  const metaPct = Number.isFinite(metaPctRaw) ? Math.max(0, Math.min(200, metaPctRaw)) : 30;
  const meta = metaAnterior.contratado * (1 + metaPct / 100);
  const segmentos = function (mapa) { return Object.keys(mapa).map(function (chave) { const item = mapa[chave]; item.contratado = dashboardV2Dinheiro_(item.contratado); item.lucroProjetado = dashboardV2Dinheiro_(item.lucroProjetado); return item; }).sort(function (a, b) { return b.contratado - a.contratado; }).slice(0, 10); };
  const auditoria = linhasAno.sort(function (a, b) { return a.dataEvento - b.dataEvento; }).slice(0, 180);
  return {
    meta: { percentual: metaPct, baseAnoAnterior: dashboardV2Dinheiro_(metaAnterior.contratado), alvo: dashboardV2Dinheiro_(meta), realizado: dashboardV2Dinheiro_(linhasAno.reduce(function (s, linha) { return s + linha.valorContrato; }, 0)), falta: dashboardV2Dinheiro_(Math.max(meta - linhasAno.reduce(function (s, linha) { return s + linha.valorContrato; }, 0), 0)) },
    operacao: { ticketMedio: dashboardV2Dinheiro_(ticket), realizados: { eventos: realizado.length, contratado: dashboardV2Dinheiro_(realizado.reduce(function (s, linha) { return s + linha.valorContrato; }, 0)), lucroProjetado: dashboardV2Dinheiro_(realizado.reduce(function (s, linha) { return s + linha.lucroProjetado; }, 0)) }, futuros: { eventos: futuro.length, contratado: dashboardV2Dinheiro_(futuro.reduce(function (s, linha) { return s + linha.valorContrato; }, 0)), lucroProjetado: dashboardV2Dinheiro_(futuro.reduce(function (s, linha) { return s + linha.lucroProjetado; }, 0)) } },
    folha: { mediaGlobal: dashboardV2Dinheiro_(mediaFolhaGlobal), eventosBase: folhaGlobal.eventos, estimativaFutura: dashboardV2Dinheiro_(folhaEstimadaFutura), eventosEstimados: eventosComFolhaEstimada, porTipo: Object.keys(folhasPorTipo).map(function (chave) { const item = folhasPorTipo[chave]; return { nome: chave, eventos: item.eventos, media: dashboardV2Dinheiro_(item.soma / item.eventos) }; }).sort(function (a, b) { return b.media - a.media; }) },
    segmentos: { tipos: segmentos(tipos), projetos: segmentos(projetos) },
    cerimonialistas: Object.keys(cerimonialistas).map(function (chave) { const item = cerimonialistas[chave]; item.contratado = dashboardV2Dinheiro_(item.contratado); return item; }).sort(function (a, b) { return b.contratado - a.contratado; }).slice(0, 10),
    funil: funil, auditoria: auditoria,
    formacaoAgenda: { meses: antecedencia, observacao: 'Antecedência usa DATA_CRIACAO. Eventos migrados ou sem data de criação não entram na amostra.' },
    filtros: { tipos: Object.keys(tipos).sort(), projetos: Object.keys(projetos).sort() }
  };
}

function construirDashboardGestaoV2_(eventos, movimentos, opcoes) {
  const params = opcoes || {};
  const agora = dashboardV2Data_(params.agora) || new Date();
  const ano = Number(params.ano) || agora.getFullYear();
  const incluirCancelados = params.incluirCancelados === true || String(params.incluirCancelados || '').toUpperCase() === 'TRUE';
  const tipoFiltro = dashboardV2TextoNormalizado_(params.tipoEvento);
  const projetoFiltro = dashboardV2TextoNormalizado_(params.projeto);
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
    const tipoEventoFiltro = String(dashboardV2Valor_(linha, e, 'TIPO_EVENTO', '') || '').trim() || 'Sem tipo';
    const projetoFiltroEvento = String(dashboardV2Valor_(linha, e, 'PROJETO', '') || '').trim() || 'Sem projeto';
    if (tipoFiltro && dashboardV2TextoNormalizado_(tipoEventoFiltro) !== tipoFiltro) continue;
    if (projetoFiltro && dashboardV2TextoNormalizado_(projetoFiltroEvento) !== projetoFiltro) continue;

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

    const chaveVendedor = dashboardV2ChavePessoa_(idVendedor, nomeVendedor);
    if (!vendedores[chaveVendedor]) vendedores[chaveVendedor] = { idVendedor: idVendedor, nomeVendedor: nomeVendedor, eventos: 0, prevista: 0, paga: 0, aPagar: 0, futura: 0 };
    dashboardV2RegistrarNomeRanking_(vendedores[chaveVendedor], nomeVendedor);
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
      futuro: futuro,
      tipoEvento: tipoEventoFiltro,
      projeto: String(dashboardV2Valor_(linha, e, 'PROJETO', '') || '').trim() || 'Sem projeto',
      cerimonialista: String(dashboardV2Valor_(linha, e, 'NOME_CERIMONIALISTA', '') || '').trim() || 'Sem cerimonialista',
      folhaPaga: dashboardV2Dinheiro_(mov.folhaPaga)
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
    return {
      idVendedor: item.idVendedor,
      nomeVendedor: dashboardV2NomeRanking_(item, item.nomeVendedor),
      eventos: item.eventos,
      prevista: item.prevista,
      paga: item.paga,
      aPagar: item.aPagar,
      futura: item.futura
    };
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
    comparativo: comparativo,
    analise: dashboardV2AnaliseAvancada_(eventos, e, movPorEvento, { ano: ano, hoje: hoje, incluirCancelados: incluirCancelados, tipoEvento: params.tipoEvento, projeto: params.projeto }),
    inteligencia: typeof dashboardV2ConstruirInteligencia_ === 'function'
      ? dashboardV2ConstruirInteligencia_(eventos, movimentos, { ano: ano, hoje: hoje, incluirCancelados: incluirCancelados, tipoEvento: params.tipoEvento, projeto: params.projeto })
      : null
  };
}

function dashboardV2LerCacheSegmentado_(cache, chave) {
  const cabecalho = cache.get(chave);
  if (!cabecalho) return null;
  try {
    const parsed = JSON.parse(cabecalho);
    if (!parsed || parsed.__dashboardV2Segmentos === undefined) return parsed;
    const quantidade = Number(parsed.__dashboardV2Segmentos) || 0;
    if (!quantidade) return null;
    let json = '';
    for (let i = 0; i < quantidade; i++) {
      const parte = cache.get(chave + ':parte:' + i);
      if (parte === null) return null;
      json += parte;
    }
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

function dashboardV2SalvarCacheSegmentado_(cache, chave, valor, ttlSeg) {
  const json = JSON.stringify(valor);
  // CacheService limita cada item a 100 KB. 22 mil caracteres continuam
  // seguros mesmo quando nomes contêm caracteres UTF-8 multibyte.
  const limiteSeguro = 22000;
  if (json.length <= limiteSeguro) {
    cache.put(chave, json, ttlSeg);
    return;
  }
  const quantidade = Math.ceil(json.length / limiteSeguro);
  for (let i = 0; i < quantidade; i++) {
    cache.put(chave + ':parte:' + i, json.slice(i * limiteSeguro, (i + 1) * limiteSeguro), ttlSeg);
  }
  cache.put(chave, JSON.stringify({ __dashboardV2Segmentos: quantidade }), ttlSeg);
}

function obterDashboardGestaoV2(params) {
  exigirAcao('eventos:visualizarFinanceiro');
  const ano = Number((params && params.ano) || new Date().getFullYear());
  const incluirCancelados = String((params && params.incluirCancelados) || '').toUpperCase() === 'TRUE';
  const tipoEvento = String((params && params.tipoEvento) || '').trim();
  const projeto = String((params && params.projeto) || '').trim();
  const forceRefresh = String((params && params.forceRefresh) || '').toUpperCase() === 'TRUE';
  const cache = CacheService.getScriptCache();
  const cacheKey = ['dashboard:gestao:v2beta:3', ano, incluirCancelados ? '1' : '0', tipoEvento || '-', projeto || '-'].join(':');
  if (!forceRefresh) {
    const armazenado = dashboardV2LerCacheSegmentado_(cache, cacheKey);
    if (armazenado) return armazenado;
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
  const resultado = construirDashboardGestaoV2_(eventos, movimentos, { ano: ano, incluirCancelados: incluirCancelados, tipoEvento: tipoEvento, projeto: projeto });
  try { dashboardV2SalvarCacheSegmentado_(cache, cacheKey, resultado, 90); } catch (_) {}
  return resultado;
}
