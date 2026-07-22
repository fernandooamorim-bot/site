/**
 * ======================================================
 * INTEGRAÇÃO — PRECIFICADOR DE SHOW (UTILITÁRIO EXTERNO)
 * ======================================================
 */

function precificadorShowProxy(params, email) {
  const cfg = getConfig() || {};
  const endpointDefault = 'https://script.google.com/macros/s/AKfycbxzmsZnNklGO060mm4QRgpqbV_XSlL4sDJ3heDqBaSHsdOiXPoja35J97BjbDmPVvdt/exec';
  const endpoint = String(cfg.PRECIFICADOR_SHOW_WEBHOOK_URL || endpointDefault).trim();

  if (!endpoint) {
    throw new Error('PRECIFICADOR_SHOW_CONFIG_INCOMPLETA: PRECIFICADOR_SHOW_WEBHOOK_URL');
  }

  const externalAction = String(params.externalAction || '').trim();
  if (!externalAction) {
    throw new Error('PRECIFICADOR_SHOW_DADO_OBRIGATORIO: externalAction');
  }
  if (!acaoPrecificadorShowPermitida_(externalAction)) {
    throw new Error('PRECIFICADOR_SHOW_ACAO_INVALIDA: ' + externalAction);
  }

  const usuario = requireUserByEmail(email);
  const payloadEntrada = extrairPayloadPrecificadorShow_(params);
  const payload = Object.assign({}, payloadEntrada);
  payload.action = externalAction;

  if (!payload.email) payload.email = String(usuario.EMAIL || '');

  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    followRedirects: true,
    escaping: false,
    validateHttpsCertificates: true
  });

  const status = Number(response.getResponseCode() || 0);
  const text = response.getContentText() || '';
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }

  if (status < 200 || status >= 300) {
    throw new Error('PRECIFICADOR_SHOW_HTTP_' + status + (text ? (': ' + text.slice(0, 300)) : ''));
  }

  if (!data) {
    throw new Error('PRECIFICADOR_SHOW_RESPOSTA_INVALIDA');
  }

  return {
    sucesso: true,
    externalAction: externalAction,
    data: data,
    debug: {
      endpointUtilizado: endpoint
    }
  };
}

function extrairPayloadPrecificadorShow_(params) {
  const p = params && typeof params === 'object' ? params : {};

  if (p.payload && typeof p.payload === 'object') {
    return Object.assign({}, p.payload);
  }

  if (typeof p.payloadJson === 'string' && p.payloadJson.trim()) {
    try {
      const parsedJson = JSON.parse(p.payloadJson);
      if (parsedJson && typeof parsedJson === 'object') {
        return Object.assign({}, parsedJson);
      }
    } catch (_) {}
  }

  if (typeof p.payload === 'string' && p.payload.trim()) {
    try {
      const parsedPayload = JSON.parse(p.payload);
      if (parsedPayload && typeof parsedPayload === 'object') {
        return Object.assign({}, parsedPayload);
      }
    } catch (_) {}
  }

  const ignorar = {
    action: true,
    externalAction: true,
    sessionToken: true
  };
  const out = {};
  Object.keys(p).forEach(function (k) {
    if (ignorar[k]) return;
    out[k] = p[k];
  });
  return out;
}

function acaoPrecificadorShowPermitida_(action) {
  const allow = [
    'validateAccess',
    'getConfiguracoes',
    'calcular',
    'salvarHistorico'
  ];
  return allow.indexOf(String(action || '').trim()) !== -1;
}
