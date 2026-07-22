/**
 * ======================================================
 * INTEGRAÇÃO — ORÇAMENTO UTILITÁRIO EXTERNO
 * ======================================================
 * Este módulo mantém o orçamento isolado do core do sistema.
 * O frontend chama apenas o backend principal, e este módulo
 * encaminha com assinatura HMAC para o utilitário externo.
 */

function gerarOrcamentoInterno(params, email) {
  const cfg = getConfig() || {};
  const endpoint = String(cfg.ORCAMENTO_WEBHOOK_URL || '').trim();
  const secret = String(cfg.ORCAMENTO_HMAC_SECRET || '').trim();
  obterNumeroConfigOrcamento_(cfg.ORCAMENTO_TIMEOUT_MS, 30000, 10000, 120000); // valida configuração para evitar valores inválidos

  if (!endpoint) {
    throw new Error('ORCAMENTO_CONFIG_INCOMPLETA: ORCAMENTO_WEBHOOK_URL');
  }
  if (!secret) {
    throw new Error('ORCAMENTO_CONFIG_INCOMPLETA: ORCAMENTO_HMAC_SECRET');
  }

  const usuario = requireUserByEmail(email);
  const requestId = 'ORC-' + Utilities.getUuid().slice(0, 8).toUpperCase();

  const body = {
    requestId: requestId,
    origin: 'sistema-agenda-fa',
    requestedAt: new Date().toISOString(),
    user: {
      email: String(usuario.EMAIL || ''),
      nome: String(usuario.NOME || ''),
      perfil: String(usuario.PERFIL || '')
    },
    payload: {
      nome: String(params.nome || '').trim(),
      telefone: String(params.telefone || '').trim(),
      dataEvento: String(params.dataEvento || '').trim(),
      propostas: normalizarPropostasOrcamento_(params.propostas),
      valorPocket: converterNumeroOrcamento_(params.valorPocket),
      valorGold: converterNumeroOrcamento_(params.valorGold),
      valorPremium: converterNumeroOrcamento_(params.valorPremium),
      valorDebut: converterNumeroOrcamento_(params.valorDebut),
      observacoes: String(params.observacoes || '').trim()
    }
  };

  validarPayloadOrcamento_(body.payload);

  const payloadSemAuth = JSON.stringify(body);
  const auth = montarAssinaturaOrcamento_(payloadSemAuth, secret);
  body._auth = {
    timestamp: auth.timestamp,
    nonce: auth.nonce,
    signature: auth.signature,
    source: 'sistema-agenda-fa'
  };
  const payloadJson = JSON.stringify(body);

  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: payloadJson,
    muteHttpExceptions: true,
    followRedirects: true,
    escaping: false,
    validateHttpsCertificates: true
  });

  const status = Number(response.getResponseCode() || 0);
  const texto = response.getContentText() || '';
  let data = null;

  try {
    data = texto ? JSON.parse(texto) : null;
  } catch (_) {
    data = null;
  }

  if (status < 200 || status >= 300) {
    throw new Error('ORCAMENTO_HTTP_' + status + (texto ? (': ' + texto.slice(0, 300)) : ''));
  }

  if (!data || data.sucesso !== true) {
    const motivo = data && (data.mensagem || data.error) ? String(data.mensagem || data.error) : 'Falha no utilitário de orçamento';
    throw new Error('ORCAMENTO_FALHA_UTILITARIO: ' + motivo);
  }

  return {
    sucesso: true,
    requestId: requestId,
    numeroOrcamento: String(data.numeroOrcamento || ''),
    linkPdf: String(data.linkPdf || ''),
    linkWhats: String(data.linkWhats || ''),
    mensagem: String(data.mensagem || 'Orçamento gerado com sucesso.')
  };
}

function validarPayloadOrcamento_(p) {
  if (!p.nome) throw new Error('ORCAMENTO_DADO_OBRIGATORIO: nome');
  if (!p.telefone) throw new Error('ORCAMENTO_DADO_OBRIGATORIO: telefone');
  if (!p.dataEvento) throw new Error('ORCAMENTO_DADO_OBRIGATORIO: dataEvento');
  if (!p.propostas || !p.propostas.length) throw new Error('ORCAMENTO_DADO_OBRIGATORIO: propostas');
}

function normalizarPropostasOrcamento_(valor) {
  if (Array.isArray(valor)) {
    return valor
      .map(function (x) { return String(x || '').trim().toLowerCase(); })
      .filter(function (x) { return !!x; });
  }
  const str = String(valor || '').trim();
  if (!str) return [];
  return str
    .split(',')
    .map(function (x) { return String(x || '').trim().toLowerCase(); })
    .filter(function (x) { return !!x; });
}

function converterNumeroOrcamento_(valor) {
  if (valor === null || typeof valor === 'undefined' || String(valor).trim() === '') return null;
  const n = Number(String(valor).replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

function obterNumeroConfigOrcamento_(raw, fallback, min, max) {
  const n = Number(String(raw || '').trim());
  if (isNaN(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function montarAssinaturaOrcamento_(payloadJson, secret) {
  const timestamp = String(Date.now());
  const nonce = Utilities.getUuid();
  const material = timestamp + '.' + nonce + '.' + payloadJson;
  const bytes = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_256,
    material,
    secret
  );

  const hex = bytes
    .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); })
    .join('');

  return {
    timestamp: timestamp,
    nonce: nonce,
    signature: hex
  };
}
