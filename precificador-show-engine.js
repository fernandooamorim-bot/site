/**
 * Motor puro do Precificador de Show.
 *
 * A tela nunca calcula valores: ela envia escolhas e o backend aplica esta
 * regra sobre uma configuração oficial. Os percentuais de margem são dados
 * internos; o retorno público traz somente preços, custos e comissões.
 */

const PRECIFICADOR_SHOW_MARGENS_MINIMAS_PADRAO_ = {
  usual: 65,
  logistica: 60
};

const PRECIFICADOR_SHOW_ACRESCIMOS_PADRAO_ = {
  ideal: 40,
  excelente: 70
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

function precificadorShowMargemMinima_(perfil, config) {
  const legado = config && config.margens && config.margens[perfil];
  const margem = precificadorShowNumero_(
    config && config.margensMinimas && config.margensMinimas[perfil],
    legado && legado.minimo !== undefined
      ? legado.minimo
      : (PRECIFICADOR_SHOW_MARGENS_MINIMAS_PADRAO_[perfil] || PRECIFICADOR_SHOW_MARGENS_MINIMAS_PADRAO_.usual)
  );
  if (margem < 0 || margem >= 100) throw new Error('PRECIFICADOR_MARGEM_MINIMA_INVALIDA');
  return margem;
}

function precificadorShowAcrescimosFaixa_(config) {
  const origem = (config && config.acrescimosFaixa) || {};
  const ideal = precificadorShowNumero_(origem.ideal, PRECIFICADOR_SHOW_ACRESCIMOS_PADRAO_.ideal);
  const excelente = precificadorShowNumero_(origem.excelente, PRECIFICADOR_SHOW_ACRESCIMOS_PADRAO_.excelente);
  if (ideal < 0 || excelente < ideal) throw new Error('PRECIFICADOR_ACRESCIMOS_INVALIDOS');
  return { ideal: ideal, excelente: excelente };
}

function precificadorShowPisoComercial_(config) {
  const origem = (config && config.pisoComercial) || {};
  const ativoNormalizado = precificadorShowNormalizarChave_(origem.ativo);
  const ativo = origem.ativo === true || ['SIM', 'TRUE', 'ATIVO', '1'].indexOf(ativoNormalizado) !== -1;
  const valor = precificadorShowDinheiro_(precificadorShowNumero_(origem.valor, 0));

  // Um piso desligado não participa do cálculo. Quando ligado, valor nulo ou
  // negativo seria uma configuração ambígua e deve falhar antes de precificar.
  if (ativo && valor <= 0) throw new Error('PRECIFICADOR_PISO_COMERCIAL_INVALIDO');
  return { ativo: ativo, valor: valor };
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
    if (ajuste && ajuste.ativo) {
      valorAplicado = precificadorShowNumero_(ajuste.valor, -1);
      if (valorAplicado < 0) throw new Error('PRECIFICADOR_AJUSTE_EQUIPE_INVALIDO: ' + id);
      if (valorAplicado < valorOficial) {
        alertas.push('Cachê abaixo do padrão: ' + oficial.nome);
      }
    }
    totalEquipe += valorAplicado;
    detalhesEquipe.push({ id: id, nome: oficial.nome, valor: precificadorShowDinheiro_(valorAplicado), ajuste: valorAplicado !== valorOficial });
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

function precificadorShowCalcularMinimo_(dados) {
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
  const lucro = preco - custoOperacional - bv - nf - taxas - comissao;
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

function precificadorShowDetalharPreco_(dados) {
  const preco = precificadorShowNumero_(dados.preco, -1);
  const comissaoBase = precificadorShowNumero_(dados.comissaoVendedor, -1) / 100;
  const bonusVendedor = precificadorShowNumero_(dados.bonusVendedor, 0) / 100;
  const percentualVendedor = comissaoBase + bonusVendedor;
  const percentualBv = dados.bv && dados.bv.ativo && dados.bv.tipo === 'percentual'
    ? precificadorShowNumero_(dados.bv.valor, -1) / 100 : 0;
  const bvFixo = dados.bv && dados.bv.ativo && dados.bv.tipo === 'fixo'
    ? precificadorShowNumero_(dados.bv.valor, -1) : 0;
  const percentualNf = dados.nf && dados.nf.ativo ? precificadorShowNumero_(dados.nf.valor, -1) / 100 : 0;
  const percentualTaxas = precificadorShowNumero_(dados.taxasPercentuais, 0) / 100;
  const custoOperacional = precificadorShowNumero_(dados.custoOperacional, 0);
  if ([preco, comissaoBase, bonusVendedor, percentualBv, bvFixo, percentualNf, percentualTaxas].some(function (valor) { return valor < 0; })) {
    throw new Error('PRECIFICADOR_PERCENTUAL_INVALIDO');
  }
  const bv = preco * percentualBv + bvFixo;
  const nf = preco * percentualNf;
  const taxas = preco * percentualTaxas;
  const baseVendedor = Math.max(preco - bv - nf - taxas, 0);
  const comissaoBaseValor = baseVendedor * comissaoBase;
  const bonusValor = baseVendedor * bonusVendedor;
  const comissao = comissaoBaseValor + bonusValor;
  const lucro = preco - custoOperacional - bv - nf - taxas - comissao;
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
  const margemMinima = precificadorShowMargemMinima_(perfil, config || {});
  const acrescimos = precificadorShowAcrescimosFaixa_(config || {});
  const pisoComercial = precificadorShowPisoComercial_(config || {});
  const comercial = (entrada && entrada.comercial) || {};
  const bonusExcelente = precificadorShowNumero_(config && config.bonusVendedorExcelente, 0);
  const base = {
    custoOperacional: custos.totalOperacional,
    comissaoVendedor: precificadorShowNumero_(comercial.comissaoVendedor, 0),
    bv: comercial.bv || { ativo: false },
    nf: comercial.nf || { ativo: false },
    taxasPercentuais: comercial.taxasPercentuais
  };
  const minimoFinanceiro = precificadorShowCalcularMinimo_(Object.assign({}, base, { margem: margemMinima, bonusVendedor: 0 }));
  const pisoAplicado = pisoComercial.ativo && pisoComercial.valor > minimoFinanceiro.valor;
  const minimo = pisoAplicado
    ? precificadorShowDetalharPreco_(Object.assign({}, base, { preco: pisoComercial.valor, bonusVendedor: 0 }))
    : minimoFinanceiro;
  const ideal = precificadorShowDetalharPreco_(Object.assign({}, base, {
    preco: minimo.valor * (1 + (acrescimos.ideal / 100)),
    bonusVendedor: 0
  }));
  const excelente = precificadorShowDetalharPreco_(Object.assign({}, base, {
    preco: minimo.valor * (1 + (acrescimos.excelente / 100)),
    bonusVendedor: bonusExcelente
  }));
  ideal.percentualAumento = acrescimos.ideal;
  excelente.percentualAumento = acrescimos.excelente;
  return {
    sucesso: true,
    faixas: { minimo: minimo, ideal: ideal, excelente: excelente },
    custos: custos,
    alertas: custos.alertas,
    interno: {
      perfil: perfil,
      margemMinima: margemMinima,
      acrescimos: acrescimos,
      pisoComercial: {
        ativo: pisoComercial.ativo,
        valorConfigurado: pisoComercial.valor,
        aplicado: pisoAplicado,
        minimoFinanceiro: minimoFinanceiro.valor
      }
    }
  };
}
