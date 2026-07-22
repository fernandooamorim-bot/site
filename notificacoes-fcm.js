/**
 * NOTIFICAÇÕES WEB PUSH (Firebase Cloud Messaging HTTP v1)
 * Fundação segura: nenhum envio automático ocorre neste módulo.
 * CONFIG é a fonte das opções operacionais; a chave privada fica somente em
 * Script Properties, sob FCM_SERVICE_ACCOUNT_JSON.
 */

const NOTIFICACOES_ABA_DISPOSITIVOS_ = 'NOTIFICACOES_DISPOSITIVOS';
const NOTIFICACOES_ABA_REGRAS_ = 'NOTIFICACOES_REGRAS';
const NOTIFICACOES_ABA_HISTORICO_ = 'NOTIFICACOES_HISTORICO';
const NOTIFICACOES_HEADERS_ = [
  'TOKEN', 'EMAIL', 'PERFIL', 'PLATAFORMA', 'NAVEGADOR', 'ATIVO',
  'EVENTOS_DIA', 'EVENTO_CRIADO_EDITADO', 'FOLHA_CUSTOS',
  'CRIADO_EM', 'ATUALIZADO_EM', 'ULTIMO_ERRO', 'NOME_DISPOSITIVO',
  'ULTIMO_ACESSO', 'TIPO_IDENTIFICADOR'
];
const NOTIFICACOES_PERFIS_PERMITIDOS_ = ['Proprietário', 'Sócio', 'Administrador', 'Produção', 'Músico'];
const NOTIFICACOES_CONFIG_EDITAVEL_ = [
  'FCM_ATIVO', 'NOTIFICACOES_MODO_TESTE', 'NOTIFICACOES_DESTINATARIO_TESTE',
  'NOTIFICACOES_HORA_RESUMO_DIA', 'NOTIFICACOES_ANTECEDENCIA_EVENTO_MIN',
  'NOTIFICACOES_ANTECEDENCIA_PREPARACAO_HORAS', 'NOTIFICACOES_HORARIO_INICIO',
  'NOTIFICACOES_HORARIO_FIM', 'NOTIFICACOES_TIMEZONE',
  'NOTIFICACOES_DIAS_RETER_HISTORICO', 'NOTIFICACOES_MAX_TENTATIVAS',
  'NOTIFICACOES_EMAIL_ATIVO'
];

function obterCentralNotificacoes_(email) {
  const cfg = carregarConfigNotificacoes_();
  const regras = listarRegrasNotificacoes_();
  const dispositivos = listarTodosDispositivosNotificacao_();
  const historico = obterResumoHistoricoNotificacoes_();
  return {
    ok: true,
    configuracao: {
      FCM_ATIVO: cfg.ativo,
      NOTIFICACOES_MODO_TESTE: boolNotificacao_(obterConfig('NOTIFICACOES_MODO_TESTE'), true),
      NOTIFICACOES_DESTINATARIO_TESTE: String(obterConfig('NOTIFICACOES_DESTINATARIO_TESTE') || ''),
      NOTIFICACOES_HORA_RESUMO_DIA: String(obterConfig('NOTIFICACOES_HORA_RESUMO_DIA') || '09:00'),
      NOTIFICACOES_ANTECEDENCIA_EVENTO_MIN: Number(obterConfig('NOTIFICACOES_ANTECEDENCIA_EVENTO_MIN') || 60),
      NOTIFICACOES_ANTECEDENCIA_PREPARACAO_HORAS: Number(obterConfig('NOTIFICACOES_ANTECEDENCIA_PREPARACAO_HORAS') || 6),
      NOTIFICACOES_HORARIO_INICIO: String(obterConfig('NOTIFICACOES_HORARIO_INICIO') || '07:00'),
      NOTIFICACOES_HORARIO_FIM: String(obterConfig('NOTIFICACOES_HORARIO_FIM') || '23:00'),
      NOTIFICACOES_TIMEZONE: String(obterConfig('NOTIFICACOES_TIMEZONE') || 'America/Fortaleza'),
      NOTIFICACOES_DIAS_RETER_HISTORICO: Number(obterConfig('NOTIFICACOES_DIAS_RETER_HISTORICO') || 180),
      NOTIFICACOES_MAX_TENTATIVAS: Number(obterConfig('NOTIFICACOES_MAX_TENTATIVAS') || 3),
      NOTIFICACOES_EMAIL_ATIVO: boolNotificacao_(obterConfig('NOTIFICACOES_EMAIL_ATIVO'), false),
      AGENDA_HORA_VIRADA_MADRUGADA: Number(obterConfig('AGENDA_HORA_VIRADA_MADRUGADA') || 6)
    },
    diagnostico: {
      firebaseConfigurado: cfg.configurada,
      credencialInstalada: cfg.credencialInstalada,
      envioGlobalAtivo: cfg.ativo,
      regrasAtivas: regras.filter(function (r) { return r.ativo; }).length,
      totalRegras: regras.length,
      dispositivosAtivos: dispositivos.filter(function (d) { return d.ativo; }).length,
      totalDispositivos: dispositivos.length,
      solicitante: String(email || ''),
      historico: historico
    },
    regras: regras,
    dispositivos: dispositivos
  };
}

function listarRegrasNotificacoes_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOTIFICACOES_ABA_REGRAS_);
  if (!sheet) throw new Error('NOTIFICACOES_REGRAS_SHEET_NOT_FOUND');
  const dados = sheet.getDataRange().getValues();
  if (dados.length < 1) return [];
  const idx = indexarHeadersNotificacao_(dados[0]);
  return dados.slice(1).filter(function (r) {
    return String(valorPorHeaderNotificacao_(r, idx, 'CODIGO') || '').trim();
  }).map(function (r) {
    return {
      codigo: String(valorPorHeaderNotificacao_(r, idx, 'CODIGO') || '').trim(),
      nome: String(valorPorHeaderNotificacao_(r, idx, 'NOME') || '').trim(),
      descricao: String(valorPorHeaderNotificacao_(r, idx, 'DESCRICAO') || '').trim(),
      categoria: String(valorPorHeaderNotificacao_(r, idx, 'CATEGORIA') || '').trim(),
      ativo: boolNotificacao_(valorPorHeaderNotificacao_(r, idx, 'ATIVO'), false),
      canalPush: boolNotificacao_(valorPorHeaderNotificacao_(r, idx, 'CANAL_PUSH'), true),
      canalEmail: boolNotificacao_(valorPorHeaderNotificacao_(r, idx, 'CANAL_EMAIL'), false),
      prioridade: String(valorPorHeaderNotificacao_(r, idx, 'PRIORIDADE') || 'NORMAL').trim().toUpperCase(),
      perfis: String(valorPorHeaderNotificacao_(r, idx, 'PERFIS_DESTINATARIOS') || '').split(';').map(function (p) { return p.trim(); }).filter(Boolean),
      antecedenciaMin: Number(valorPorHeaderNotificacao_(r, idx, 'ANTECEDENCIA_MIN') || 0),
      horarioEnvio: formatarHoraValorNotificacao_(valorPorHeaderNotificacao_(r, idx, 'HORARIO_ENVIO')),
      agrupar: boolNotificacao_(valorPorHeaderNotificacao_(r, idx, 'AGRUPAR'), false),
      obrigatoria: boolNotificacao_(valorPorHeaderNotificacao_(r, idx, 'OBRIGATORIA'), false),
      titulo: String(valorPorHeaderNotificacao_(r, idx, 'TEMPLATE_TITULO') || '').trim(),
      mensagem: String(valorPorHeaderNotificacao_(r, idx, 'TEMPLATE_MENSAGEM') || '').trim(),
      linkDestino: String(valorPorHeaderNotificacao_(r, idx, 'LINK_DESTINO') || '').trim(),
      observacoes: String(valorPorHeaderNotificacao_(r, idx, 'OBSERVACOES') || '').trim()
    };
  });
}

function atualizarRegraNotificacao_(email, params) {
  const codigo = String(params.codigo || '').trim().toUpperCase();
  if (!codigo) throw new Error('NOTIFICACAO_CODIGO_REQUIRED');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOTIFICACOES_ABA_REGRAS_);
  if (!sheet) throw new Error('NOTIFICACOES_REGRAS_SHEET_NOT_FOUND');
  const dados = sheet.getDataRange().getValues();
  const idx = indexarHeadersNotificacao_(dados[0] || []);
  const perfisRecebidos = parseJsonArrayNotificacao_(params.perfis).filter(function (p) {
    return NOTIFICACOES_PERFIS_PERMITIDOS_.indexOf(String(p)) !== -1;
  });
  if (!perfisRecebidos.length) throw new Error('NOTIFICACAO_PERFIL_REQUIRED');
  const prioridade = String(params.prioridade || 'NORMAL').trim().toUpperCase();
  if (['BAIXA', 'NORMAL', 'ALTA', 'CRITICA'].indexOf(prioridade) === -1) throw new Error('NOTIFICACAO_PRIORIDADE_INVALIDA');
  for (let i = 1; i < dados.length; i++) {
    if (String(valorPorHeaderNotificacao_(dados[i], idx, 'CODIGO') || '').trim().toUpperCase() !== codigo) continue;
    const atualizacoes = {
      ATIVO: boolNotificacao_(params.ativo, false),
      CANAL_PUSH: boolNotificacao_(params.canalPush, true),
      CANAL_EMAIL: boolNotificacao_(params.canalEmail, false),
      PRIORIDADE: prioridade,
      PERFIS_DESTINATARIOS: perfisRecebidos.join(';'),
      ANTECEDENCIA_MIN: Math.max(0, Math.min(43200, Number(params.antecedenciaMin) || 0)),
      HORARIO_ENVIO: validarHoraNotificacao_(params.horarioEnvio),
      AGRUPAR: boolNotificacao_(params.agrupar, false),
      OBRIGATORIA: boolNotificacao_(params.obrigatoria, false),
      ATUALIZADO_EM: new Date(),
      ATUALIZADO_POR: String(email || '').trim().toLowerCase()
    };
    Object.keys(atualizacoes).forEach(function (header) {
      if (idx[header] !== undefined) sheet.getRange(i + 1, idx[header] + 1).setValue(atualizacoes[header]);
    });
    registrarLog('ATUALIZAR', NOTIFICACOES_ABA_REGRAS_, codigo, 'Regra de notificação atualizada');
    return { ok: true, codigo: codigo };
  }
  throw new Error('NOTIFICACAO_REGRA_NAO_ENCONTRADA');
}

function atualizarConfigNotificacoes_(email, params) {
  const chave = String(params.chave || '').trim().toUpperCase();
  if (NOTIFICACOES_CONFIG_EDITAVEL_.indexOf(chave) === -1) throw new Error('NOTIFICACAO_CONFIG_NAO_EDITAVEL');
  let valor = String(params.valor === undefined ? '' : params.valor).trim();
  if (['FCM_ATIVO', 'NOTIFICACOES_MODO_TESTE', 'NOTIFICACOES_EMAIL_ATIVO'].indexOf(chave) !== -1) {
    valor = boolNotificacao_(valor, false) ? 'TRUE' : 'FALSE';
  }
  if (chave === 'FCM_ATIVO' && valor === 'TRUE') {
    const cfg = carregarConfigNotificacoes_();
    if (!cfg.configurada) throw new Error('FCM_CONFIG_PUBLICA_INCOMPLETA');
    if (!cfg.credencialInstalada) throw new Error('FCM_CREDENCIAL_NAO_INSTALADA');
    if (!boolNotificacao_(obterConfig('NOTIFICACOES_MODO_TESTE'), true)) {
      throw new Error('FCM_ATIVACAO_EXIGE_MODO_TESTE');
    }
  }
  if (['NOTIFICACOES_HORA_RESUMO_DIA', 'NOTIFICACOES_HORARIO_INICIO', 'NOTIFICACOES_HORARIO_FIM'].indexOf(chave) !== -1) {
    valor = validarHoraNotificacao_(valor);
    if (!valor) throw new Error('NOTIFICACAO_HORA_INVALIDA');
  }
  if (chave === 'NOTIFICACOES_TIMEZONE' && valor !== 'America/Fortaleza') throw new Error('NOTIFICACAO_TIMEZONE_INVALIDA');
  if (['NOTIFICACOES_ANTECEDENCIA_EVENTO_MIN', 'NOTIFICACOES_ANTECEDENCIA_PREPARACAO_HORAS', 'NOTIFICACOES_DIAS_RETER_HISTORICO', 'NOTIFICACOES_MAX_TENTATIVAS'].indexOf(chave) !== -1) {
    const numero = Number(valor);
    if (!isFinite(numero) || numero < 0) throw new Error('NOTIFICACAO_NUMERO_INVALIDO');
    valor = String(Math.floor(numero));
  }
  if (!setConfig(chave, valor)) throw new Error('NOTIFICACAO_CONFIG_NAO_ENCONTRADA');
  registrarLog('ATUALIZAR', 'CONFIG', chave, 'Configuração de notificações atualizada por ' + String(email || ''));
  return { ok: true, chave: chave, valor: valor };
}

function listarTodosDispositivosNotificacao_() {
  const sheet = obterOuCriarAbaDispositivosNotificacao_();
  const dados = sheet.getDataRange().getValues();
  const idx = indexarHeadersNotificacao_(dados[0] || NOTIFICACOES_HEADERS_);
  return dados.slice(1).filter(function (r) { return String(valorPorHeaderNotificacao_(r, idx, 'TOKEN') || '').trim(); }).map(function (r) {
    const token = String(valorPorHeaderNotificacao_(r, idx, 'TOKEN') || '');
    return {
      email: String(valorPorHeaderNotificacao_(r, idx, 'EMAIL') || ''),
      perfil: String(valorPorHeaderNotificacao_(r, idx, 'PERFIL') || ''),
      plataforma: String(valorPorHeaderNotificacao_(r, idx, 'PLATAFORMA') || ''),
      navegador: String(valorPorHeaderNotificacao_(r, idx, 'NAVEGADOR') || ''),
      nomeDispositivo: String(valorPorHeaderNotificacao_(r, idx, 'NOME_DISPOSITIVO') || ''),
      identificadorTipo: normalizarTipoIdentificadorNotificacao_(valorPorHeaderNotificacao_(r, idx, 'TIPO_IDENTIFICADOR')),
      tokenFinal: token.slice(-10),
      ativo: boolNotificacao_(valorPorHeaderNotificacao_(r, idx, 'ATIVO'), true),
      atualizadoEm: valorPorHeaderNotificacao_(r, idx, 'ATUALIZADO_EM'),
      ultimoAcesso: valorPorHeaderNotificacao_(r, idx, 'ULTIMO_ACESSO'),
      ultimoErro: String(valorPorHeaderNotificacao_(r, idx, 'ULTIMO_ERRO') || '')
    };
  });
}

function obterResumoHistoricoNotificacoes_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOTIFICACOES_ABA_HISTORICO_);
  if (!sheet || sheet.getLastRow() < 2) return { total: 0, enviados: 0, erros: 0, ultimoEnvio: '' };
  const dados = sheet.getDataRange().getValues();
  const idx = indexarHeadersNotificacao_(dados[0]);
  let enviados = 0; let erros = 0; let ultimoEnvio = null; let total = 0;
  dados.slice(1).forEach(function (r) {
    if (!String(valorPorHeaderNotificacao_(r, idx, 'ID_ENVIO') || '').trim()) return;
    total++;
    const status = String(valorPorHeaderNotificacao_(r, idx, 'STATUS') || '').toUpperCase();
    if (status === 'ENVIADO') enviados++;
    if (status === 'ERRO') erros++;
    const data = valorPorHeaderNotificacao_(r, idx, 'ENVIADO_EM');
    if (data instanceof Date && (!ultimoEnvio || data > ultimoEnvio)) ultimoEnvio = data;
  });
  return { total: total, enviados: enviados, erros: erros, ultimoEnvio: ultimoEnvio || '' };
}

function indexarHeadersNotificacao_(headers) {
  const idx = {};
  (headers || []).forEach(function (h, i) { idx[String(h || '').trim().toUpperCase()] = i; });
  return idx;
}

function valorPorHeaderNotificacao_(row, idx, header) {
  const pos = idx[String(header || '').toUpperCase()];
  return pos === undefined ? '' : row[pos];
}

function parseJsonArrayNotificacao_(valor) {
  if (Array.isArray(valor)) return valor;
  try { const parsed = JSON.parse(String(valor || '[]')); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; }
}

function validarHoraNotificacao_(valor) {
  const s = formatarHoraValorNotificacao_(valor);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : '';
}

function formatarHoraValorNotificacao_(valor) {
  if (valor instanceof Date) return Utilities.formatDate(valor, Session.getScriptTimeZone() || 'America/Fortaleza', 'HH:mm');
  const s = String(valor || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? String(Number(m[1])).padStart(2, '0') + ':' + m[2] : s;
}

function obterStatusNotificacoes_(email) {
  const cfg = carregarConfigNotificacoes_();
  const registros = listarDispositivosNotificacaoPorEmail_(email);
  return {
    ok: true,
    disponivel: cfg.configurada,
    ativoGlobal: cfg.ativo,
    credencialInstalada: cfg.credencialInstalada,
    vapidPublicKey: cfg.vapidPublicKey,
    firebase: cfg.firebasePublica,
    dispositivos: registros.map(function (r) {
      return {
        tokenFinal: String(r.TOKEN || '').slice(-10),
        plataforma: r.PLATAFORMA,
        navegador: r.NAVEGADOR,
        ativo: boolNotificacao_(r.ATIVO, true),
        preferencias: {
          eventosDia: boolNotificacao_(r.EVENTOS_DIA, true),
          eventoCriadoEditado: boolNotificacao_(r.EVENTO_CRIADO_EDITADO, true),
          folhaCustos: boolNotificacao_(r.FOLHA_CUSTOS, true)
        },
        atualizadoEm: r.ATUALIZADO_EM
      };
    })
  };
}

function registrarDispositivoNotificacao_(email, params) {
  const token = String(params.token || '').trim();
  const identificadorTipo = normalizarTipoIdentificadorNotificacao_(params.identificadorTipo);
  const tamanhoMinimo = identificadorTipo === 'FID' ? 10 : 40;
  if (token.length < tamanhoMinimo || token.length > 4096) {
    throw new Error(identificadorTipo === 'FID' ? 'FCM_FID_INVALIDO' : 'FCM_TOKEN_INVALIDO');
  }

  const user = requireUserByEmail(email);
  const sheet = obterOuCriarAbaDispositivosNotificacao_();
  const dados = sheet.getDataRange().getValues();
  const agora = new Date();
  let linha = -1;
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][0] || '') === token) { linha = i + 1; break; }
  }

  const anterior = linha > 0 ? sheet.getRange(linha, 1, 1, NOTIFICACOES_HEADERS_.length).getValues()[0] : [];
  const valores = [[
    token,
    String(email || '').trim().toLowerCase(),
    String(user.PERFIL || ''),
    limitarTextoNotificacao_(params.plataforma, 60),
    limitarTextoNotificacao_(params.navegador, 120),
    true,
    boolNotificacao_(params.eventosDia, anterior.length ? anterior[6] : true),
    boolNotificacao_(params.eventoCriadoEditado, anterior.length ? anterior[7] : true),
    boolNotificacao_(params.folhaCustos, anterior.length ? anterior[8] : true),
    anterior[9] || agora,
    agora,
    '',
    limitarTextoNotificacao_(params.nomeDispositivo, 80),
    agora,
    identificadorTipo
  ]];

  if (linha > 0) sheet.getRange(linha, 1, 1, valores[0].length).setValues(valores);
  else sheet.getRange(sheet.getLastRow() + 1, 1, 1, valores[0].length).setValues(valores);
  return { ok: true };
}

function removerDispositivoNotificacao_(email, params) {
  const token = String(params.token || '').trim();
  if (!token) throw new Error('FCM_TOKEN_REQUIRED');
  const sheet = obterOuCriarAbaDispositivosNotificacao_();
  const dados = sheet.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][0] || '') === token && String(dados[i][1] || '').trim().toLowerCase() === String(email).trim().toLowerCase()) {
      sheet.getRange(i + 1, 6).setValue(false);
      sheet.getRange(i + 1, 11).setValue(new Date());
      return { ok: true };
    }
  }
  return { ok: true };
}

function atualizarPreferenciasNotificacao_(email, params) {
  const token = String(params.token || '').trim();
  if (!token) throw new Error('FCM_TOKEN_REQUIRED');
  const sheet = obterOuCriarAbaDispositivosNotificacao_();
  const dados = sheet.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][0] || '') === token && String(dados[i][1] || '').trim().toLowerCase() === String(email).trim().toLowerCase()) {
      sheet.getRange(i + 1, 7, 1, 3).setValues([[
        boolNotificacao_(params.eventosDia, dados[i][6]),
        boolNotificacao_(params.eventoCriadoEditado, dados[i][7]),
        boolNotificacao_(params.folhaCustos, dados[i][8])
      ]]);
      sheet.getRange(i + 1, 11).setValue(new Date());
      return { ok: true };
    }
  }
  throw new Error('FCM_DISPOSITIVO_NAO_ENCONTRADO');
}

function enviarNotificacaoTeste_(email) {
  const cfg = carregarConfigNotificacoes_();
  if (!cfg.configurada) throw new Error('FCM_CONFIG_PUBLICA_INCOMPLETA');
  if (!cfg.credencialInstalada) throw new Error('FCM_CREDENCIAL_NAO_INSTALADA');
  if (!boolNotificacao_(obterConfig('NOTIFICACOES_MODO_TESTE'), true)) {
    throw new Error('FCM_TESTE_EXIGE_MODO_TESTE');
  }
  const destinatarioTeste = String(obterConfig('NOTIFICACOES_DESTINATARIO_TESTE') || '').trim().toLowerCase();
  const emailSolicitante = String(email || '').trim().toLowerCase();
  if (!destinatarioTeste || destinatarioTeste !== emailSolicitante) {
    throw new Error('FCM_DESTINATARIO_TESTE_DIVERGENTE');
  }
  const dispositivos = listarDispositivosNotificacaoPorEmail_(emailSolicitante).filter(function (r) {
    return boolNotificacao_(r.ATIVO, true);
  });
  if (!dispositivos.length) throw new Error('FCM_NENHUM_DISPOSITIVO_ATIVO');
  let enviados = 0;
  const resultados = [];
  dispositivos.forEach(function (r) {
    const tipoIdentificador = normalizarTipoIdentificadorNotificacao_(r.TIPO_IDENTIFICADOR);
    const resposta = enviarFcmHttpV1_(String(r.TOKEN), {
      title: 'Teste da Super Agenda',
      body: 'Notificações configuradas com sucesso neste aparelho.',
      url: './index.html?menu=1',
      tipo: 'TESTE'
    }, { permitirComEnvioGlobalDesligado: true, identificadorTipo: tipoIdentificador });
    enviados++;
    resultados.push({
      tokenFinal: String(r.TOKEN || '').slice(-10),
      plataforma: String(r.PLATAFORMA || ''),
      nomeDispositivo: String(r.NOME_DISPOSITIVO || ''),
      identificadorTipo: tipoIdentificador,
      firebaseMessageName: String(resposta.firebaseMessageName || '')
    });
  });
  return { ok: true, enviados: enviados, resultados: resultados };
}

function enviarFcmHttpV1_(token, notificacao, opcoes) {
  const cfg = carregarConfigNotificacoes_();
  const permitirTeste = !!(opcoes && opcoes.permitirComEnvioGlobalDesligado);
  if (!cfg.ativo && !permitirTeste) return { ignorado: true, motivo: 'FCM_DESATIVADO' };
  const cred = obterCredencialFcm_();
  const accessToken = obterAccessTokenFcm_(cred);
  const endpoint = 'https://fcm.googleapis.com/v1/projects/' + encodeURIComponent(cfg.projectId) + '/messages:send';
  const identificadorTipo = normalizarTipoIdentificadorNotificacao_(opcoes && opcoes.identificadorTipo);
  const mensagem = {
      notification: { title: String(notificacao.title || 'Super Agenda'), body: String(notificacao.body || '') },
      data: { url: String(notificacao.url || './index.html?menu=1'), tipo: String(notificacao.tipo || 'GERAL') },
      webpush: { headers: { TTL: '300', Urgency: 'high' } }
  };
  mensagem[identificadorTipo === 'FID' ? 'fid' : 'token'] = String(token);
  const payload = { message: mensagem };
  const resp = UrlFetchApp.fetch(endpoint, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + accessToken }, payload: JSON.stringify(payload)
  });
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('FCM_SEND_FAILED_' + code);
  let resposta = {};
  try { resposta = JSON.parse(resp.getContentText() || '{}'); } catch (_) {}
  return { ok: true, firebaseMessageName: String(resposta.name || '') };
}

function obterAccessTokenFcm_(cred) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('FCM_OAUTH_ACCESS_TOKEN');
  if (cached) return cached;
  const agora = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeString_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64UrlEncodeString_(JSON.stringify({
    iss: cred.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 3600
  }));
  const unsigned = header + '.' + claim;
  const assinatura = Utilities.computeRsaSha256Signature(unsigned, cred.private_key);
  const jwt = unsigned + '.' + Utilities.base64EncodeWebSafe(assinatura).replace(/=+$/g, '');
  const resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }
  });
  if (resp.getResponseCode() !== 200) throw new Error('FCM_OAUTH_FAILED_' + resp.getResponseCode());
  const data = JSON.parse(resp.getContentText() || '{}');
  if (!data.access_token) throw new Error('FCM_OAUTH_TOKEN_AUSENTE');
  cache.put('FCM_OAUTH_ACCESS_TOKEN', data.access_token, 3300);
  return data.access_token;
}

function carregarConfigNotificacoes_() {
  const projectId = String(obterConfig('FIREBASE_PROJECT_ID') || '').trim();
  const vapid = String(obterConfig('FIREBASE_VAPID_PUBLIC_KEY') || '').trim();
  const apiKey = String(obterConfig('FIREBASE_WEB_API_KEY') || '').trim();
  const senderId = String(obterConfig('FIREBASE_MESSAGING_SENDER_ID') || '').trim();
  const appId = String(obterConfig('FIREBASE_WEB_APP_ID') || '').trim();
  const credencialInstalada = !!String(PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT_JSON') || '').trim();
  return {
    ativo: boolNotificacao_(obterConfig('FCM_ATIVO'), false),
    configurada: !!(projectId && vapid && apiKey && senderId && appId),
    credencialInstalada: credencialInstalada,
    projectId: projectId,
    vapidPublicKey: vapid,
    firebasePublica: {
      apiKey: apiKey,
      authDomain: String(obterConfig('FIREBASE_AUTH_DOMAIN') || '').trim(),
      projectId: projectId,
      storageBucket: String(obterConfig('FIREBASE_STORAGE_BUCKET') || '').trim(),
      messagingSenderId: senderId,
      appId: appId
    }
  };
}

function obterCredencialFcm_() {
  const raw = String(PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT_JSON') || '').trim();
  if (!raw) throw new Error('FCM_CREDENCIAL_NAO_INSTALADA');
  let cred;
  try { cred = JSON.parse(raw); } catch (_) { throw new Error('FCM_CREDENCIAL_INVALIDA'); }
  if (!cred.client_email || !cred.private_key) throw new Error('FCM_CREDENCIAL_INCOMPLETA');
  return cred;
}

function obterOuCriarAbaDispositivosNotificacao_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(NOTIFICACOES_ABA_DISPOSITIVOS_);
  if (!sheet) {
    const lock = LockService.getDocumentLock();
    lock.waitLock(10000);
    try {
      sheet = ss.getSheetByName(NOTIFICACOES_ABA_DISPOSITIVOS_);
      if (!sheet) {
        sheet = ss.insertSheet(NOTIFICACOES_ABA_DISPOSITIVOS_);
        sheet.getRange(1, 1, 1, NOTIFICACOES_HEADERS_.length).setValues([NOTIFICACOES_HEADERS_]);
        sheet.setFrozenRows(1);
        sheet.hideColumns(1);
      }
    } finally { lock.releaseLock(); }
  }
  const headersAtuais = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), NOTIFICACOES_HEADERS_.length)).getValues()[0]
    : [];
  NOTIFICACOES_HEADERS_.forEach(function (header, i) {
    if (String(headersAtuais[i] || '').trim().toUpperCase() !== header) {
      sheet.getRange(1, i + 1).setValue(header);
    }
  });
  return sheet;
}

function listarDispositivosNotificacaoPorEmail_(email) {
  const sheet = obterOuCriarAbaDispositivosNotificacao_();
  const dados = sheet.getDataRange().getValues();
  const alvo = String(email || '').trim().toLowerCase();
  return dados.slice(1).filter(function (r) { return String(r[1] || '').trim().toLowerCase() === alvo; }).map(function (r) {
    const obj = {}; NOTIFICACOES_HEADERS_.forEach(function (h, i) { obj[h] = r[i]; }); return obj;
  });
}

function boolNotificacao_(valor, fallback) {
  if (valor === undefined || valor === null || String(valor).trim() === '') return !!fallback;
  return ['true', '1', 'sim', 'yes', 'on'].indexOf(String(valor).trim().toLowerCase()) !== -1;
}

function limitarTextoNotificacao_(valor, max) {
  return String(valor || '').trim().slice(0, max || 120);
}

function normalizarTipoIdentificadorNotificacao_(valor) {
  return String(valor || '').trim().toUpperCase() === 'FID' ? 'FID' : 'TOKEN_LEGADO';
}

/** Executar uma única vez no editor do Apps Script após publicar este arquivo. */
function configurarFundacaoNotificacoesFirebase_() {
  const valores = {
    FCM_ATIVO: 'FALSE',
    FCM_CREDENCIAL_ORIGEM: 'SCRIPT_PROPERTIES: FCM_SERVICE_ACCOUNT_JSON',
    FIREBASE_PROJECT_ID: 'super-agenda-fa',
    FIREBASE_WEB_API_KEY: 'AIzaSyBwSb7AzenKzGXcOSNzFFNIehqGrPLCRtw',
    FIREBASE_AUTH_DOMAIN: 'super-agenda-fa.firebaseapp.com',
    FIREBASE_STORAGE_BUCKET: 'super-agenda-fa.firebasestorage.app',
    FIREBASE_MESSAGING_SENDER_ID: '860394426284',
    FIREBASE_WEB_APP_ID: '1:860394426284:web:bfbae23ed378ceffc93409',
    FIREBASE_VAPID_PUBLIC_KEY: 'BAUhwD8CnTJZ_Oz3-rRQmLoNOjTj7MhXY-EVRWULcdIUUpCspdVyCXN6nIZA2XhnejvfwV0ZoDfF1fGqQwaho2c'
  };
  const descricoes = {
    FCM_ATIVO: 'Liga o envio de notificações push. Manter FALSE até concluir os testes.',
    FCM_CREDENCIAL_ORIGEM: 'Indica onde administrar a credencial privada de envio.',
    FIREBASE_PROJECT_ID: 'Identificador público do projeto Firebase.',
    FIREBASE_WEB_API_KEY: 'Chave pública de configuração do aplicativo Web Firebase.',
    FIREBASE_AUTH_DOMAIN: 'Domínio público do aplicativo Firebase.',
    FIREBASE_STORAGE_BUCKET: 'Bucket público informado na configuração Firebase.',
    FIREBASE_MESSAGING_SENDER_ID: 'Identificador público do remetente FCM.',
    FIREBASE_WEB_APP_ID: 'Identificador público do aplicativo Web Firebase.',
    FIREBASE_VAPID_PUBLIC_KEY: 'Chave pública Web Push usada pelos navegadores.'
  };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CONFIG');
  if (!sheet) throw new Error('CONFIG_SHEET_NOT_FOUND');
  const dados = sheet.getDataRange().getValues();
  const linhas = {};
  for (let i = 1; i < dados.length; i++) linhas[String(dados[i][0] || '').trim()] = i + 1;
  Object.keys(valores).forEach(function (chave) {
    if (linhas[chave]) sheet.getRange(linhas[chave], 2, 1, 2).setValues([[valores[chave], descricoes[chave]]]);
    else sheet.appendRow([chave, valores[chave], descricoes[chave]]);
  });
  obterOuCriarAbaDispositivosNotificacao_();
  return { ok: true, ativo: false };
}
