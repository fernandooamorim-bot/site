/**
 * Motor puro do Precificador de Show.
 *
 * A tela nunca calcula valores: ela envia escolhas e o backend aplica esta
 * regra sobre uma configuração oficial. Os percentuais de margem são dados
 * internos; o retorno público traz somente preços, custos e comissões.
 */

const PRECIFICADOR_SHOW_PERFIS_PADRAO_ = {
  usual: { minimo: 65, ideal: 70, excelente: 75 },
  logistica: { minimo: 60, ideal: 65, excelente: 70 }
};

function precificadorShowNumero_(valor, fallback) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : (fallback === undefined ? 0 : fallback);
}

function precificadorShowDinheiro_(valor) {
  return Number(precificadorShowNumero_(valor).toFixed(2));
}

function precificadorShowTexto_(valor) {
  return String(valor || '').trim();
}

function precificadorShowNormalizarChave_(valor) {
  return precificadorShowTexto_(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function precificadorShowPerfil_(entrada, config) {
  if (entrada && entrada.perfil === 'logistica') return 'logistica';
  const custos = Array.isArray(entrada && entrada.custos) ? entrada.custos : [];
  const categoriasLogistica = (config && config.categoriasLogistica) || [];
  const possuiLogistica = custos.some(function (item) {
    return categoriasLogistica.indexOf(precificadorShowNormalizarChave_(item && item.categoria)) !== -1;
  });
  return possuiLogistica ? 'logistica' : 'usual';
}

function precificadorShowMargens_(perfil, config) {
  const origem = (config && config.margens && config.margens[perfil]) || PRECIFICADOR_SHOW_PERFIS_PADRAO_[perfil] || PRECIFICADOR_SHOW_PERFIS_PADRAO_.usual;
  const minimo = precificadorShowNumero_(origem.minimo, 0);
  const ideal = precificadorShowNumero_(origem.ideal, minimo);
  const excelente = precificadorShowNumero_(origem.excelente, ideal);
  if (minimo < 0 || ideal < minimo || excelente < ideal || excelente >= 100) {
    throw new Error('PRECIFICADOR_MARGENS_INVALIDAS');
  }
  return { minimo: minimo, ideal: ideal, excelente: excelente };
}

function precificadorShowSomarCustos_(entrada, config) {
  const equipeSelecionada = Array.isArray(entrada && entrada.equipe) ? entrada.equipe : [];
  const custosInformados = Array.isArray(entrada && entrada.custos) ? entrada.custos : [];
  const equipeOficial = (config && config.equipePorId) || {};
  const categoriasPermitidas = (config && config.categoriasPermitidas) || [];
  const detalhesEquipe = [];
  const detalhesCustos = [];
  const alertas = [];
  let totalEquipe = 0;
  let totalCustos = 0;

  equipeSelecionada.forEach(function (selecionado) {
    const id = precificadorShowTexto_(selecionado && selecionado.id);
    const oficial = equipeOficial[id];
    if (!oficial) throw new Error('PRECIFICADOR_EQUIPE_INVALIDA: ' + id);
    const valorOficial = precificadorShowNumero_(oficial.valor, 0);
    const ajuste = selecionado && selecionado.ajuste;
    let valorAplicado = valorOficial;
    let motivo = '';
    if (ajuste && ajuste.ativo) {
      valorAplicado = precificadorShowNumero_(ajuste.valor, -1);
      motivo = precificadorShowTexto_(ajuste.motivo);
      if (valorAplicado < 0 || !motivo) throw new Error('PRECIFICADOR_AJUSTE_EQUIPE_INVALIDO: ' + id);
      if (valorAplicado < valorOficial) {
        alertas.push('Cachê abaixo do padrão: ' + oficial.nome);
      }
    }
    totalEquipe += valorAplicado;
    detalhesEquipe.push({ id: id, nome: oficial.nome, valor: precificadorShowDinheiro_(valorAplicado), ajuste: valorAplicado !== valorOficial, motivo: motivo });
  });

  const categoriasUsadas = {};
  custosInformados.forEach(function (custo) {
    const categoria = precificadorShowNormalizarChave_(custo && custo.categoria);
    const descricao = precificadorShowTexto_(custo && custo.descricao);
    const valor = precificadorShowNumero_(custo && custo.valor, -1);
    if (!categoria || categoriasPermitidas.indexOf(categoria) === -1 || valor < 0) {
      throw new Error('PRECIFICADOR_CUSTO_INVALIDO');
    }
    if (categoria === 'OUTRO' && !descricao) throw new Error('PRECIFICADOR_CUSTO_OUTRO_SEM_DESCRICAO');
    categoriasUsadas[categoria] = (categoriasUsadas[categoria] || 0) + 1;
    totalCustos += valor;
    detalhesCustos.push({ categoria: categoria, descricao: descricao, valor: precificadorShowDinheiro_(valor) });
  });
  Object.keys(categoriasUsadas).forEach(function (categoria) {
    if (categoriasUsadas[categoria] > 1) alertas.push('Confira custos repetidos em ' + categoria.replace(/_/g, ' ').toLowerCase() + '.');
  });
  return {
    equipe: detalhesEquipe,
    custos: detalhesCustos,
    totalEquipe: precificadorShowDinheiro_(totalEquipe),
    totalCustos: precificadorShowDinheiro_(totalCustos),
    totalOperacional: precificadorShowDinheiro_(totalEquipe + totalCustos),
    alertas: alertas
  };
}

function precificadorShowCalcularFaixa_(dados) {
  const margem = precificadorShowNumero_(dados.margem, -1) / 100;
  const comissaoBase = precificadorShowNumero_(dados.comissaoVendedor, -1) / 100;
  const bonusVendedor = precificadorShowNumero_(dados.bonusVendedor, 0) / 100;
  const percentualVendedor = comissaoBase + bonusVendedor;
  const percentualBv = dados.bv && dados.bv.ativo && dados.bv.tipo === 'percentual'
    ? precificadorShowNumero_(dados.bv.valor, -1) / 100 : 0;
  const bvFixo = dados.bv && dados.bv.ativo && dados.bv.tipo === 'fixo'
    ? precificadorShowNumero_(dados.bv.valor, -1) : 0;
  const percentualNf = dados.nf && dados.nf.ativo ? precificadorShowNumero_(dados.nf.valor, -1) / 100 : 0;
  const percentualTaxas = precificadorShowNumero_(dados.taxasPercentuais, 0) / 100;

  if ([margem, comissaoBase, bonusVendedor, percentualBv, bvFixo, percentualNf, percentualTaxas].some(function (valor) { return valor < 0; })) {
    throw new Error('PRECIFICADOR_PERCENTUAL_INVALIDO');
  }
  const coeficiente = margem + percentualNf + percentualTaxas + percentualBv + (percentualVendedor * (1 - percentualNf - percentualTaxas - percentualBv));
  const denominador = 1 - coeficiente;
  if (denominador <= 0.001) throw new Error('PRECIFICADOR_CENARIO_INVIAVEL');

  const custoOperacional = precificadorShowNumero_(dados.custoOperacional, 0);
  const preco = (custoOperacional + (bvFixo * (1 - percentualVendedor))) / denominador;
  const bv = preco * percentualBv + bvFixo;
  const nf = preco * percentualNf;
  const taxas = preco * percentualTaxas;
  const baseVendedor = Math.max(preco - bv - nf - taxas, 0);
  const comissao = baseVendedor * percentualVendedor;
  const comissaoBaseValor = baseVendedor * comissaoBase;
  const bonusValor = baseVendedor * bonusVendedor;
  const lucro = preco * margem;
  return {
    valor: precificadorShowDinheiro_(preco),
    percentualAumento: 0,
    comissaoVendedor: precificadorShowDinheiro_(comissao),
    comissaoBaseVendedor: precificadorShowDinheiro_(comissaoBaseValor),
    bonusVendedor: precificadorShowDinheiro_(bonusValor),
    valorBv: precificadorShowDinheiro_(bv),
    valorNf: precificadorShowDinheiro_(nf),
    valorTaxas: precificadorShowDinheiro_(taxas),
    lucroInterno: precificadorShowDinheiro_(lucro)
  };
}

function precificadorShowSimular_(entrada, config) {
  const custos = precificadorShowSomarCustos_(entrada || {}, config || {});
  if (custos.totalOperacional <= 0) throw new Error('PRECIFICADOR_SEM_CUSTOS');
  const perfil = precificadorShowPerfil_(entrada || {}, config || {});
  const margens = precificadorShowMargens_(perfil, config || {});
  const comercial = (entrada && entrada.comercial) || {};
  const bonusExcelente = precificadorShowNumero_(config && config.bonusVendedorExcelente, 0);
  const base = {
    custoOperacional: custos.totalOperacional,
    comissaoVendedor: precificadorShowNumero_(comercial.comissaoVendedor, 0),
    bv: comercial.bv || { ativo: false },
    nf: comercial.nf || { ativo: false },
    taxasPercentuais: comercial.taxasPercentuais
  };
  const minimo = precificadorShowCalcularFaixa_(Object.assign({}, base, { margem: margens.minimo, bonusVendedor: 0 }));
  const ideal = precificadorShowCalcularFaixa_(Object.assign({}, base, { margem: margens.ideal, bonusVendedor: 0 }));
  const excelente = precificadorShowCalcularFaixa_(Object.assign({}, base, { margem: margens.excelente, bonusVendedor: bonusExcelente }));
  [ideal, excelente].forEach(function (faixa) {
    faixa.percentualAumento = minimo.valor > 0
      ? Number((((faixa.valor / minimo.valor) - 1) * 100).toFixed(1)) : 0;
  });
  return {
    sucesso: true,
    faixas: { minimo: minimo, ideal: ideal, excelente: excelente },
    custos: custos,
    alertas: custos.alertas,
    interno: { perfil: perfil, margens: margens }
  };
}
