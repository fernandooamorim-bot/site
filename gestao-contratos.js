/**
 * Central de Contratos + ZapSign
 * Primeira fase: estrutura local, catálogo de modelos e criação em sandbox.
 */

const CONTRATOS_CFG_ = {
  ABA_CONTRATOS: 'CONTRATOS',
  ABA_HISTORICO: 'CONTRATOS_HISTORICO',
  ABA_MODELOS: 'CONTRATOS_MODELOS',
  BASE_SANDBOX: 'https://sandbox.api.zapsign.com.br/api/v1',
  BASE_PRODUCAO: 'https://api.zapsign.com.br/api/v1'
};

const CONTRATOS_HEADERS_ = [
  'ID_CONTRATO', 'ID_EVENTO', 'NOME_EVENTO', 'ID_CONTRATANTE', 'NOME_CONTRATANTE',
  'TEMPLATE_TOKEN', 'TEMPLATE_NOME', 'DOC_TOKEN', 'OPEN_ID', 'STATUS_LOCAL',
  'STATUS_ZAPSIGN', 'NOME_DOCUMENTO', 'SIGNATARIO_NOME', 'SIGNATARIO_EMAIL',
  'SIGNATARIO_TELEFONE', 'SIGNER_TOKEN', 'SIGN_URL', 'EXTERNAL_ID', 'AMBIENTE',
  'CAMPOS_JSON', 'ID_CONTRATO_SUBSTITUIDO', 'MOTIVO_CANCELAMENTO',
  'DATA_CANCELAMENTO', 'CANCELADO_POR', 'DATA_CRIACAO', 'CRIADO_POR',
  'ULTIMA_ATUALIZACAO', 'ATUALIZADO_POR', 'ULTIMO_ERRO'
];

const CONTRATOS_HISTORICO_HEADERS_ = [
  'ID_HISTORICO', 'ID_CONTRATO', 'ID_EVENTO', 'ACAO', 'STATUS_ANTERIOR',
  'STATUS_NOVO', 'DETALHES_JSON', 'DATA_ACAO', 'USUARIO', 'ORIGEM', 'REQUEST_ID'
];

const CONTRATOS_MODELOS_HEADERS_ = [
  'TEMPLATE_TOKEN', 'NOME', 'TIPO', 'ATIVO_ZAPSIGN', 'DISPONIVEL_SISTEMA',
  'CAMPOS_JSON', 'MAPEAMENTO_JSON', 'SIGNATARIOS_JSON', 'PASTA', 'IDIOMA',
  'DATA_CRIACAO_ZAPSIGN', 'ATUALIZADO_ZAPSIGN', 'ULTIMA_SINCRONIZACAO',
  'SINCRONIZADO_POR', 'STATUS_SINCRONIZACAO'
];

function garantirAbaContratos_(ss, nome, headers, cor) {
  let sheet = ss.getSheetByName(nome);
  if (!sheet) sheet = ss.insertSheet(nome);
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  const atual = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const preenchidos = atual.filter(function (v) { return String(v || '').trim(); }).length;
  if (!preenchidos) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    for (let i = 0; i < headers.length; i++) {
      if (String(atual[i] || '').trim() !== headers[i]) {
        throw new Error('ESTRUTURA_' + nome + '_INCOMPATIVEL_COLUNA_' + (i + 1));
      }
    }
  }
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground(cor).setFontColor('#ffffff').setFontWeight('bold');
  sheet.setFrozenRows(1);
  if (!sheet.getFilter() && sheet.getMaxRows() > 1) {
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).createFilter();
  }
  return sheet;
}

function inicializarEstruturaContratos_(email) {
  const user = email ? requireUserByEmail(email) : getUsuarioAtual();
  requirePermission(user, 'contratos:listar');
  return garantirEstruturaContratosSemPermissao_();
}

function garantirEstruturaContratosSemPermissao_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('CONTRATOS_ESTRUTURA_OK_V1') === '1') {
    return { ok: true, abas: [CONTRATOS_CFG_.ABA_CONTRATOS, CONTRATOS_CFG_.ABA_HISTORICO, CONTRATOS_CFG_.ABA_MODELOS] };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // Outra requisição pode ter concluído a validação enquanto esta aguardava.
    if (cache.get('CONTRATOS_ESTRUTURA_OK_V1') === '1') {
      return { ok: true, abas: [CONTRATOS_CFG_.ABA_CONTRATOS, CONTRATOS_CFG_.ABA_HISTORICO, CONTRATOS_CFG_.ABA_MODELOS] };
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    garantirAbaContratos_(ss, CONTRATOS_CFG_.ABA_CONTRATOS, CONTRATOS_HEADERS_, '#1e3a5f');
    garantirAbaContratos_(ss, CONTRATOS_CFG_.ABA_HISTORICO, CONTRATOS_HISTORICO_HEADERS_, '#475569');
    garantirAbaContratos_(ss, CONTRATOS_CFG_.ABA_MODELOS, CONTRATOS_MODELOS_HEADERS_, '#6d4c7d');
    cache.put('CONTRATOS_ESTRUTURA_OK_V1', '1', 300);
    return { ok: true, abas: [CONTRATOS_CFG_.ABA_CONTRATOS, CONTRATOS_CFG_.ABA_HISTORICO, CONTRATOS_CFG_.ABA_MODELOS] };
  } finally {
    lock.releaseLock();
  }
}

/** Uso administrativo pelo editor/clasp; não é exposto no roteador HTTP. */
function inicializarEstruturaContratosDeploy() {
  return garantirEstruturaContratosSemPermissao_();
}

/** Prepara as chaves de produção sem ativar nem substituir segredos existentes. */
function prepararConfiguracaoProducaoZapSignDeploy() {
  const props = PropertiesService.getScriptProperties();
  const atuais = props.getProperties();
  const defaults = {};
  if (!Object.prototype.hasOwnProperty.call(atuais, 'ZAPSIGN_API_TOKEN_PRODUCAO')) {
    defaults.ZAPSIGN_API_TOKEN_PRODUCAO = '';
  }
  if (!Object.prototype.hasOwnProperty.call(atuais, 'ZAPSIGN_PRODUCAO_ATIVA')) {
    defaults.ZAPSIGN_PRODUCAO_ATIVA = 'false';
  }
  if (!Object.prototype.hasOwnProperty.call(atuais, 'ZAPSIGN_AMBIENTE')) {
    defaults.ZAPSIGN_AMBIENTE = 'sandbox';
  }
  if (Object.keys(defaults).length) props.setProperties(defaults, false);
  return {
    ok: true,
    ambiente: String(props.getProperty('ZAPSIGN_AMBIENTE') || 'sandbox'),
    producaoAtiva: String(props.getProperty('ZAPSIGN_PRODUCAO_ATIVA') || 'false'),
    tokenProducaoConfigurado: !!String(props.getProperty('ZAPSIGN_API_TOKEN_PRODUCAO') || '').trim()
  };
}

function garantirConfiguracaoZapSignNaAbaConfig_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('CONFIG');
  if (!sheet) throw new Error('CONFIG_SHEET_NOT_FOUND');
  const props = PropertiesService.getScriptProperties();
  const dados = sheet.getDataRange().getValues();
  const existentes = {};
  for (let i = 1; i < dados.length; i++) {
    const chave = String(dados[i][0] || '').trim();
    if (chave) existentes[chave] = true;
  }
  const definicoes = [
    ['CONTRATOS_ATIVO', 'true', 'Interruptor geral da Central de Contratos. Somente TRUE ativa interfaces e operações do módulo.'],
    ['ZAPSIGN_AMBIENTE', String(props.getProperty('ZAPSIGN_AMBIENTE') || 'sandbox').trim().toLowerCase(), 'Ambiente ativo da ZapSign: sandbox ou producao.'],
    ['ZAPSIGN_API_TOKEN_SANDBOX', String(props.getProperty('ZAPSIGN_API_TOKEN_SANDBOX') || '').trim(), 'Token privado da API ZapSign para o ambiente sandbox.'],
    ['ZAPSIGN_API_TOKEN_PRODUCAO', String(props.getProperty('ZAPSIGN_API_TOKEN_PRODUCAO') || '').trim(), 'Token privado da API ZapSign para a conta real.'],
    ['ZAPSIGN_PRODUCAO_ATIVA', String(props.getProperty('ZAPSIGN_PRODUCAO_ATIVA') || 'false').trim().toLowerCase(), 'Trava adicional: use TRUE somente após conferir token e modelos reais.']
  ];
  const novas = definicoes.filter(function (r) { return !existentes[r[0]]; });
  if (novas.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, novas.length, 3).setValues(novas);
    CONFIG_SNAPSHOT_EXECUCAO_ = null;
  }
  return { ok: true, adicionadas: novas.map(function (r) { return r[0]; }) };
}

function contratosAtivo_() {
  garantirConfiguracaoZapSignNaAbaConfig_();
  return String(obterConfigZapSignSegura_('CONTRATOS_ATIVO') || '').trim().toLowerCase() === 'true';
}

function exigirContratosAtivos_() {
  if (!contratosAtivo_()) throw new Error('CONTRATOS_DESATIVADOS');
}

function obterConfigZapSignSegura_(chave) {
  const config = getConfig();
  if (Object.prototype.hasOwnProperty.call(config, chave) && String(config[chave] || '').trim() !== '') {
    return String(config[chave]).trim();
  }
  return String(PropertiesService.getScriptProperties().getProperty(chave) || '').trim();
}

function obterConfigZapSign_() {
  garantirConfiguracaoZapSignNaAbaConfig_();
  const ambiente = String(obterConfigZapSignSegura_('ZAPSIGN_AMBIENTE') || 'sandbox').trim().toLowerCase();
  if (ambiente !== 'sandbox' && ambiente !== 'producao') throw new Error('ZAPSIGN_AMBIENTE_INVALIDO');
  const producaoAtiva = String(obterConfigZapSignSegura_('ZAPSIGN_PRODUCAO_ATIVA') || '').toLowerCase() === 'true';
  const token = String(obterConfigZapSignSegura_(
    ambiente === 'sandbox' ? 'ZAPSIGN_API_TOKEN_SANDBOX' : 'ZAPSIGN_API_TOKEN_PRODUCAO'
  ) || '').trim();
  return {
    ambiente: ambiente,
    baseUrl: ambiente === 'sandbox' ? CONTRATOS_CFG_.BASE_SANDBOX : CONTRATOS_CFG_.BASE_PRODUCAO,
    token: token,
    configurado: !!token,
    producaoAtiva: producaoAtiva
  };
}

function obterStatusIntegracaoContratos_(email) {
  const user = requireUserByEmail(email);
  requirePermission(user, 'contratos:listar');
  if (!contratosAtivo_()) {
    return { ok: true, ativo: false, integracao: { configurada: false }, permissoes: {} };
  }
  const estrutura = inicializarEstruturaContratos_(email);
  const cfg = obterConfigZapSign_();
  return {
    ok: true,
    ativo: true,
    estrutura: estrutura,
    integracao: {
      configurada: cfg.configurado,
      ambiente: cfg.ambiente,
      producaoBloqueada: cfg.ambiente === 'producao' && !cfg.producaoAtiva
    },
    permissoes: {
      criar: usuarioPossuiPermissao_(user, 'contratos:criar'),
      enviar: usuarioPossuiPermissao_(user, 'contratos:enviar'),
      sincronizarModelos: usuarioPossuiPermissao_(user, 'contratos:gerenciarModelos')
    }
  };
}

function usuarioPossuiPermissao_(user, action) {
  try { requirePermission(user, action); return true; } catch (_) { return false; }
}

function zapsignRequest_(path, opts) {
  const cfg = obterConfigZapSign_();
  if (!cfg.configurado) throw new Error('ZAPSIGN_TOKEN_NAO_CONFIGURADO');
  if (cfg.ambiente === 'producao' && !cfg.producaoAtiva) {
    throw new Error('ZAPSIGN_PRODUCAO_BLOQUEADA');
  }
  const method = String((opts && opts.method) || 'get').toLowerCase();
  const request = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'FA-Producoes-Agenda/1.0'
    }
  };
  if (opts && opts.payload !== undefined && method !== 'get') {
    request.payload = JSON.stringify(opts.payload);
  }
  const url = cfg.baseUrl.replace(/\/$/, '') + '/' + String(path || '').replace(/^\//, '');
  const resp = UrlFetchApp.fetch(url, request);
  const code = Number(resp.getResponseCode() || 0);
  const txt = String(resp.getContentText() || '').trim();
  let data = {};
  try { data = txt ? JSON.parse(txt) : {}; } catch (_) { data = { raw: txt }; }
  if (code < 200 || code >= 300) {
    throw new Error('ZAPSIGN_HTTP_' + code + ': ' + String(data.detail || data.message || txt || 'Erro desconhecido').slice(0, 500));
  }
  return data;
}

function mapaHeadersContratos_(headers) {
  const out = {};
  headers.forEach(function (h, i) { out[h] = i; });
  return out;
}

function serializarSeguroContratos_(valor, limite) {
  const txt = JSON.stringify(valor === undefined ? null : valor);
  return txt.length > (limite || 45000) ? txt.slice(0, limite || 45000) : txt;
}

function normalizarStatusContrato_(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'signed') return 'ASSINADO';
  if (s === 'refused') return 'RECUSADO';
  if (s === 'pending') return 'PENDENTE';
  return s ? s.toUpperCase() : 'RASCUNHO';
}

function normalizarStatusRespostaContrato_(resp) {
  const statusDocumento = normalizarStatusContrato_(resp && resp.status);
  const signatarios = resp && Array.isArray(resp.signers) ? resp.signers : [];
  const todosAssinaram = signatarios.length > 0 && signatarios.every(function (s) {
    return String((s && s.status) || '').trim().toLowerCase() === 'signed';
  });
  return todosAssinaram ? 'ASSINADO' : statusDocumento;
}

function registrarHistoricoContrato_(registro) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = garantirAbaContratos_(ss, CONTRATOS_CFG_.ABA_HISTORICO, CONTRATOS_HISTORICO_HEADERS_, '#475569');
  sheet.appendRow([
    'HCT-' + Utilities.getUuid(), registro.idContrato || '', registro.idEvento || '',
    registro.acao || '', registro.statusAnterior || '', registro.statusNovo || '',
    serializarSeguroContratos_(registro.detalhes || {}, 30000), new Date(),
    registro.usuario || '', registro.origem || 'SISTEMA', registro.requestId || ''
  ]);
}

function listarContratos_(email, filtros) {
  const user = requireUserByEmail(email);
  requirePermission(user, 'contratos:listar');
  inicializarEstruturaContratos_(email);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONTRATOS_CFG_.ABA_CONTRATOS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: true, contratos: [] };
  const h = mapaHeadersContratos_(CONTRATOS_HEADERS_);
  const busca = String((filtros && filtros.busca) || '').trim().toLowerCase();
  const status = String((filtros && filtros.status) || '').trim().toUpperCase();
  const contratos = values.slice(1).filter(function (r) {
    if (!String(r[h.ID_CONTRATO] || '').trim()) return false;
    if (status && String(r[h.STATUS_LOCAL] || '').toUpperCase() !== status) return false;
    if (!busca) return true;
    return [r[h.ID_CONTRATO], r[h.ID_EVENTO], r[h.NOME_EVENTO], r[h.NOME_CONTRATANTE], r[h.NOME_DOCUMENTO]]
      .join(' ').toLowerCase().indexOf(busca) !== -1;
  }).map(function (r) {
    return {
      idContrato: r[h.ID_CONTRATO], idEvento: r[h.ID_EVENTO], nomeEvento: r[h.NOME_EVENTO],
      nomeContratante: r[h.NOME_CONTRATANTE], templateNome: r[h.TEMPLATE_NOME],
      nomeDocumento: r[h.NOME_DOCUMENTO], status: r[h.STATUS_LOCAL], statusZapSign: r[h.STATUS_ZAPSIGN],
      ambiente: r[h.AMBIENTE], signatarioNome: r[h.SIGNATARIO_NOME],
      signUrl: r[h.SIGN_URL], criadoEm: r[h.DATA_CRIACAO], atualizadoEm: r[h.ULTIMA_ATUALIZACAO],
      ultimoErro: r[h.ULTIMO_ERRO]
    };
  });
  contratos.sort(function (a, b) { return new Date(b.criadoEm || 0) - new Date(a.criadoEm || 0); });
  return { ok: true, contratos: contratos.slice(0, 500) };
}

function obterContratosDoEvento_(email, idEvento) {
  const user = requireUserByEmail(email);
  requirePermission(user, 'contratos:listar');
  const id = String(idEvento || '').trim();
  if (!id) throw new Error('ID_EVENTO_OBRIGATORIO');
  inicializarEstruturaContratos_(email);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONTRATOS_CFG_.ABA_CONTRATOS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: true, idEvento: id, contratos: [] };
  const h = mapaHeadersContratos_(CONTRATOS_HEADERS_);
  const contratos = values.slice(1).filter(function (r) {
    return String(r[h.ID_CONTRATO] || '').trim() && String(r[h.ID_EVENTO] || '').trim() === id;
  }).map(function (r) {
    return {
      idContrato: r[h.ID_CONTRATO], idEvento: r[h.ID_EVENTO], nomeEvento: r[h.NOME_EVENTO],
      nomeContratante: r[h.NOME_CONTRATANTE], nomeDocumento: r[h.NOME_DOCUMENTO],
      templateNome: r[h.TEMPLATE_NOME], status: r[h.STATUS_LOCAL],
      statusZapSign: r[h.STATUS_ZAPSIGN], signatarioNome: r[h.SIGNATARIO_NOME],
      signUrl: r[h.SIGN_URL], criadoEm: r[h.DATA_CRIACAO], atualizadoEm: r[h.ULTIMA_ATUALIZACAO]
    };
  });
  contratos.sort(function (a, b) { return new Date(b.criadoEm || 0) - new Date(a.criadoEm || 0); });
  return { ok: true, idEvento: id, contratos: contratos };
}

function listarModelosContratos_(email) {
  const user = requireUserByEmail(email);
  requirePermission(user, 'contratos:listar');
  inicializarEstruturaContratos_(email);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONTRATOS_CFG_.ABA_MODELOS);
  return { ok: true, modelos: lerModelosContratosDaAba_(sheet) };
}

function lerModelosContratosDaAba_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const h = mapaHeadersContratos_(CONTRATOS_MODELOS_HEADERS_);
  const modelos = values.slice(1).filter(function (r) {
    return String(r[h.TEMPLATE_TOKEN] || '').trim() && String(r[h.DISPONIVEL_SISTEMA]).toUpperCase() !== 'NÃO';
  }).map(function (r) {
    let campos = [], mapeamento = {};
    try { campos = JSON.parse(r[h.CAMPOS_JSON] || '[]'); } catch (_) {}
    try { mapeamento = JSON.parse(r[h.MAPEAMENTO_JSON] || '{}'); } catch (_) {}
    campos.forEach(function (campo) {
      const chave = String(campo.variable || campo.label || '');
      if (chave && !mapeamento[chave]) mapeamento[chave] = sugerirMapeamentoCampoContrato_(campo);
    });
    return {
      token: r[h.TEMPLATE_TOKEN], nome: r[h.NOME], tipo: r[h.TIPO],
      ativo: String(r[h.ATIVO_ZAPSIGN]).toUpperCase() === 'SIM',
      campos: campos, mapeamento: mapeamento, idioma: r[h.IDIOMA], pasta: r[h.PASTA]
    };
  });
  return modelos;
}

function sugerirMapeamentoCampoContrato_(campo) {
  const txt = String((campo && (campo.label || campo.variable)) || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[{}]/g, '').trim().toUpperCase();
  if (/NOME.*EVENTO|TITULO.*EVENTO/.test(txt)) return 'evento.nomeEvento';
  if (/TIPO.*PESSOA|PESSOA.*FISICA.*JURIDICA|CPF.*OU.*CNPJ|PFPJ/.test(txt)) return 'evento.tipoPessoa';
  if (/REPRESENTANTE/.test(txt)) return 'evento.representanteLegal';
  if (/CPF|CNPJ|DOCUMENTO.*CONTRATANTE/.test(txt)) return 'evento.cpfCnpj';
  if (/ENDERECO.*CONTRATANTE|ENDERECO.*CLIENTE|^ENDERECO$/.test(txt)) return 'evento.enderecoContratante';
  if (/E-?MAIL/.test(txt)) return 'evento.emailContratante';
  if (/TELEFONE|WHATSAPP/.test(txt)) return 'evento.telefoneContratante';
  if (/CONTRATANTE|CLIENTE|NOME COMPLETO|NOME DO CLIENTE/.test(txt)) return 'evento.nomeContratante';
  if (/DATA.*EVENTO|DATA DO SHOW/.test(txt)) return 'evento.dataEvento';
  if (/HORA.*EVENTO|HORA.*SHOW|HORA.*APRESENTACAO|HORARIO/.test(txt)) return 'evento.horaEvento';
  if (/DURACAO/.test(txt)) return 'evento.duracao';
  if (/CIDADE.*EVENTO|MUNICIPIO.*EVENTO/.test(txt)) return 'evento.cidadeEvento';
  if (/ESTADO.*EVENTO|UF.*EVENTO/.test(txt)) return 'evento.estadoEvento';
  if (/LOCAL|ENDERECO.*EVENTO/.test(txt)) return 'evento.local';
  if (/^VALOR$|VALOR.*SHOW|VALOR.*TOTAL|VALOR DO CONTRATO/.test(txt)) return 'evento.valorTotal';
  if (/FORMACAO.*BANDA|FORMATO.*BANDA/.test(txt)) return 'evento.projeto';
  if (/TIPO.*EVENTO/.test(txt)) return 'evento.tipoEvento';
  if (/PROJETO|FORMATO/.test(txt)) return 'evento.projeto';
  return '';
}

function sincronizarModelosContratos_(email) {
  const user = requireUserByEmail(email);
  requirePermission(user, 'contratos:gerenciarModelos');
  inicializarEstruturaContratos_(email);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let page = 1, todos = [];
    while (page <= 10) {
      const resp = zapsignRequest_('templates/?page=' + page, { method: 'get' });
      const itens = Array.isArray(resp) ? resp : (resp.results || []);
      todos = todos.concat(itens);
      if (!resp.next || !itens.length) break;
      page++;
    }
    if (todos.length > 200) throw new Error('ZAPSIGN_LIMITE_MODELOS_EXCEDIDO');

    // A ZapSign também pode retornar modelos PDF usados como documentos
    // complementares. A criação de contratos desta Central usa o endpoint de
    // modelos dinâmicos, compatível apenas com DOCX; por isso PDFs não devem
    // ser oferecidos como contrato principal. A deduplicação por token evita
    // repetir o mesmo item caso a paginação da API se sobreponha.
    const modelosDocxPorToken = {};
    todos.forEach(function (modelo) {
      const token = String(modelo && modelo.token || '').trim();
      const tipo = String(modelo && modelo.template_type || '').trim().toLowerCase();
      if (token && tipo === 'docx') modelosDocxPorToken[token] = modelo;
    });
    const modelosPrincipais = Object.keys(modelosDocxPorToken).map(function (token) {
      return modelosDocxPorToken[token];
    });
    const detalhados = modelosPrincipais.map(function (modelo) {
      try { return zapsignRequest_('templates/' + encodeURIComponent(modelo.token) + '/', { method: 'get' }); }
      catch (err) { return Object.assign({}, modelo, { _erro: String(err.message || err) }); }
    });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = garantirAbaContratos_(ss, CONTRATOS_CFG_.ABA_MODELOS, CONTRATOS_MODELOS_HEADERS_, '#6d4c7d');
    const atual = sheet.getDataRange().getValues();
    const h = mapaHeadersContratos_(CONTRATOS_MODELOS_HEADERS_);
    const porToken = {};
    for (let i = 1; i < atual.length; i++) porToken[String(atual[i][h.TEMPLATE_TOKEN] || '')] = atual[i];
    const linhas = detalhados.map(function (m) {
      const antiga = porToken[String(m.token)] || [];
      const campos = Array.isArray(m.inputs) ? m.inputs : [];
      let mapeamento = {};
      try { mapeamento = JSON.parse(antiga[h.MAPEAMENTO_JSON] || '{}'); } catch (_) {}
      campos.forEach(function (campo) {
        const chave = String(campo.variable || campo.label || '');
        if (chave && !mapeamento[chave]) mapeamento[chave] = sugerirMapeamentoCampoContrato_(campo);
      });
      return [
        m.token || '', m.name || '', m.template_type || '', m.active === false ? 'NÃO' : 'SIM',
        antiga.length ? (antiga[h.DISPONIVEL_SISTEMA] || 'SIM') : 'SIM',
        serializarSeguroContratos_(campos), serializarSeguroContratos_(mapeamento),
        serializarSeguroContratos_(m.signers || []), m.folder_path || '', m.lang || 'pt-br',
        m.created_at || '', m.last_update_at || '', new Date(), user.EMAIL || email,
        m._erro ? 'ERRO: ' + m._erro : 'OK'
      ];
    });
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, CONTRATOS_MODELOS_HEADERS_.length).clearContent();
    if (linhas.length) sheet.getRange(2, 1, linhas.length, CONTRATOS_MODELOS_HEADERS_.length).setValues(linhas);
    registrarHistoricoContrato_({ acao: 'SINCRONIZAR_MODELOS', statusNovo: 'OK', detalhes: { quantidade: linhas.length }, usuario: user.EMAIL || email, origem: 'ZAPSIGN' });
    return { ok: true, quantidade: linhas.length, modelos: lerModelosContratosDaAba_(sheet) };
  } finally {
    lock.releaseLock();
  }
}

function obterEventosParaContrato_(email) {
  const user = requireUserByEmail(email);
  requirePermission(user, 'contratos:criar');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const eventosSheet = ss.getSheetByName('EVENTOS');
  if (!eventosSheet) return { ok: true, eventos: [] };

  const contratantes = {};
  const contratantesSheet = ss.getSheetByName('CONTRATANTES');
  if (contratantesSheet) {
    const hc = garantirCamposComplementaresContratante_(contratantesSheet);
    const linhasContratantes = contratantesSheet.getDataRange().getValues();
    linhasContratantes.slice(1).forEach(function (r) {
      const id = String(r[0] || '').trim();
      if (!id) return;
      contratantes[id] = {
        nomeContratante: String(r[1] || '').trim(), telefoneContratante: String(r[2] || '').trim(),
        emailContratante: String(r[3] || '').trim(), cpfCnpj: String(r[4] || '').trim(),
        tipoPessoa: String(r[hc.TIPO_PESSOA - 1] || '').trim(),
        enderecoContratante: String(r[hc.ENDERECO_COMPLETO - 1] || '').trim(),
        representanteLegal: String(r[hc.REPRESENTANTE_LEGAL - 1] || '').trim()
      };
    });
  }

  const locais = {};
  const locaisSheet = ss.getSheetByName('ENDERECOS');
  if (locaisSheet) {
    locaisSheet.getDataRange().getValues().slice(1).forEach(function (r) {
      const id = String(r[0] || '').trim();
      if (!id) return;
      locais[id] = {
        local: String(r[1] || '').trim(), enderecoLocal: String(r[2] || '').trim(),
        cidadeEvento: String(r[6] || '').trim(), estadoEvento: String(r[7] || '').trim()
      };
    });
  }

  function textoDataContrato_(valor) {
    if (valor instanceof Date && !isNaN(valor.getTime())) return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'dd/MM/yyyy');
    return String(valor || '').trim();
  }
  function textoHoraContrato_(valor) {
    if (valor instanceof Date && !isNaN(valor.getTime())) return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'HH:mm');
    return String(valor || '').trim();
  }
  function textoDuracaoContrato_(valor) {
    if (typeof valor === 'number' && isFinite(valor)) {
      const horas = Math.floor(valor / 60), minutos = valor % 60;
      return minutos ? horas + 'h' + String(minutos).padStart(2, '0') : horas + 'h';
    }
    return String(valor || '').trim();
  }

  const linhas = eventosSheet.getDataRange().getValues();
  const eventos = linhas.slice(1).filter(function (r) {
    return String(r[COL.ID_EVENTO] || '').trim() &&
      String(r[COL.TIPO_REGISTRO] || 'Evento').trim().toUpperCase() === 'EVENTO' &&
      String(r[COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase() !== 'CANCELADO';
  }).map(function (r) {
    const idContratante = String(r[COL.ID_CONTRATANTE] || '').trim();
    const idEndereco = String(r[COL.ID_ENDERECO] || '').trim();
    const dadosContratante = contratantes[idContratante] || {};
    const dadosLocal = locais[idEndereco] || {};
    return Object.assign({
      id: r[COL.ID_EVENTO],
      nomeEvento: obterNomeEventoExibicao_(r),
      idContratante: idContratante,
      nomeContratante: String(r[COL.NOME_CONTRATANTE] || dadosContratante.nomeContratante || '').trim(),
      idEndereco: idEndereco,
      local: String(r[COL.LOCAL] || dadosLocal.local || '').trim(),
      dataEvento: textoDataContrato_(r[COL.DATA_EVENTO]),
      horaEvento: textoHoraContrato_(r[COL.HORA_INICIO]),
      duracao: textoDuracaoContrato_(r[COL.DURACAO]),
      valorTotal: Number(r[COL.VALOR_TOTAL] || 0),
      tipoEvento: String(r[COL.TIPO_EVENTO] || '').trim(),
      projeto: String(r[COL.PROJETO] || '').trim()
    }, dadosContratante, dadosLocal);
  });
  return { ok: true, eventos: eventos };
}

function validarPayloadContrato_(dados) {
  if (!dados || typeof dados !== 'object') throw new Error('DADOS_CONTRATO_INVALIDOS');
  if (!String(dados.templateToken || '').trim()) throw new Error('Selecione um modelo de contrato.');
  if (!String(dados.nomeDocumento || '').trim()) throw new Error('Informe o nome do documento.');
  if (!String(dados.signatarioNome || '').trim()) throw new Error('Informe o nome do signatário.');
  if (!String(dados.signatarioEmail || '').trim() && !String(dados.signatarioTelefone || '').trim()) {
    throw new Error('Informe o e-mail ou telefone do signatário.');
  }
  if (!Array.isArray(dados.campos)) throw new Error('Campos do contrato inválidos.');
}

function criarContratoZapSign_(email, dados) {
  dados = Object.assign({}, dados || {});
  if (!Array.isArray(dados.campos) && dados.camposJson) {
    try { dados.campos = JSON.parse(dados.camposJson); } catch (_) { dados.campos = null; }
  }
  const user = requireUserByEmail(email);
  requirePermission(user, 'contratos:criar');
  requirePermission(user, 'contratos:enviar');
  inicializarEstruturaContratos_(email);
  validarPayloadContrato_(dados);
  const cfg = obterConfigZapSign_();
  const confirmacaoEsperada = cfg.ambiente === 'sandbox' ? 'CRIAR_TESTE' : 'CRIAR_PRODUCAO';
  if (String(dados.confirmacao || '') !== confirmacaoEsperada) throw new Error('CONFIRMACAO_ENVIO_INVALIDA');
  const requestId = String(dados.requestId || '').trim();
  if (!requestId) throw new Error('REQUEST_ID_OBRIGATORIO');
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = garantirAbaContratos_(ss, CONTRATOS_CFG_.ABA_CONTRATOS, CONTRATOS_HEADERS_, '#1e3a5f');
    const values = sheet.getDataRange().getValues();
    const h = mapaHeadersContratos_(CONTRATOS_HEADERS_);
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][h.EXTERNAL_ID] || '') === requestId) {
        return { ok: true, duplicado: true, idContrato: values[i][h.ID_CONTRATO], signUrl: values[i][h.SIGN_URL], status: values[i][h.STATUS_LOCAL] };
      }
    }
    const modelosSheet = ss.getSheetByName(CONTRATOS_CFG_.ABA_MODELOS);
    const modelos = lerModelosContratosDaAba_(modelosSheet);
    const modelo = modelos.find(function (m) { return String(m.token) === String(dados.templateToken) && m.ativo; });
    if (!modelo) throw new Error('MODELO_NAO_DISPONIVEL_NO_SISTEMA');
    const idContrato = 'CTR-' + Utilities.getUuid();
    const telefoneDigitos = String(dados.signatarioTelefone || '').replace(/\D/g, '');
    const payload = {
      template_id: String(dados.templateToken), signer_name: String(dados.signatarioNome).trim(),
      signer_email: String(dados.signatarioEmail || '').trim(), signer_phone_country: telefoneDigitos ? '55' : '',
      signer_phone_number: telefoneDigitos.replace(/^55/, ''), lang: 'pt-br',
      disable_signer_emails: true, send_automatic_email: false, send_automatic_whatsapp: false,
      external_id: requestId, folder_path: '/FA Producoes/Contratos/', created_by: user.EMAIL || email,
      data: dados.campos.map(function (c) { return { de: String(c.de || ''), para: String(c.para || '') }; })
    };
    const agora = new Date();
    const row = new Array(CONTRATOS_HEADERS_.length).fill('');
    row[h.ID_CONTRATO] = idContrato; row[h.ID_EVENTO] = dados.idEvento || '';
    row[h.NOME_EVENTO] = dados.nomeEvento || ''; row[h.ID_CONTRATANTE] = dados.idContratante || '';
    row[h.NOME_CONTRATANTE] = dados.nomeContratante || ''; row[h.TEMPLATE_TOKEN] = modelo.token;
    row[h.TEMPLATE_NOME] = modelo.nome;
    row[h.STATUS_LOCAL] = 'CRIANDO';
    row[h.NOME_DOCUMENTO] = dados.nomeDocumento; row[h.SIGNATARIO_NOME] = dados.signatarioNome;
    row[h.SIGNATARIO_EMAIL] = dados.signatarioEmail || ''; row[h.SIGNATARIO_TELEFONE] = dados.signatarioTelefone || '';
    row[h.EXTERNAL_ID] = requestId; row[h.AMBIENTE] = cfg.ambiente.toUpperCase();
    row[h.CAMPOS_JSON] = serializarSeguroContratos_(dados.campos, 40000); row[h.DATA_CRIACAO] = agora;
    row[h.CRIADO_POR] = user.EMAIL || email; row[h.ULTIMA_ATUALIZACAO] = agora; row[h.ATUALIZADO_POR] = user.EMAIL || email;
    sheet.appendRow(row);
    const linhaCriada = sheet.getLastRow();
    registrarHistoricoContrato_({ idContrato: idContrato, idEvento: dados.idEvento || '', acao: 'INICIAR_CRIACAO', statusNovo: 'CRIANDO', detalhes: { ambiente: cfg.ambiente, templateToken: modelo.token }, usuario: user.EMAIL || email, origem: 'SISTEMA', requestId: requestId });

    let resp;
    try {
      resp = zapsignRequest_('models/create-doc/', { method: 'post', payload: payload });
    } catch (err) {
      row[h.STATUS_LOCAL] = 'ERRO';
      row[h.ULTIMO_ERRO] = String(err.message || err).slice(0, 1000);
      row[h.ULTIMA_ATUALIZACAO] = new Date();
      sheet.getRange(linhaCriada, 1, 1, row.length).setValues([row]);
      registrarHistoricoContrato_({ idContrato: idContrato, idEvento: dados.idEvento || '', acao: 'ERRO_CRIACAO', statusAnterior: 'CRIANDO', statusNovo: 'ERRO', detalhes: { mensagem: row[h.ULTIMO_ERRO] }, usuario: user.EMAIL || email, origem: 'ZAPSIGN', requestId: requestId });
      throw err;
    }
    const signer = (resp.signers && resp.signers[0]) || {};
    row[h.DOC_TOKEN] = resp.token || ''; row[h.OPEN_ID] = resp.open_id || '';
    row[h.STATUS_LOCAL] = normalizarStatusRespostaContrato_(resp); row[h.STATUS_ZAPSIGN] = resp.status || '';
    row[h.SIGNER_TOKEN] = signer.token || '';
    row[h.SIGN_URL] = signer.sign_url || (signer.token ? 'https://' + (cfg.ambiente === 'sandbox' ? 'sandbox.app' : 'app') + '.zapsign.com.br/verificar/' + signer.token : '');
    row[h.ULTIMA_ATUALIZACAO] = new Date();
    sheet.getRange(linhaCriada, 1, 1, row.length).setValues([row]);
    registrarHistoricoContrato_({ idContrato: idContrato, idEvento: dados.idEvento || '', acao: 'CRIAR_DOCUMENTO', statusNovo: row[h.STATUS_LOCAL], detalhes: { ambiente: cfg.ambiente, templateToken: modelo.token, docToken: resp.token || '' }, usuario: user.EMAIL || email, origem: 'ZAPSIGN', requestId: requestId });
    return { ok: true, idContrato: idContrato, status: row[h.STATUS_LOCAL], signUrl: row[h.SIGN_URL], ambiente: cfg.ambiente };
  } finally {
    lock.releaseLock();
  }
}

function sincronizarContratoZapSign_(email, idContrato) {
  const user = requireUserByEmail(email);
  requirePermission(user, 'contratos:listar');
  inicializarEstruturaContratos_(email);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONTRATOS_CFG_.ABA_CONTRATOS);
  const values = sheet.getDataRange().getValues();
  const h = mapaHeadersContratos_(CONTRATOS_HEADERS_);
  let idx = -1;
  for (let i = 1; i < values.length; i++) if (String(values[i][h.ID_CONTRATO]) === String(idContrato)) { idx = i; break; }
  if (idx < 0) throw new Error('CONTRATO_NAO_ENCONTRADO');
  const row = values[idx];
  if (!row[h.DOC_TOKEN]) throw new Error('CONTRATO_SEM_DOC_TOKEN');
  const anterior = row[h.STATUS_LOCAL];
  const resp = zapsignRequest_(
    'docs/' + encodeURIComponent(row[h.DOC_TOKEN]) + '/?atualizar=' + Date.now(),
    { method: 'get' }
  );
  const signer = (resp.signers && resp.signers[0]) || {};
  row[h.STATUS_ZAPSIGN] = resp.status || '';
  row[h.STATUS_LOCAL] = normalizarStatusRespostaContrato_(resp);
  row[h.SIGN_URL] = signer.sign_url || row[h.SIGN_URL];
  row[h.ULTIMA_ATUALIZACAO] = new Date(); row[h.ATUALIZADO_POR] = user.EMAIL || email; row[h.ULTIMO_ERRO] = '';
  sheet.getRange(idx + 1, 1, 1, row.length).setValues([row]);
  registrarHistoricoContrato_({ idContrato: idContrato, idEvento: row[h.ID_EVENTO], acao: 'SINCRONIZAR_STATUS', statusAnterior: anterior, statusNovo: row[h.STATUS_LOCAL], detalhes: { docToken: row[h.DOC_TOKEN], statusDocumento: resp.status || '', statusSignatarios: (resp.signers || []).map(function (s) { return s.status || ''; }) }, usuario: user.EMAIL || email, origem: 'ZAPSIGN' });
  return { ok: true, idContrato: idContrato, status: row[h.STATUS_LOCAL], statusZapSign: row[h.STATUS_ZAPSIGN], signUrl: row[h.SIGN_URL] };
}

function sincronizarContratosPendentesZapSign_(email) {
  const user = requireUserByEmail(email);
  requirePermission(user, 'contratos:listar');
  inicializarEstruturaContratos_(email);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONTRATOS_CFG_.ABA_CONTRATOS);
  const values = sheet.getDataRange().getValues();
  const h = mapaHeadersContratos_(CONTRATOS_HEADERS_);
  const pendentes = values.slice(1).filter(function (row) {
    return String(row[h.ID_CONTRATO] || '').trim() &&
      String(row[h.DOC_TOKEN] || '').trim() &&
      ['PENDENTE', 'CRIANDO'].indexOf(String(row[h.STATUS_LOCAL] || '').trim().toUpperCase()) !== -1;
  }).map(function (row) { return String(row[h.ID_CONTRATO]); });

  // Limite defensivo para manter a abertura da tela rápida e respeitar o
  // tempo máximo de execução do Apps Script.
  const fila = pendentes.slice(0, 25);
  const resultados = [];
  fila.forEach(function (idContrato) {
    try {
      resultados.push(sincronizarContratoZapSign_(email, idContrato));
    } catch (err) {
      resultados.push({ ok: false, idContrato: idContrato, erro: String(err.message || err).slice(0, 500) });
    }
  });
  return {
    ok: true,
    encontrados: pendentes.length,
    processados: resultados.length,
    atualizados: resultados.filter(function (r) { return r.ok; }).length,
    erros: resultados.filter(function (r) { return !r.ok; }).length,
    restantes: Math.max(0, pendentes.length - fila.length),
    resultados: resultados
  };
}
