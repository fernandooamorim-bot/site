/**
 * Inteligência executiva do Dashboard 2.0.
 *
 * Módulo puro e somente leitura. Valores processados vêm do livro financeiro;
 * valores comprometidos vêm dos snapshots do evento; estimativas usam apenas
 * histórico processado e carregam tamanho da amostra.
 */

function dashboardV2Percentil_(valores, percentil) {
  const lista = (valores || []).map(Number).filter(function (n) { return Number.isFinite(n); }).sort(function (a, b) { return a - b; });
  if (!lista.length) return null;
  const posicao = (lista.length - 1) * Math.max(0, Math.min(1, Number(percentil) || 0));
  const base = Math.floor(posicao);
  const resto = posicao - base;
  const valor = lista[base + 1] === undefined ? lista[base] : lista[base] + resto * (lista[base + 1] - lista[base]);
  return Number(valor.toFixed(1));
}

function dashboardV2Media_(soma, quantidade) {
  return quantidade > 0 ? dashboardV2Dinheiro_(soma / quantidade) : 0;
}

function dashboardV2Variacao_(atual, anterior) {
  return anterior > 0 ? Number((((atual / anterior) - 1) * 100).toFixed(1)) : null;
}

function dashboardV2BucketCusto_() {
  return { processado: 0, pendente: 0, quantidadeProcessada: 0, quantidadePendente: 0 };
}

function dashboardV2LivroInteligencia_(movimentos, ano) {
  const porEvento = {};
  const mensal = {};
  for (let mes = 1; mes <= 12; mes++) {
    mensal[mes] = { mes: mes, recebimentos: 0, estornos: 0, comissao: 0, bv: 0, nf: 0, folha: 0, outrasSaidas: 0, entradasLiquidas: 0, saidas: 0, caixaLiquido: 0 };
  }
  if (!Array.isArray(movimentos) || movimentos.length < 2) return { porEvento: porEvento, mensal: mensal };
  const m = dashboardV2Indice_(movimentos[0]);
  for (let i = 1; i < movimentos.length; i++) {
    const row = movimentos[i];
    const idEvento = String(dashboardV2Valor_(row, m, 'ID_EVENTO', '') || '').trim();
    const status = dashboardV2TextoNormalizado_(dashboardV2Valor_(row, m, 'STATUS', ''));
    if (status === 'CANCELADO') continue;
    const tipo = dashboardV2TextoNormalizado_(dashboardV2Valor_(row, m, 'TIPO_MOVIMENTACAO', ''));
    const natureza = dashboardV2TextoNormalizado_(dashboardV2Valor_(row, m, 'NATUREZA', ''));
    const valor = dashboardV2Numero_(dashboardV2Valor_(row, m, 'VALOR', 0));
    const data = dashboardV2Data_(dashboardV2Valor_(row, m, 'DATA_MOVIMENTACAO', ''));
    const bucket = porEvento[idEvento] || {
      recebido: 0, estornado: 0, recebimentosRegistrados: 0, estornosRegistrados: 0,
      comissao: dashboardV2BucketCusto_(), bv: dashboardV2BucketCusto_(),
      nf: dashboardV2BucketCusto_(), folha: dashboardV2BucketCusto_(),
      outrasSaidas: dashboardV2BucketCusto_()
    };
    const processado = status === 'PROCESSADO';
    if (tipo === 'RECEBIMENTO_CLIENTE' && processado) { bucket.recebido += valor; bucket.recebimentosRegistrados++; }
    else if (tipo === 'ESTORNO_RECEBIMENTO' && processado) { bucket.estornado += valor; bucket.estornosRegistrados++; }
    else {
      let categoria = null;
      if (tipo === 'COMISSAO_GERADA') categoria = bucket.comissao;
      else if (tipo === 'BV_EVENTO') categoria = bucket.bv;
      else if (tipo === 'NF_EVENTO') categoria = bucket.nf;
      else if (tipo === 'FOLHA_EVENTO') categoria = bucket.folha;
      else if (natureza === 'SAIDA') categoria = bucket.outrasSaidas;
      if (categoria) {
        if (processado) { categoria.processado += valor; categoria.quantidadeProcessada++; }
        else { categoria.pendente += valor; categoria.quantidadePendente++; }
      }
    }
    if (idEvento) porEvento[idEvento] = bucket;

    if (!data || data.getFullYear() !== Number(ano) || !processado) continue;
    const mes = data.getMonth() + 1;
    const fluxo = mensal[mes];
    if (tipo === 'RECEBIMENTO_CLIENTE') fluxo.recebimentos += valor;
    else if (tipo === 'ESTORNO_RECEBIMENTO') fluxo.estornos += valor;
    else if (tipo === 'COMISSAO_GERADA') fluxo.comissao += valor;
    else if (tipo === 'BV_EVENTO') fluxo.bv += valor;
    else if (tipo === 'NF_EVENTO') fluxo.nf += valor;
    else if (tipo === 'FOLHA_EVENTO') fluxo.folha += valor;
    else if (natureza === 'SAIDA') fluxo.outrasSaidas += valor;
  }
  Object.keys(mensal).forEach(function (chave) {
    const item = mensal[chave];
    item.entradasLiquidas = item.recebimentos - item.estornos;
    item.saidas = item.comissao + item.bv + item.nf + item.folha + item.outrasSaidas;
    item.caixaLiquido = item.entradasLiquidas - item.saidas;
    Object.keys(item).forEach(function (campo) { if (campo !== 'mes') item[campo] = dashboardV2Dinheiro_(item[campo]); });
  });
  return { porEvento: porEvento, mensal: mensal };
}

function dashboardV2LinhaEconomica_(row, e, livro, hoje) {
  const dataEvento = dashboardV2Data_(dashboardV2Valor_(row, e, 'DATA_EVENTO', ''));
  if (!dataEvento) return null;
  const idEvento = String(dashboardV2Valor_(row, e, 'ID_EVENTO', '') || '').trim();
  if (!idEvento) return null;
  const mov = livro[idEvento] || {
    recebido: 0, estornado: 0, recebimentosRegistrados: 0, estornosRegistrados: 0,
    comissao: dashboardV2BucketCusto_(), bv: dashboardV2BucketCusto_(),
    nf: dashboardV2BucketCusto_(), folha: dashboardV2BucketCusto_(),
    outrasSaidas: dashboardV2BucketCusto_()
  };
  const contrato = dashboardV2Numero_(dashboardV2Valor_(row, e, 'VALOR_TOTAL', 0));
  const recebidoLivro = mov.recebido - mov.estornado;
  const recebidoEspelho = dashboardV2Numero_(dashboardV2Valor_(row, e, 'VALOR_RECEBIDO', 0));
  const possuiLivroRecebimentos = mov.recebimentosRegistrados > 0 || mov.estornosRegistrados > 0;
  const recebido = possuiLivroRecebimentos ? recebidoLivro : recebidoEspelho;
  const comissaoSnapshot = dashboardV2Numero_(dashboardV2Valor_(row, e, 'VALOR_COMISSAO_CALCULADO', 0));
  const bvSnapshot = dashboardV2Numero_(dashboardV2Valor_(row, e, 'VALOR_BV', 0));
  const nfSnapshot = dashboardV2Numero_(dashboardV2Valor_(row, e, 'VALOR_NF', 0));
  const temNf = ['TRUE', 'SIM', '1'].indexOf(dashboardV2TextoNormalizado_(dashboardV2Valor_(row, e, 'TEM_NF', ''))) !== -1;
  const processados = mov.comissao.processado + mov.bv.processado + mov.nf.processado + mov.folha.processado + mov.outrasSaidas.processado;
  return {
    idEvento: idEvento,
    nomeEvento: String(dashboardV2Valor_(row, e, 'NOME_EVENTO', '') || '').trim() || idEvento,
    dataEvento: dataEvento, ano: dataEvento.getFullYear(), mes: dataEvento.getMonth() + 1,
    criadoEm: dashboardV2Data_(dashboardV2Valor_(row, e, 'DATA_CRIACAO', '')),
    tipoEvento: String(dashboardV2Valor_(row, e, 'TIPO_EVENTO', '') || '').trim() || 'Sem tipo',
    projeto: String(dashboardV2Valor_(row, e, 'PROJETO', '') || '').trim() || 'Sem projeto',
    cerimonialista: String(dashboardV2Valor_(row, e, 'NOME_CERIMONIALISTA', '') || '').trim() || 'Sem cerimonialista',
    idVendedor: String(dashboardV2Valor_(row, e, 'ID_VENDEDOR', '') || '').trim(),
    vendedor: String(dashboardV2Valor_(row, e, 'NOME_VENDEDOR', '') || '').trim() || 'Sem vendedor',
    contrato: contrato, recebido: recebido, aReceber: Math.max(contrato - recebido, 0),
    comissaoSnapshot: comissaoSnapshot, bvSnapshot: bvSnapshot, nfSnapshot: nfSnapshot, temNf: temNf,
    comissaoPaga: mov.comissao.processado, comissaoPendenteGerada: mov.comissao.pendente,
    bvPago: mov.bv.processado, bvPendenteGerado: mov.bv.pendente,
    nfPaga: mov.nf.processado, nfPendenteGerada: mov.nf.pendente,
    folhaPaga: mov.folha.processado, folhaPendente: mov.folha.pendente,
    outrasSaidas: mov.outrasSaidas.processado,
    custosProcessados: processados,
    caixaLiquidoAtual: recebido - processados,
    futuro: dataEvento >= hoje,
    ocorrido: dataEvento < hoje
  };
}

function dashboardV2ConstruirInteligencia_(eventos, movimentos, opcoes) {
  const params = opcoes || {};
  const ano = Number(params.ano) || new Date().getFullYear();
  const hojeInformado = dashboardV2Data_(params.hoje) || new Date();
  const hoje = new Date(hojeInformado.getFullYear(), hojeInformado.getMonth(), hojeInformado.getDate());
  const tipoFiltro = dashboardV2TextoNormalizado_(params.tipoEvento);
  const projetoFiltro = dashboardV2TextoNormalizado_(params.projeto);
  const incluirCancelados = params.incluirCancelados === true;
  const e = dashboardV2Indice_((eventos && eventos[0]) || []);
  const livro = dashboardV2LivroInteligencia_(movimentos || [], ano);
  const todas = [];
  for (let i = 1; Array.isArray(eventos) && i < eventos.length; i++) {
    const row = eventos[i];
    if (dashboardV2TextoNormalizado_(dashboardV2Valor_(row, e, 'TIPO_REGISTRO', '')) !== 'EVENTO') continue;
    const status = dashboardV2TextoNormalizado_(dashboardV2Valor_(row, e, 'STATUS_GERAL', 'ATIVO')) || 'ATIVO';
    if (!incluirCancelados && status === 'CANCELADO') continue;
    const linha = dashboardV2LinhaEconomica_(row, e, livro.porEvento, hoje);
    if (!linha) continue;
    if (tipoFiltro && dashboardV2TextoNormalizado_(linha.tipoEvento) !== tipoFiltro) continue;
    if (projetoFiltro && dashboardV2TextoNormalizado_(linha.projeto) !== projetoFiltro) continue;
    todas.push(linha);
  }

  const historicoFolhaTipo = {};
  const historicoFolhaProjeto = {};
  const historicoNfTipo = {};
  todas.forEach(function (linha) {
    if (!linha.ocorrido) return;
    if (linha.folhaPaga > 0) {
      const tipo = historicoFolhaTipo[linha.tipoEvento] || { soma: 0, qtd: 0 };
      tipo.soma += linha.folhaPaga; tipo.qtd++; historicoFolhaTipo[linha.tipoEvento] = tipo;
      const projeto = historicoFolhaProjeto[linha.projeto] || { soma: 0, qtd: 0 };
      projeto.soma += linha.folhaPaga; projeto.qtd++; historicoFolhaProjeto[linha.projeto] = projeto;
    }
    if (linha.nfPaga > 0) {
      const nf = historicoNfTipo[linha.tipoEvento] || { soma: 0, qtd: 0 };
      nf.soma += linha.nfPaga; nf.qtd++; historicoNfTipo[linha.tipoEvento] = nf;
    }
  });
  const folhaGlobal = Object.keys(historicoFolhaTipo).reduce(function (acc, chave) {
    acc.soma += historicoFolhaTipo[chave].soma; acc.qtd += historicoFolhaTipo[chave].qtd; return acc;
  }, { soma: 0, qtd: 0 });
  const nfGlobal = Object.keys(historicoNfTipo).reduce(function (acc, chave) {
    acc.soma += historicoNfTipo[chave].soma; acc.qtd += historicoNfTipo[chave].qtd; return acc;
  }, { soma: 0, qtd: 0 });
  const mediaFolhaGlobal = dashboardV2Media_(folhaGlobal.soma, folhaGlobal.qtd);
  const mediaNfGlobal = dashboardV2Media_(nfGlobal.soma, nfGlobal.qtd);

  todas.forEach(function (linha) {
    const baseTipo = historicoFolhaTipo[linha.tipoEvento];
    const baseProjeto = historicoFolhaProjeto[linha.projeto];
    let folhaReferencia = mediaFolhaGlobal;
    let folhaAmostra = folhaGlobal.qtd;
    let folhaOrigem = 'Média geral';
    if (baseProjeto && baseProjeto.qtd >= 3) { folhaReferencia = baseProjeto.soma / baseProjeto.qtd; folhaAmostra = baseProjeto.qtd; folhaOrigem = 'Média do projeto'; }
    if (baseTipo && baseTipo.qtd >= 3) { folhaReferencia = baseTipo.soma / baseTipo.qtd; folhaAmostra = baseTipo.qtd; folhaOrigem = 'Média do tipo'; }
    const nfTipo = historicoNfTipo[linha.tipoEvento];
    const nfEstimativa = linha.temNf && linha.nfSnapshot <= 0 && linha.nfPaga <= 0
      ? (nfTipo && nfTipo.qtd >= 3 ? nfTipo.soma / nfTipo.qtd : mediaNfGlobal)
      : 0;
    linha.folhaEstimada = (linha.folhaPaga > 0 || linha.folhaPendente > 0) ? 0 : dashboardV2Dinheiro_(folhaReferencia);
    linha.folhaAmostra = folhaAmostra;
    linha.folhaOrigem = folhaOrigem;
    linha.comissaoComprometida = Math.max(linha.comissaoSnapshot, linha.comissaoPaga + linha.comissaoPendenteGerada);
    linha.bvComprometido = Math.max(linha.bvSnapshot, linha.bvPago + linha.bvPendenteGerado);
    linha.nfComprometida = Math.max(linha.nfSnapshot, linha.nfPaga + linha.nfPendenteGerada, nfEstimativa);
    linha.folhaProjetada = linha.folhaPaga + linha.folhaPendente || linha.folhaEstimada;
    linha.custoTotalProjetado = linha.comissaoComprometida + linha.bvComprometido + linha.nfComprometida + linha.folhaProjetada + linha.outrasSaidas;
    linha.custosRestantes = Math.max(linha.custoTotalProjetado - linha.custosProcessados, 0);
    linha.contratoLiquidoProjetado = linha.contrato - linha.custoTotalProjetado;
    linha.saldoFuturoLiquido = linha.aReceber - linha.custosRestantes;
    linha.margemProjetada = linha.contrato > 0 ? (linha.contratoLiquidoProjetado / linha.contrato) * 100 : null;
    linha.recebimentoPct = linha.contrato > 0 ? (linha.recebido / linha.contrato) * 100 : null;
  });

  const linhasAno = todas.filter(function (linha) { return linha.ano === ano; });
  const soma = function (lista, campo) { return lista.reduce(function (acc, item) { return acc + dashboardV2Numero_(item[campo]); }, 0); };
  const realizados = linhasAno.filter(function (linha) { return linha.ocorrido; });
  const futuros = linhasAno.filter(function (linha) { return linha.futuro; });
  const resumo = {
    eventos: linhasAno.length, realizados: realizados.length, futuros: futuros.length,
    contrato: soma(linhasAno, 'contrato'), recebido: soma(linhasAno, 'recebido'), aReceber: soma(linhasAno, 'aReceber'),
    custosProcessados: soma(linhasAno, 'custosProcessados'), custosRestantes: soma(linhasAno, 'custosRestantes'),
    custoTotalProjetado: soma(linhasAno, 'custoTotalProjetado'), caixaLiquidoAtual: soma(linhasAno, 'caixaLiquidoAtual'),
    contratoLiquidoProjetado: soma(linhasAno, 'contratoLiquidoProjetado'), saldoFuturoLiquido: soma(linhasAno, 'saldoFuturoLiquido'),
    folhaProcessada: soma(linhasAno, 'folhaPaga'), folhaProjetada: soma(linhasAno, 'folhaProjetada'), folhaEstimada: soma(linhasAno, 'folhaEstimada'),
    folhaEstimadaFutura: soma(futuros, 'folhaEstimada'), folhaEstimadaRealizados: soma(realizados, 'folhaEstimada'),
    comissaoProcessada: soma(linhasAno, 'comissaoPaga'), comissaoComprometida: soma(linhasAno, 'comissaoComprometida'),
    bvProcessado: soma(linhasAno, 'bvPago'), bvComprometido: soma(linhasAno, 'bvComprometido'),
    nfProcessada: soma(linhasAno, 'nfPaga'), nfComprometida: soma(linhasAno, 'nfComprometida')
  };
  Object.keys(resumo).forEach(function (campo) { if (['eventos', 'realizados', 'futuros'].indexOf(campo) === -1) resumo[campo] = dashboardV2Dinheiro_(resumo[campo]); });
  resumo.margemProjetada = resumo.contrato > 0 ? Number(((resumo.contratoLiquidoProjetado / resumo.contrato) * 100).toFixed(1)) : null;
  resumo.recebimentoPct = resumo.contrato > 0 ? Number(((resumo.recebido / resumo.contrato) * 100).toFixed(1)) : null;

  const agrupar = function (campo) {
    const mapa = {};
    linhasAno.forEach(function (linha) {
      const nome = linha[campo] || 'Sem informação';
      const chave = campo === 'vendedor' ? dashboardV2ChavePessoa_(linha.idVendedor, nome) : nome;
      const item = mapa[chave] || { nome: nome, eventos: 0, realizados: 0, futuros: 0, contrato: 0, recebido: 0, custosProcessados: 0, custoTotalProjetado: 0, liquidoProjetado: 0 };
      if (campo === 'vendedor') dashboardV2RegistrarNomeRanking_(item, nome);
      item.eventos++; if (linha.ocorrido) item.realizados++; else item.futuros++;
      item.contrato += linha.contrato; item.recebido += linha.recebido; item.custosProcessados += linha.custosProcessados;
      item.custoTotalProjetado += linha.custoTotalProjetado; item.liquidoProjetado += linha.contratoLiquidoProjetado;
      mapa[chave] = item;
    });
    return Object.keys(mapa).map(function (chave) {
      const item = mapa[chave];
      ['contrato', 'recebido', 'custosProcessados', 'custoTotalProjetado', 'liquidoProjetado'].forEach(function (campoValor) { item[campoValor] = dashboardV2Dinheiro_(item[campoValor]); });
      item.margemProjetada = item.contrato > 0 ? Number(((item.liquidoProjetado / item.contrato) * 100).toFixed(1)) : null;
      return {
        nome: campo === 'vendedor' ? dashboardV2NomeRanking_(item, item.nome) : item.nome,
        eventos: item.eventos,
        realizados: item.realizados,
        futuros: item.futuros,
        contrato: item.contrato,
        recebido: item.recebido,
        custosProcessados: item.custosProcessados,
        custoTotalProjetado: item.custoTotalProjetado,
        liquidoProjetado: item.liquidoProjetado,
        margemProjetada: item.margemProjetada
      };
    }).sort(function (a, b) { return b.contrato - a.contrato; });
  };

  const mensalEconomico = [];
  for (let mes = 1; mes <= 12; mes++) {
    const lista = linhasAno.filter(function (linha) { return linha.mes === mes; });
    mensalEconomico.push({
      mes: mes, eventos: lista.length,
      realizados: lista.filter(function (linha) { return linha.ocorrido; }).length,
      futuros: lista.filter(function (linha) { return linha.futuro; }).length,
      contrato: dashboardV2Dinheiro_(soma(lista, 'contrato')), recebido: dashboardV2Dinheiro_(soma(lista, 'recebido')),
      custosProcessados: dashboardV2Dinheiro_(soma(lista, 'custosProcessados')),
      custosRestantes: dashboardV2Dinheiro_(soma(lista, 'custosRestantes')),
      liquidoProjetado: dashboardV2Dinheiro_(soma(lista, 'contratoLiquidoProjetado')),
      saldoFuturoLiquido: dashboardV2Dinheiro_(soma(lista, 'saldoFuturoLiquido'))
    });
  }

  const anos = {};
  todas.forEach(function (linha) {
    const item = anos[linha.ano] || { ano: linha.ano, eventos: 0, contrato: 0, recebido: 0, custosProcessados: 0, liquidoProjetado: 0 };
    item.eventos++; item.contrato += linha.contrato; item.recebido += linha.recebido; item.custosProcessados += linha.custosProcessados; item.liquidoProjetado += linha.contratoLiquidoProjetado;
    anos[linha.ano] = item;
  });
  const comparativo = Object.keys(anos).map(function (chave) {
    const item = anos[chave];
    item.ticketMedio = dashboardV2Media_(item.contrato, item.eventos);
    item.margemProjetada = item.contrato > 0 ? Number(((item.liquidoProjetado / item.contrato) * 100).toFixed(1)) : null;
    ['contrato', 'recebido', 'custosProcessados', 'liquidoProjetado'].forEach(function (campo) { item[campo] = dashboardV2Dinheiro_(item[campo]); });
    return item;
  }).sort(function (a, b) { return b.ano - a.ano; }).slice(0, 5);
  const anoAtual = comparativo.filter(function (item) { return item.ano === ano; })[0] || {};
  const anoAnterior = comparativo.filter(function (item) { return item.ano === ano - 1; })[0] || {};

  const agenda = [];
  for (let mes = 1; mes <= 12; mes++) {
    const amostra = todas.filter(function (linha) { return linha.ocorrido && linha.mes === mes && linha.criadoEm && linha.dataEvento > linha.criadoEm; })
      .map(function (linha) { return Math.round((linha.dataEvento.getTime() - linha.criadoEm.getTime()) / 86400000); })
      .filter(function (dias) { return dias >= 0 && dias <= 1460; });
    const atuais = linhasAno.filter(function (linha) { return linha.mes === mes; });
    agenda.push({
      mes: mes, eventosAtuais: atuais.length, contratoAtual: dashboardV2Dinheiro_(soma(atuais, 'contrato')),
      amostra: amostra.length, medianaDias: dashboardV2Percentil_(amostra, 0.5), p25Dias: dashboardV2Percentil_(amostra, 0.25), p75Dias: dashboardV2Percentil_(amostra, 0.75),
      fechadosAte90DiasPct: amostra.length ? Number((amostra.filter(function (dias) { return dias <= 90; }).length / amostra.length * 100).toFixed(1)) : null,
      fechadosCom180OuMaisPct: amostra.length ? Number((amostra.filter(function (dias) { return dias >= 180; }).length / amostra.length * 100).toFixed(1)) : null
    });
  }

  const custos = [
    { codigo: 'COMISSAO', nome: 'Comissões', processado: resumo.comissaoProcessada, projetado: resumo.comissaoComprometida },
    { codigo: 'FOLHA', nome: 'Folha de custos', processado: resumo.folhaProcessada, projetado: resumo.folhaProjetada },
    { codigo: 'BV', nome: 'BV', processado: resumo.bvProcessado, projetado: resumo.bvComprometido },
    { codigo: 'NF', nome: 'Notas fiscais', processado: resumo.nfProcessada, projetado: resumo.nfComprometida }
  ].map(function (item) {
    item.restante = dashboardV2Dinheiro_(Math.max(item.projetado - item.processado, 0));
    item.pctContrato = resumo.contrato > 0 ? Number((item.projetado / resumo.contrato * 100).toFixed(1)) : null;
    return item;
  });

  const insights = [];
  insights.push({ tipo: 'CAIXA', titulo: 'Caixa líquido atual', texto: 'Após deduzir custos processados dos recebimentos vinculados aos eventos, o caixa líquido do recorte é ' + resumo.caixaLiquidoAtual + '.' });
  insights.push({ tipo: 'FUTURO', titulo: 'Saldo futuro líquido', texto: 'Dos valores ainda a receber, a projeção líquida após custos restantes é ' + resumo.saldoFuturoLiquido + '.' });
  if (anoAnterior.contrato > 0) insights.push({ tipo: 'COMPARATIVO', titulo: 'Comparação anual', texto: 'O contratado está ' + Math.abs(dashboardV2Variacao_(anoAtual.contrato || 0, anoAnterior.contrato)) + '% ' + ((anoAtual.contrato || 0) >= anoAnterior.contrato ? 'acima' : 'abaixo') + ' do ano anterior.' });
  if (folhaGlobal.qtd > 0) insights.push({ tipo: 'FOLHA', titulo: 'Referência de folha', texto: 'A estimativa usa ' + folhaGlobal.qtd + ' folhas processadas; média geral de ' + mediaFolhaGlobal + ' por ocorrência.' });

  return {
    versao: '3.0-analytics',
    premissas: {
      processado: 'Somente movimentos com STATUS PROCESSADO no livro financeiro.',
      comprometido: 'Maior valor entre snapshot configurado e movimentos já registrados, sem duplicar o que foi pago.',
      folha: 'Para evento sem folha, prioriza média do tipo com ao menos 3 casos, depois projeto e base geral.',
      saldoFuturoLiquido: 'A receber menos todos os custos ainda necessários para concluir os eventos.'
    },
    resumo: resumo,
    execucao: { realizados: realizados.length, futuros: futuros.length, porTipo: agrupar('tipoEvento') },
    recebimentos: { mensalMovimento: Object.keys(livro.mensal).map(function (chave) { return livro.mensal[chave]; }), percentual: resumo.recebimentoPct },
    custos: { categorias: custos, mediaFolhaGlobal: mediaFolhaGlobal, amostraFolhaGlobal: folhaGlobal.qtd, porTipoFolha: Object.keys(historicoFolhaTipo).map(function (chave) { return { nome: chave, media: dashboardV2Media_(historicoFolhaTipo[chave].soma, historicoFolhaTipo[chave].qtd), amostra: historicoFolhaTipo[chave].qtd }; }).sort(function (a, b) { return b.media - a.media; }) },
    mensalEconomico: mensalEconomico,
    comparativoAnual: { anos: comparativo, variacao: { contratoPct: dashboardV2Variacao_(anoAtual.contrato || 0, anoAnterior.contrato || 0), recebidoPct: dashboardV2Variacao_(anoAtual.recebido || 0, anoAnterior.recebido || 0), eventosPct: dashboardV2Variacao_(anoAtual.eventos || 0, anoAnterior.eventos || 0) } },
    rankings: { tipos: agrupar('tipoEvento'), projetos: agrupar('projeto'), cerimonialistas: agrupar('cerimonialista'), vendedores: agrupar('vendedor') },
    formacaoAgenda: { meses: agenda, criterio: 'Antecedência entre DATA_CRIACAO e DATA_EVENTO; amostras inválidas ou superiores a quatro anos são descartadas.' },
    auditoria: linhasAno.map(function (linha) {
      return {
        idEvento: linha.idEvento, nomeEvento: linha.nomeEvento, dataEvento: linha.dataEvento.getTime(), tipoEvento: linha.tipoEvento, projeto: linha.projeto, cerimonialista: linha.cerimonialista, vendedor: linha.vendedor,
        futuro: linha.futuro, contrato: dashboardV2Dinheiro_(linha.contrato), recebido: dashboardV2Dinheiro_(linha.recebido), aReceber: dashboardV2Dinheiro_(linha.aReceber),
        custosProcessados: dashboardV2Dinheiro_(linha.custosProcessados), custosRestantes: dashboardV2Dinheiro_(linha.custosRestantes),
        custoTotalProjetado: dashboardV2Dinheiro_(linha.custoTotalProjetado), caixaLiquidoAtual: dashboardV2Dinheiro_(linha.caixaLiquidoAtual),
        contratoLiquidoProjetado: dashboardV2Dinheiro_(linha.contratoLiquidoProjetado), saldoFuturoLiquido: dashboardV2Dinheiro_(linha.saldoFuturoLiquido), margemProjetada: linha.margemProjetada === null ? null : Number(linha.margemProjetada.toFixed(1)),
        composicao: { comissao: dashboardV2Dinheiro_(linha.comissaoComprometida), folha: dashboardV2Dinheiro_(linha.folhaProjetada), bv: dashboardV2Dinheiro_(linha.bvComprometido), nf: dashboardV2Dinheiro_(linha.nfComprometida), outros: dashboardV2Dinheiro_(linha.outrasSaidas) },
        composicaoProcessada: { comissao: dashboardV2Dinheiro_(linha.comissaoPaga), folha: dashboardV2Dinheiro_(linha.folhaPaga), bv: dashboardV2Dinheiro_(linha.bvPago), nf: dashboardV2Dinheiro_(linha.nfPaga), outros: dashboardV2Dinheiro_(linha.outrasSaidas) },
        estimativaFolha: { valor: dashboardV2Dinheiro_(linha.folhaEstimada), origem: linha.folhaOrigem, amostra: linha.folhaAmostra }
      };
    }).sort(function (a, b) { return a.dataEvento - b.dataEvento; }).slice(0, 300),
    insights: insights
  };
}
