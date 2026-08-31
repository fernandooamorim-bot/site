/**
 * Adaptador da planilha independente do Precificador.
 * A calculadora mantém seus parâmetros fora do banco operacional, mas toda
 * leitura e todo cálculo passam pelo Apps Script principal autenticado.
 */

const PRECIFICADOR_SHOW_CONFIG_ID_CHAVE_ = 'PRECIFICADOR_SHOW_SPREADSHEET_ID';

function precificadorShowIdPlanilha_() {
  const id = String(obterConfigSeguro(PRECIFICADOR_SHOW_CONFIG_ID_CHAVE_) || '').trim();
  if (!id) throw new Error('PRECIFICADOR_SHOW_CONFIG_INCOMPLETA: ' + PRECIFICADOR_SHOW_CONFIG_ID_CHAVE_);
  return id;
}

function precificadorShowLerAba_(planilha, nome, colunas) {
  const aba = planilha.getSheetByName(nome);
  if (!aba) throw new Error('PRECIFICADOR_SHOW_ABA_AUSENTE: ' + nome);
  const linhas = Math.max(1, Number(aba.getLastRow()) || 1);
  return aba.getRange(1, 1, linhas, colunas).getValues();
}

function precificadorShowValorParametro_(mapa, chaves, fallback) {
  for (let i = 0; i < chaves.length; i++) {
    const chave = precificadorShowNormalizarChave_(chaves[i]);
    if (Object.prototype.hasOwnProperty.call(mapa, chave)) {
      const valor = precificadorShowNumero_(mapa[chave], NaN);
      if (Number.isFinite(valor)) return valor;
    }
  }
  return fallback;
}

function precificadorShowLerConfiguracao_() {
  const planilha = SpreadsheetApp.openById(precificadorShowIdPlanilha_());
  const linhasEquipe = precificadorShowLerAba_(planilha, 'Config_Musicos', 5);
  const linhasParametros = precificadorShowLerAba_(planilha, 'Config_Parametros', 2);
  const linhasTerceirizados = precificadorShowLerAba_(planilha, 'Config_Terceirizados', 3);
  const parametros = {};
  const equipePorId = {};
  const equipe = [];
  const custosPadrao = [];

  for (let i = 1; i < linhasParametros.length; i++) {
    const chave = precificadorShowTexto_(linhasParametros[i][0]);
    if (chave) parametros[precificadorShowNormalizarChave_(chave)] = linhasParametros[i][1];
  }
  for (let i = 1; i < linhasEquipe.length; i++) {
    const nome = precificadorShowTexto_(linhasEquipe[i][0]);
    const valor = precificadorShowNumero_(linhasEquipe[i][1], NaN);
    if (!nome || !Number.isFinite(valor) || valor < 0) continue;
    const id = precificadorShowNormalizarChave_(nome) + '_' + i;
    const item = {
      id: id,
      nome: nome,
      valor: valor,
      bandaCompleta: linhasEquipe[i][3] === true || precificadorShowNormalizarChave_(linhasEquipe[i][3]) === 'SIM',
      bandaReduzida: linhasEquipe[i][4] === true || precificadorShowNormalizarChave_(linhasEquipe[i][4]) === 'SIM'
    };
    equipe.push(item);
    equipePorId[id] = item;
  }
  for (let i = 1; i < linhasTerceirizados.length; i++) {
    const nome = precificadorShowTexto_(linhasTerceirizados[i][0]);
    if (!nome) continue;
    custosPadrao.push({
      nome: nome,
      categoria: precificadorShowTexto_(linhasTerceirizados[i][1]) || 'Outro'
    });
  }

  const categoriasPermitidas = custosPadrao.map(function (item) {
    return precificadorShowNormalizarChave_(item.categoria);
  });
  ['TRANSPORTE', 'HOSPEDAGEM', 'DIARIA', 'PASSAGEM_AEREA', 'ALIMENTACAO', 'PRODUCAO', 'PRODUCAO_LOCAL', 'TECNICO', 'EQUIPAMENTO', 'BACKLINE_ALUGUEL', 'MKT', 'OUTRO'].forEach(function (categoria) {
    if (categoriasPermitidas.indexOf(categoria) === -1) categoriasPermitidas.push(categoria);
  });
  const categoriasLogisticaTexto = String(
    parametros.CATEGORIAS_LOGISTICA || 'Transporte;Hospedagem;Passagem aérea;Diária;Produção Local;Backline Aluguel'
  ).split(';');
  const categoriasLogistica = categoriasLogisticaTexto.map(precificadorShowNormalizarChave_).filter(Boolean);

  return {
    equipe: equipe,
    equipePorId: equipePorId,
    custosPadrao: custosPadrao,
    categoriasPermitidas: categoriasPermitidas,
    categoriasLogistica: categoriasLogistica,
    margensMinimas: {
      usual: precificadorShowValorParametro_(parametros, ['Margem Mínima (%)', 'Lucro Mínimo Usual (%)', 'Comissão Fernando (%)'], 65),
      logistica: precificadorShowValorParametro_(parametros, ['Margem Mínima com Logística (%)', 'Margem Mínima com Logistica (%)', 'Lucro Mínimo Logística (%)', 'Lucro Mínimo Logistica (%)'], 60)
    },
    acrescimosFaixa: {
      ideal: precificadorShowValorParametro_(parametros, ['Acréscimo Ideal (%)', 'Acrescimo Ideal (%)', 'Margem Bom (%)'], 40),
      excelente: precificadorShowValorParametro_(parametros, ['Acréscimo Excelente (%)', 'Acrescimo Excelente (%)', 'Margem Ótimo (%)', 'Margem Otimo (%)'], 70)
    },
    bonusVendedorExcelente: precificadorShowValorParametro_(parametros, ['Bônus Vendedor Excelente (p.p.)', 'Bonus Vendedor Excelente (p.p.)'], 2),
    padroesComerciais: {
      bvPercentual: precificadorShowValorParametro_(parametros, ['BV Padrão (%)'], 0),
      nfPercentual: precificadorShowValorParametro_(parametros, ['NF Simples Nacional (%)'], 0),
      comissaoVendedor: precificadorShowValorParametro_(parametros, ['Comissão do Vendedor (%)', 'Comissão Sócio (%)'], 0)
    }
  };
}

function precificadorShowObterFormulario_() {
  const config = precificadorShowLerConfiguracao_();
  return {
    sucesso: true,
    equipe: config.equipe.map(function (item) {
      return { id: item.id, nome: item.nome, bandaCompleta: item.bandaCompleta, bandaReduzida: item.bandaReduzida };
    }),
    custosPadrao: config.custosPadrao,
    padroesComerciais: config.padroesComerciais
  };
}

function precificadorShowLerEntrada_(params) {
  const bruto = params && (params.simulacaoJson || params.simulacao);
  if (!bruto) throw new Error('PRECIFICADOR_SIMULACAO_OBRIGATORIA');
  let entrada = bruto;
  if (typeof bruto === 'string') {
    try { entrada = JSON.parse(bruto); } catch (_) { throw new Error('PRECIFICADOR_SIMULACAO_INVALIDA'); }
  }
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) throw new Error('PRECIFICADOR_SIMULACAO_INVALIDA');
  if (Array.isArray(entrada.equipe) && entrada.equipe.length > 30) throw new Error('PRECIFICADOR_EQUIPE_EXCESSIVA');
  if (Array.isArray(entrada.adicionaisEquipe) && entrada.adicionaisEquipe.length > 2) throw new Error('PRECIFICADOR_ADICIONAIS_EQUIPE_EXCESSIVOS');
  if (Array.isArray(entrada.custos) && entrada.custos.length > 20) throw new Error('PRECIFICADOR_CUSTOS_EXCESSIVOS');
  return entrada;
}

function precificadorShowSimular(params) {
  const entrada = precificadorShowLerEntrada_(params);
  const resultado = precificadorShowSimular_(entrada, precificadorShowLerConfiguracao_());
  // Não expor margem, perfil ou lucro interno à interface comercial.
  delete resultado.interno;
  return resultado;
}

function precificadorShowSalvarSimulacao(params, email) {
  const entrada = precificadorShowLerEntrada_(params);
  const config = precificadorShowLerConfiguracao_();
  const resultado = precificadorShowSimular_(entrada, config);
  const planilha = SpreadsheetApp.openById(precificadorShowIdPlanilha_());
  const nomeAba = 'Historico_Simulacoes';
  let aba = planilha.getSheetByName(nomeAba);
  if (!aba) {
    aba = planilha.insertSheet(nomeAba);
    aba.getRange(1, 1, 1, 8).setValues([[
      'ID_SIMULACAO', 'CRIADO_EM', 'USUARIO', 'FAIXA_SELECIONADA',
      'ENTRADA_JSON', 'RESULTADO_JSON', 'REGRA_INTERNA_JSON', 'VERSAO'
    ]]);
    aba.setFrozenRows(1);
  }
  const faixa = ['minimo', 'ideal', 'excelente'].indexOf(precificadorShowTexto_(params.faixaSelecionada)) !== -1
    ? precificadorShowTexto_(params.faixaSelecionada) : 'ideal';
  const id = 'SIM-' + Utilities.getUuid().slice(0, 12).toUpperCase();
  aba.appendRow([
    id,
    new Date(),
    String(email || '').trim(),
    faixa,
    JSON.stringify(entrada),
    JSON.stringify({ faixas: resultado.faixas, custos: resultado.custos, alertas: resultado.alertas }),
    JSON.stringify(resultado.interno),
    '2'
  ]);
  return { sucesso: true, idSimulacao: id, mensagem: 'Simulação salva para consulta.' };
}
