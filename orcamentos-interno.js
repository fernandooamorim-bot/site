/**
 * ======================================================
 * ORÇAMENTOS — MOTOR INTERNO
 * ======================================================
 * Executa dentro do Apps Script principal e grava na aba ORCAMENTOS.
 * Mantém o contrato de resposta consumido pelo frontend.
 */

function obterConfigOrcamentoInterno_() {
  const cfg = getConfig() || {};
  const resultado = {
    aba: String(cfg.ORCAMENTO_ABA || 'ORCAMENTOS').trim(),
    timezone: String(cfg.ORCAMENTO_TIMEZONE || 'America/Fortaleza').trim(),
    templateId: String(cfg.ORCAMENTO_TEMPLATE_ID || '').trim(),
    pastaPdfId: String(cfg.ORCAMENTO_PASTA_PDF_ID || '').trim(),
    lockWaitMs: limitarNumeroOrcamentoInterno_(cfg.ORCAMENTO_LOCK_WAIT_MS, 20000, 5000, 30000),
    retryMax: limitarNumeroOrcamentoInterno_(cfg.ORCAMENTO_RETRY_MAX, 5, 1, 6),
    retryBaseMs: limitarNumeroOrcamentoInterno_(cfg.ORCAMENTO_RETRY_BASE_MS, 450, 100, 2000)
  };
  if (!resultado.aba) throw new Error('ORCAMENTO_CONFIG_INCOMPLETA: ORCAMENTO_ABA');
  return resultado;
}

function limitarNumeroOrcamentoInterno_(valor, fallback, min, max) {
  const n = Number(String(valor == null ? '' : valor).trim());
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function obterAbaOrcamentosInterna_() {
  const cfg = obterConfigOrcamentoInterno_();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cfg.aba);
  if (!sheet) throw new Error('ABA_ORCAMENTOS_NAO_ENCONTRADA: ' + cfg.aba);
  const cols = obterColunasOrcamentoInterno_(sheet);
  return { sheet: sheet, cols: cols, cfg: cfg };
}

function obterColunasOrcamentoInterno_(sheet) {
  const obrigatorias = [
    ['timestamp', ['Carimbo de data/hora', 'Timestamp', 'Data/hora']],
    ['nome', ['Nome do contratante', 'Nome']],
    ['telefone', ['Telefone (WhatsApp)', 'Telefone (WhatsAp)', 'Telefone']],
    ['dataEvento', ['Data do Evento', 'Data de Evento', 'Data Evento']],
    ['propostas', ['Propostas Desejadas', 'Propostas Desejada', 'Propostas']],
    ['valorGold', ['Valor Gold']],
    ['valorPremium', ['Valor Premium']],
    ['valorPocket', ['Valor Pocket']],
    ['valorDebut', ['Valor Debut', 'Valor Début']],
    ['numeroOrcamento', ['Nº Orçamento', 'Número Orçamento', 'Numero Orçamento', 'Numero Orcamento']],
    ['linkPdf', ['Link do PDF', 'Link PDF', 'PDF']],
    ['linkWhats', ['Link do Whatsapp', 'Link do WhatsApp', 'Link WhatsApp']],
    ['local', ['Local', 'Local do Evento']],
    ['observacoes', ['Observações', 'Observacoes', 'Observação', 'Observacao']],
    ['criadoPor', ['Criado por', 'Criado Por', 'Operador']],
    ['statusComercial', ['STATUS_COMERCIAL', 'Status comercial']],
    ['eventoVinculadoId', ['EVENTO_VINCULADO_ID', 'Evento vinculado ID']],
    ['vinculadaEm', ['VINCULADA_EM', 'Vinculada em']],
    ['vinculadaPor', ['VINCULADA_POR', 'Vinculada por']]
  ];
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const mapa = {};
  headers.forEach(function (header, index) {
    const normalizado = normalizarCabecalhoOrcamentoInterno_(header);
    if (normalizado) mapa[normalizado] = index + 1;
  });
  const cols = {};
  obrigatorias.forEach(function (def) {
    const chave = def[0];
    const aliases = def[1];
    let coluna = 0;
    for (var i = 0; i < aliases.length && !coluna; i++) {
      coluna = Number(mapa[normalizarCabecalhoOrcamentoInterno_(aliases[i])] || 0);
    }
    if (!coluna) throw new Error('ORCAMENTO_ESTRUTURA_COLUNA_AUSENTE: ' + aliases[0]);
    cols[chave] = coluna;
  });
  return cols;
}

function normalizarCabecalhoOrcamentoInterno_(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function executarAcaoOrcamentoInterna_(action, payload, usuario) {
  const acao = String(action || '').trim();
  const dados = payload || {};
  if (acao === 'listarCandidatosVinculo') {
    return { sucesso: true, candidatos: listarCandidatosOrcamentoInterno_(dados), truncado: false };
  }
  if (acao === 'obterOrcamentoPorNumero') {
    return { sucesso: true, orcamento: obterOrcamentoInternoPorNumero_(dados.numeroOrcamento) };
  }
  if (acao === 'vincularOrcamentoEvento') {
    return Object.assign({ sucesso: true }, vincularOrcamentoInternoEvento_(dados, usuario));
  }
  if (acao === 'desvincularOrcamentoEvento') {
    return Object.assign({ sucesso: true }, desvincularOrcamentoInternoEvento_(dados, usuario));
  }
  if (acao === 'marcarOrcamentoEventoCancelado') {
    return Object.assign({ sucesso: true }, cancelarEventoOrcamentoInterno_(dados, usuario));
  }
  if (acao === 'listarVinculosOrcamentos') {
    return { sucesso: true, vinculos: listarVinculosOrcamentosInternos_() };
  }
  throw new Error('ORCAMENTO_ACAO_INTERNA_INVALIDA: ' + acao);
}

function gerarOrcamentoInternoLocal_(params, usuario) {
  const payload = normalizarPayloadOrcamentoInterno_(params);
  const estrutura = obterAbaOrcamentosInterna_();
  if (!estrutura.cfg.templateId) throw new Error('ORCAMENTO_CONFIG_INCOMPLETA: ORCAMENTO_TEMPLATE_ID');
  if (!estrutura.cfg.pastaPdfId) throw new Error('ORCAMENTO_CONFIG_INCOMPLETA: ORCAMENTO_PASTA_PDF_ID');

  const tokenLock = adquirirLockOrcamentoInterno_(estrutura.cfg.lockWaitMs);
  try {
    const rowNum = registrarOrcamentoInterno_(estrutura.sheet, estrutura.cols, payload, usuario);
    const resultado = gerarPdfOrcamentoInterno_(
      estrutura.sheet,
      estrutura.cols,
      estrutura.cfg,
      rowNum
    );
    incrementarVersaoCacheOrcamentoInterno_();
    registrarLog('GERAR_ORCAMENTO', 'ORCAMENTOS', resultado.numeroOrcamento, JSON.stringify({
      linha: rowNum,
      executor: formatarUsuarioOrcamentoInterno_(usuario)
    }));
    return {
      sucesso: true,
      numeroOrcamento: resultado.numeroOrcamento,
      linkPdf: resultado.linkPdf,
      linkWhats: resultado.linkWhats,
      mensagem: 'Orçamento gerado com sucesso.'
    };
  } finally {
    liberarLockOrcamentoInterno_(tokenLock);
  }
}

function normalizarPayloadOrcamentoInterno_(params) {
  const p = params || {};
  const propostas = normalizarListaPropostasOrcamentoInterno_(p.propostas);
  const resultado = {
    nome: String(p.nome || '').trim(),
    telefone: normalizarTelefoneOrcamentoInterno_(p.telefone),
    dataEvento: String(p.dataEvento || '').trim(),
    local: String(p.local || '').trim(),
    propostas: propostas,
    valorGold: propostas.indexOf('gold') !== -1 ? numeroOuVazioOrcamentoInterno_(p.valorGold) : '',
    valorPremium: propostas.indexOf('premium') !== -1 ? numeroOuVazioOrcamentoInterno_(p.valorPremium) : '',
    valorPocket: propostas.indexOf('pocket') !== -1 ? numeroOuVazioOrcamentoInterno_(p.valorPocket) : '',
    valorDebut: propostas.indexOf('debut') !== -1 ? numeroOuVazioOrcamentoInterno_(p.valorDebut) : '',
    observacoes: String(p.observacoes || '').trim()
  };
  if (!resultado.nome) throw new Error('ORCAMENTO_DADO_OBRIGATORIO: nome');
  if (!resultado.telefone) throw new Error('ORCAMENTO_DADO_OBRIGATORIO: telefone');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resultado.dataEvento)) throw new Error('ORCAMENTO_DADO_OBRIGATORIO: dataEvento');
  if (!resultado.local) throw new Error('ORCAMENTO_DADO_OBRIGATORIO: local');
  if (resultado.local.length > 60) throw new Error('ORCAMENTO_LOCAL_LIMITE: máximo de 60 caracteres');
  if (!resultado.propostas.length) throw new Error('ORCAMENTO_DADO_OBRIGATORIO: propostas');
  return resultado;
}

function normalizarListaPropostasOrcamentoInterno_(valor) {
  const lista = Array.isArray(valor) ? valor : String(valor || '').split(',');
  return lista.map(function (item) {
    return String(item || '').trim().toLowerCase();
  }).filter(function (item, index, todos) {
    return ['pocket', 'gold', 'premium', 'debut'].indexOf(item) !== -1 &&
      todos.indexOf(item) === index;
  });
}

function numeroOuVazioOrcamentoInterno_(valor) {
  if (valor == null || String(valor).trim() === '') return '';
  const n = Number(String(valor).replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? '' : n;
}

function normalizarTelefoneOrcamentoInterno_(valor) {
  let telefone = String(valor || '').replace(/\D/g, '');
  if (!telefone) return '';
  if (telefone.indexOf('55') !== 0) telefone = '55' + telefone;
  return telefone;
}

function dataIsoOrcamentoInterno_(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('DATA_EVENTO_INVALIDA');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  if (isNaN(d.getTime())) throw new Error('DATA_EVENTO_INVALIDA');
  return d;
}

function registrarOrcamentoInterno_(sheet, cols, payload, usuario) {
  const rowNum = sheet.getLastRow() + 1;
  const largura = Math.max(sheet.getLastColumn(), 19);
  const linha = Array(largura).fill('');
  linha[cols.timestamp - 1] = new Date();
  linha[cols.nome - 1] = payload.nome;
  linha[cols.telefone - 1] = payload.telefone;
  linha[cols.dataEvento - 1] = dataIsoOrcamentoInterno_(payload.dataEvento);
  linha[cols.propostas - 1] = payload.propostas.join(', ');
  linha[cols.valorGold - 1] = payload.valorGold;
  linha[cols.valorPremium - 1] = payload.valorPremium;
  linha[cols.valorPocket - 1] = payload.valorPocket;
  linha[cols.valorDebut - 1] = payload.valorDebut;
  linha[cols.numeroOrcamento - 1] = '';
  linha[cols.linkPdf - 1] = '';
  linha[cols.linkWhats - 1] = '';
  linha[cols.local - 1] = payload.local;
  linha[cols.observacoes - 1] = payload.observacoes;
  linha[cols.criadoPor - 1] = formatarUsuarioOrcamentoInterno_(usuario);
  linha[cols.statusComercial - 1] = 'ABERTA';
  sheet.appendRow(linha);
  sheet.getRange(rowNum, cols.timestamp).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange(rowNum, cols.dataEvento).setNumberFormat('dd/MM/yyyy');
  SpreadsheetApp.flush();
  return rowNum;
}

function gerarPdfOrcamentoInterno_(sheet, cols, cfg, rowNum) {
  const row = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
  const nome = row[cols.nome - 1];
  const telefone = row[cols.telefone - 1];
  const dataEvento = row[cols.dataEvento - 1];
  const local = String(row[cols.local - 1] || '').trim();
  const propostas = String(row[cols.propostas - 1] || '').toLowerCase();
  const numero = gerarNumeroOrcamentoInterno_(sheet, cols, cfg);
  sheet.getRange(rowNum, cols.numeroOrcamento).setValue(numero);

  const dataFormatada = Utilities.formatDate(new Date(dataEvento), cfg.timezone, 'dd/MM/yyyy');
  const modelo = executarRetryOrcamentoInterno_(function () {
    return DriveApp.getFileById(cfg.templateId);
  }, 'DRIVE_GET_TEMPLATE', cfg);
  const pasta = executarRetryOrcamentoInterno_(function () {
    return DriveApp.getFolderById(cfg.pastaPdfId);
  }, 'DRIVE_GET_FOLDER', cfg);
  const copia = executarRetryOrcamentoInterno_(function () {
    return modelo.makeCopy('ORC-' + numero + ' - ' + nome, pasta);
  }, 'DRIVE_MAKE_COPY', cfg);

  Utilities.sleep(300);
  const apresentacao = executarRetryOrcamentoInterno_(function () {
    return SlidesApp.openById(copia.getId());
  }, 'SLIDES_OPEN_COPY', cfg);
  apresentacao.replaceAllText(
    '{{NOME}}',
    String(nome || '').toLocaleUpperCase('pt-BR')
  );
  apresentacao.replaceAllText('{{NUM_ORCAMENTO}}', numero);
  apresentacao.replaceAllText('{{DATA}}', dataFormatada);
  apresentacao.replaceAllText(
    '{{LOCAL}}',
    String(local || '').toLocaleUpperCase('pt-BR')
  );
  substituirValorApresentacaoOrcamentoInterno_(apresentacao, '{{VALOR_POCKET}}', row[cols.valorPocket - 1]);
  substituirValorApresentacaoOrcamentoInterno_(apresentacao, '{{VALOR_GOLD}}', row[cols.valorGold - 1]);
  substituirValorApresentacaoOrcamentoInterno_(apresentacao, '{{VALOR_PREMIUM}}', row[cols.valorPremium - 1]);
  substituirValorApresentacaoOrcamentoInterno_(apresentacao, '{{VALOR_DEBUT}}', row[cols.valorDebut - 1]);
  filtrarSlidesOrcamentoInterno_(apresentacao, propostas);
  executarRetryOrcamentoInterno_(function () {
    apresentacao.saveAndClose();
    return true;
  }, 'SLIDES_SAVE_CLOSE', cfg);

  const pdfBlob = exportarPdfOrcamentoInterno_(copia.getId(), 'Orcamento-' + numero + '-' + nome, cfg);
  const pdf = executarRetryOrcamentoInterno_(function () {
    return pasta.createFile(pdfBlob);
  }, 'DRIVE_CREATE_PDF', cfg);
  executarRetryOrcamentoInterno_(function () {
    pdf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return true;
  }, 'DRIVE_SET_SHARING', cfg);
  const linkPdf = pdf.getUrl();
  try { copia.setTrashed(true); } catch (err) {
    Logger.log('ORCAMENTO_WARN_TRASH_COPY: ' + String(err && err.message || err));
  }
  const linkWhats = criarLinkWhatsOrcamentoInterno_(telefone, linkPdf, nome, numero, dataFormatada);
  sheet.getRange(rowNum, cols.linkPdf).setValue(linkPdf);
  sheet.getRange(rowNum, cols.linkWhats).setValue(linkWhats);
  SpreadsheetApp.flush();
  return { numeroOrcamento: numero, linkPdf: linkPdf, linkWhats: linkWhats };
}

function gerarNumeroOrcamentoInterno_(sheet, cols, cfg) {
  const prefixo = Utilities.formatDate(new Date(), cfg.timezone, 'yyMM');
  const regex = new RegExp('^FA-' + prefixo + '-(\\d+)$');
  const lastRow = sheet.getLastRow();
  let maior = 0;
  if (lastRow >= 2) {
    const numeros = sheet.getRange(2, cols.numeroOrcamento, lastRow - 1, 1).getDisplayValues();
    numeros.forEach(function (r) {
      const m = String(r[0] || '').trim().match(regex);
      if (m) maior = Math.max(maior, Number(m[1]) || 0);
    });
  }
  return 'FA-' + prefixo + '-' + Utilities.formatString('%04d', maior + 1);
}

function substituirValorApresentacaoOrcamentoInterno_(apresentacao, chave, valor) {
  const vazio = valor === '' || valor === null || typeof valor === 'undefined';
  apresentacao.replaceAllText(chave, vazio ? 'Sob consulta' : formatarValorOrcamentoInterno_(valor));
}

function formatarValorOrcamentoInterno_(valor) {
  const apenasDigitos = String(valor == null ? '' : valor).replace(/\D/g, '');
  if (!apenasDigitos) return '';
  return String(parseInt(apenasDigitos, 10)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function filtrarSlidesOrcamentoInterno_(apresentacao, propostas) {
  apresentacao.getSlides().forEach(function (slide) {
    let marcador = '';
    slide.getPageElements().some(function (elemento) {
      if (elemento.getPageElementType() !== SlidesApp.PageElementType.SHAPE) return false;
      const texto = elemento.asShape().getText().asString();
      if (texto.indexOf('[#POCKET_ONLY]') !== -1) marcador = 'pocket';
      else if (texto.indexOf('[#GOLD_ONLY]') !== -1) marcador = 'gold';
      else if (texto.indexOf('[#PREMIUM_ONLY]') !== -1) marcador = 'premium';
      else if (texto.indexOf('[#DEBUT_ONLY]') !== -1) marcador = 'debut';
      return !!marcador;
    });
    if (marcador && propostas.indexOf(marcador) === -1) slide.remove();
  });
}

function exportarPdfOrcamentoInterno_(apresentacaoId, nome, cfg) {
  const resposta = executarRetryOrcamentoInterno_(function () {
    const resp = UrlFetchApp.fetch(
      'https://docs.google.com/presentation/d/' + apresentacaoId + '/export?format=pdf',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }
    );
    const status = Number(resp.getResponseCode() || 0);
    if (status !== 200) throw new Error('EXPORT_PDF_HTTP_' + status);
    return resp;
  }, 'EXPORT_PDF', cfg);
  const blob = resposta.getBlob();
  if (!blob || !blob.getBytes().length) throw new Error('EXPORT_PDF_BLOB_VAZIO');
  return blob.setName(nome + '.pdf');
}

function executarRetryOrcamentoInterno_(fn, etapa, cfg) {
  let ultimo = null;
  for (var i = 0; i < cfg.retryMax; i++) {
    try {
      return fn();
    } catch (err) {
      ultimo = err;
      const msg = String(err && err.message || err);
      const retry = /service error|unavailable|timed out|rate limit|quota|internal error|EXPORT_PDF_HTTP_(429|500|502|503|504)/i.test(msg);
      if (!retry || i + 1 >= cfg.retryMax) break;
      Utilities.sleep(cfg.retryBaseMs * Math.pow(2, i) + Math.floor(Math.random() * 180));
    }
  }
  throw new Error('ORCAMENTO_FALHA_' + etapa + ': ' + String(ultimo && ultimo.message || ultimo));
}

function criarLinkWhatsOrcamentoInterno_(telefone, pdf, nome, numero, data) {
  const msg =
    'Olá, ' + nome + '! Tudo bem?\n\n' +
    'De acordo com todas as informações que você me passou, criei essa proposta exclusiva para o seu evento.\n' +
    'Ela considera o tipo de evento, data, local, horário e demais informações repassadas durante nosso contato, por isso é exclusiva e não se aplica a outro evento.\n\n' +
    'Proposta: ' + numero + '\n' +
    'Data do evento: ' + data + '\n' +
    'Link da proposta: ' + pdf + '\n\n' +
    'Caso haja qualquer mudança nas informações do evento, me avise para validar esta proposta ou atualizar para uma nova versão.\n\n' +
    'No link, além de conferir o formato ideal e o orçamento, você também pode conhecer mais sobre a carreira do Fernando Amorim.\n\n' +
    'Agradeço o contato e fico à disposição para negociação, dúvidas e informações adicionais.\n\n' +
    'Atte,\nSuê Costa';
  return 'https://wa.me/' + normalizarTelefoneOrcamentoInterno_(telefone) + '?text=' + encodeURIComponent(msg);
}

function listarOrcamentosInternosLocal_(params) {
  const estrutura = obterAbaOrcamentosInterna_();
  const sheet = estrutura.sheet;
  const cols = estrutura.cols;
  const offsetPedido = Math.max(0, Math.floor(Number(params && params.offset) || 0));
  const limite = Math.max(20, Math.min(60, Math.floor(Number(params && params.limite) || 60)));
  const permitidas = ['recentes', 'antigas', 'nome_az', 'nome_za'];
  const ordemPedida = String(params && params.ordenacao || 'recentes').trim().toLowerCase();
  const ordenacao = permitidas.indexOf(ordemPedida) !== -1 ? ordemPedida : 'recentes';
  const busca = normalizarBuscaOrcamentoInterno_(params && params.busca);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { sucesso: true, orcamentos: [], total: 0, offset: 0, limite: limite, ordenacao: ordenacao };

  const chaveCache = criarChaveCacheOrcamentoInterno_([
    'LISTA_V1', lastRow, obterVersaoCacheOrcamentoInterno_(), offsetPedido, limite, ordenacao, busca
  ]);
  const cache = CacheService.getScriptCache();
  try {
    const existente = cache.get(chaveCache);
    if (existente) return JSON.parse(existente);
  } catch (_) {}

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
  const itens = [];
  values.forEach(function (row, index) {
    const item = montarItemOrcamentoInterno_(row, cols);
    item._linha = index + 2;
    if (!item.numeroOrcamento) return;
    if (busca) {
      const texto = normalizarBuscaOrcamentoInterno_([
        item.numeroOrcamento, item.nome, item.telefone, item.dataEvento,
        item.local, item.propostas, item.observacoes
      ].join(' '));
      if (texto.indexOf(busca) === -1) return;
    }
    itens.push(item);
  });
  itens.sort(function (a, b) {
    if (ordenacao === 'antigas') return a._linha - b._linha;
    if (ordenacao === 'nome_az' || ordenacao === 'nome_za') {
      const aa = normalizarBuscaOrcamentoInterno_(a.nome);
      const bb = normalizarBuscaOrcamentoInterno_(b.nome);
      const cmp = aa < bb ? -1 : (aa > bb ? 1 : 0);
      if (cmp) return ordenacao === 'nome_za' ? -cmp : cmp;
    }
    return b._linha - a._linha;
  });
  const total = itens.length;
  const offsetMax = total ? Math.floor((total - 1) / limite) * limite : 0;
  const offset = Math.min(offsetPedido, offsetMax);
  const pagina = itens.slice(offset, offset + limite).map(function (item) {
    delete item._linha;
    return item;
  });
  const resultado = { sucesso: true, orcamentos: pagina, total: total, offset: offset, limite: limite, ordenacao: ordenacao };
  try { cache.put(chaveCache, JSON.stringify(resultado), 180); } catch (_) {}
  return resultado;
}

function montarItemOrcamentoInterno_(row, cols) {
  function valor(coluna) { return coluna ? String(row[coluna - 1] || '').trim() : ''; }
  return {
    timestamp: valor(cols.timestamp),
    nome: valor(cols.nome),
    telefone: valor(cols.telefone),
    dataEvento: valor(cols.dataEvento),
    propostas: valor(cols.propostas),
    valorGold: valor(cols.valorGold),
    valorPremium: valor(cols.valorPremium),
    valorPocket: valor(cols.valorPocket),
    valorDebut: valor(cols.valorDebut),
    numeroOrcamento: valor(cols.numeroOrcamento),
    linkPdf: valor(cols.linkPdf),
    temLinkWhats: !!valor(cols.linkWhats),
    local: valor(cols.local),
    observacoes: valor(cols.observacoes),
    criadoPor: valor(cols.criadoPor),
    statusComercial: valor(cols.statusComercial) || 'ABERTA',
    eventoVinculadoId: valor(cols.eventoVinculadoId),
    vinculadaEm: valor(cols.vinculadaEm),
    vinculadaPor: valor(cols.vinculadaPor)
  };
}

function listarCandidatosOrcamentoInterno_(params) {
  const estrutura = obterAbaOrcamentosInterna_();
  const lastRow = estrutura.sheet.getLastRow();
  if (lastRow < 2) return [];
  const buscaTexto = normalizarBuscaOrcamentoInterno_(params && params.buscaManual);
  const buscaDigitos = String(params && params.buscaManual || '').replace(/\D/g, '');
  const values = estrutura.sheet.getRange(2, 1, lastRow - 1, estrutura.sheet.getLastColumn()).getDisplayValues();
  const itens = [];
  for (var i = values.length - 1; i >= 0; i--) {
    const item = montarItemOrcamentoInterno_(values[i], estrutura.cols);
    if (!item.numeroOrcamento || String(item.statusComercial).toUpperCase() !== 'ABERTA') continue;
    if (buscaTexto || buscaDigitos) {
      const texto = normalizarBuscaOrcamentoInterno_([item.numeroOrcamento, item.nome, item.telefone].join(' '));
      const digitos = [item.numeroOrcamento, item.telefone].join(' ').replace(/[^\d ]/g, '');
      if (!(buscaTexto && texto.indexOf(buscaTexto) !== -1) &&
          !(buscaDigitos && digitos.indexOf(buscaDigitos) !== -1)) continue;
    }
    itens.push(item);
    if ((buscaTexto || buscaDigitos) && itens.length >= 10) break;
  }
  return itens;
}

function localizarOrcamentoInterno_(sheet, cols, numero) {
  const alvo = String(numero || '').trim();
  if (!alvo) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][cols.numeroOrcamento - 1] || '').trim() === alvo) {
      return { linha: i + 2, valores: values[i] };
    }
  }
  return null;
}

function obterOrcamentoInternoPorNumero_(numero) {
  const estrutura = obterAbaOrcamentosInterna_();
  const localizado = localizarOrcamentoInterno_(estrutura.sheet, estrutura.cols, numero);
  return localizado ? montarItemOrcamentoInterno_(localizado.valores, estrutura.cols) : null;
}

function vincularOrcamentoInternoEvento_(payload, usuario) {
  return atualizarStatusVinculoOrcamentoInterno_(payload, usuario, 'FECHADA', false);
}

function cancelarEventoOrcamentoInterno_(payload, usuario) {
  return atualizarStatusVinculoOrcamentoInterno_(payload, usuario, 'EVENTO_CANCELADO', false);
}

function desvincularOrcamentoInternoEvento_(payload, usuario) {
  return atualizarStatusVinculoOrcamentoInterno_(payload, usuario, 'ABERTA', true);
}

function atualizarStatusVinculoOrcamentoInterno_(payload, usuario, statusNovo, limpar) {
  const numero = String(payload && payload.numeroOrcamento || '').trim();
  const eventoId = String(payload && payload.eventoId || '').trim();
  if (!numero || !eventoId) throw new Error('VINCULO_DADOS_OBRIGATORIOS');
  const estrutura = obterAbaOrcamentosInterna_();
  const tokenLock = adquirirLockOrcamentoInterno_(estrutura.cfg.lockWaitMs);
  try {
    const localizado = localizarOrcamentoInterno_(estrutura.sheet, estrutura.cols, numero);
    if (!localizado) throw new Error('ORCAMENTO_NAO_ENCONTRADO');
    const atualEvento = String(localizado.valores[estrutura.cols.eventoVinculadoId - 1] || '').trim();
    if (atualEvento && atualEvento !== eventoId) throw new Error('ORCAMENTO_VINCULADO_A_OUTRO_EVENTO');
    const sheet = estrutura.sheet;
    const cols = estrutura.cols;
    sheet.getRange(localizado.linha, cols.statusComercial).setValue(statusNovo);
    if (limpar) {
      sheet.getRange(localizado.linha, cols.eventoVinculadoId).clearContent();
      sheet.getRange(localizado.linha, cols.vinculadaEm).clearContent();
      sheet.getRange(localizado.linha, cols.vinculadaPor).clearContent();
    } else {
      sheet.getRange(localizado.linha, cols.eventoVinculadoId).setValue(eventoId);
      if (statusNovo === 'FECHADA') {
        sheet.getRange(localizado.linha, cols.vinculadaEm).setValue(new Date());
        sheet.getRange(localizado.linha, cols.vinculadaPor).setValue(formatarUsuarioOrcamentoInterno_(usuario));
      }
    }
    SpreadsheetApp.flush();
    incrementarVersaoCacheOrcamentoInterno_();
    return {
      numeroOrcamento: numero,
      eventoId: limpar ? '' : eventoId,
      statusComercial: statusNovo
    };
  } finally {
    liberarLockOrcamentoInterno_(tokenLock);
  }
}

/**
 * Serializa somente operações de orçamento.
 *
 * O ScriptLock é mantido apenas durante a leitura/gravação atômica da
 * propriedade. Assim, exportar um PDF não bloqueia cadastro, edição ou
 * financeiro do sistema principal.
 */
function adquirirLockOrcamentoInterno_(waitMs) {
  const chave = 'ORCAMENTOS_MUTEX';
  const token = Utilities.getUuid();
  const limite = Date.now() + Math.max(1000, Number(waitMs) || 20000);
  const ttlMs = 5 * 60 * 1000;
  const props = PropertiesService.getScriptProperties();

  while (Date.now() < limite) {
    const coordenador = LockService.getScriptLock();
    if (coordenador.tryLock(1000)) {
      try {
        const atualRaw = String(props.getProperty(chave) || '');
        const partes = atualRaw.split('|');
        const expiraEm = Number(partes[1] || 0);
        if (!atualRaw || !expiraEm || expiraEm <= Date.now()) {
          props.setProperty(chave, token + '|' + (Date.now() + ttlMs));
          return token;
        }
      } finally {
        coordenador.releaseLock();
      }
    }
    Utilities.sleep(180 + Math.floor(Math.random() * 120));
  }
  throw new Error('ORCAMENTO_LOCK_TIMEOUT');
}

function liberarLockOrcamentoInterno_(token) {
  if (!token) return;
  const chave = 'ORCAMENTOS_MUTEX';
  const coordenador = LockService.getScriptLock();
  if (!coordenador.tryLock(1500)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const atual = String(props.getProperty(chave) || '');
    if (atual.split('|')[0] === String(token)) props.deleteProperty(chave);
  } finally {
    coordenador.releaseLock();
  }
}

function listarVinculosOrcamentosInternos_() {
  const estrutura = obterAbaOrcamentosInterna_();
  const lastRow = estrutura.sheet.getLastRow();
  if (lastRow < 2) return [];
  return estrutura.sheet
    .getRange(2, 1, lastRow - 1, estrutura.sheet.getLastColumn())
    .getDisplayValues()
    .map(function (row) {
      const item = montarItemOrcamentoInterno_(row, estrutura.cols);
      return {
        numeroOrcamento: item.numeroOrcamento,
        statusComercial: item.statusComercial,
        eventoVinculadoId: item.eventoVinculadoId,
        vinculadaEm: item.vinculadaEm,
        vinculadaPor: item.vinculadaPor
      };
    })
    .filter(function (item) { return !!item.numeroOrcamento; });
}

function formatarUsuarioOrcamentoInterno_(usuario) {
  const nome = String(usuario && (usuario.NOME || usuario.nome) || '').trim();
  const email = String(usuario && (usuario.EMAIL || usuario.email) || '').trim();
  if (nome && email) return nome + ' (' + email + ')';
  return nome || email || 'Não identificado';
}

function normalizarBuscaOrcamentoInterno_(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function criarChaveCacheOrcamentoInterno_(partes) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    (partes || []).join('|')
  );
  return 'ORC_INT_' + bytes.map(function (b) {
    return ((b + 256) % 256).toString(16).padStart(2, '0');
  }).join('').slice(0, 48);
}

function obterVersaoCacheOrcamentoInterno_() {
  return String(PropertiesService.getScriptProperties().getProperty('ORCAMENTOS_CACHE_VERSION') || '1');
}

function incrementarVersaoCacheOrcamentoInterno_() {
  const props = PropertiesService.getScriptProperties();
  const atual = Number(props.getProperty('ORCAMENTOS_CACHE_VERSION') || 1);
  props.setProperty('ORCAMENTOS_CACHE_VERSION', String(atual + 1));
}
