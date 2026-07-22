/**
 * ======================================================
 * ASAAS WEBHOOK MODULE — SUPER AGENDA
 * ======================================================
 * ✔ Validacao por token de webhook
 * ✔ Idempotencia por payment.id
 * ✔ Integracao com apiRegistrarRecebimento
 * ✔ Atualizacao de COBRANCAS_PIX
 * ✔ Logs em WEBHOOK_LOGS_ASAAS (auto-criada)
 * ======================================================
 */

function processarWebhookAsaas(e) {
  try {
    const asaasAtivo = String(obterConfigSeguro('ASAAS_ATIVO') || '')
      .trim()
      .toUpperCase() === 'TRUE';
    if (!asaasAtivo) {
      registrarLogWebhookAsaas_('ASAAS_INATIVO', { note: 'ASAAS_ATIVO != TRUE' });
      return respostaWebhookAsaas_({ ok: true });
    }

    const rawBody = (e && e.postData && e.postData.contents) ? e.postData.contents : '';
    if (!rawBody) {
      registrarLogWebhookAsaas_('BODY_VAZIO', {});
      return respostaWebhookAsaas_({ ok: true });
    }

    const payload = JSON.parse(rawBody);
    const headers = (e && e.headers) || {};
    const tokenRecebidoHeader = String(
      headers['asaas-access-token'] ||
      headers['Asaas-Access-Token'] ||
      headers['ASAAS-ACCESS-TOKEN'] ||
      ''
    ).trim();
    const tokenRecebidoBody = String((payload && payload._relayToken) || '').trim();
    const tokenRecebido = tokenRecebidoHeader || tokenRecebidoBody;
    const tokenEsperado = String(obterConfigSeguro('ASAAS_WEBHOOK_TOKEN') || '').trim();

    if (!tokenRecebido || !tokenEsperado || tokenRecebido !== tokenEsperado) {
      registrarLogWebhookAsaas_('TOKEN_INVALIDO', payload);
      return respostaWebhookAsaas_({ error: 'TOKEN_INVALIDO' });
    }

    const evento = String(payload.event || '').trim();
    const payment = payload.payment || null;
    if (!evento || !payment) {
      registrarLogWebhookAsaas_('EVENTO_OU_PAYMENT_AUSENTE', payload);
      return respostaWebhookAsaas_({ ok: true });
    }

    const transactionId = String(payment.id || '').trim();
    const externalReference = String(payment.externalReference || '').trim();
    const idEvento = extrairIdEventoDeExternalReferenceAsaas_(externalReference);
    const valor = Number(payment.value || 0);

    if (!transactionId) {
      registrarLogWebhookAsaas_('PAYMENT_ID_AUSENTE', payload);
      return respostaWebhookAsaas_({ ok: true });
    }

    if (isTransactionProcessedAsaas_(transactionId)) {
      registrarLogWebhookAsaas_('DUPLICADO_IGNORADO', payload);
      return respostaWebhookAsaas_({ ok: true });
    }

    if (evento === 'PAYMENT_RECEIVED' || evento === 'PAYMENT_CONFIRMED') {
      if (!idEvento) {
        registrarLogWebhookAsaas_('EXTERNAL_REFERENCE_INVALIDO', payload);
        return respostaWebhookAsaas_({ ok: true });
      }

      registrarRecebimentoAutomaticoAsaas_({
        idEvento: idEvento,
        valor: valor,
        referencia: transactionId,
        rawPayload: payload
      });

      atualizarCobrancaPixAsaasComFallback_(payment, payload, 'RECEBIDO');
      registrarLogWebhookAsaas_('RECEBIDO_OK', payload);
      return respostaWebhookAsaas_({ ok: true });
    }

    if (evento === 'PAYMENT_REFUNDED') {
      executarComoSistemaWebhookAsaas_(function () {
        apiEstornarRecebimento({
          referencia: transactionId
        });
      });
      atualizarCobrancaPixAsaasComFallback_(payment, payload, 'ESTORNADO');
      registrarLogWebhookAsaas_('ESTORNO_OK', payload);
      return respostaWebhookAsaas_({ ok: true });
    }

    if (evento === 'PAYMENT_DELETED') {
      atualizarCobrancaPixAsaasComFallback_(payment, payload, 'DELETED');
      registrarLogWebhookAsaas_('COBRANCA_DELETADA', payload);
      return respostaWebhookAsaas_({ ok: true });
    }

    registrarLogWebhookAsaas_('EVENTO_IGNORADO_' + evento, payload);
    return respostaWebhookAsaas_({ ok: true });
  } catch (err) {
    registrarLogWebhookAsaas_('ERRO_PROCESSAMENTO', {
      erro: String(err),
      stack: err && err.stack ? String(err.stack) : ''
    });
    Logger.log('[ASAAS_WEBHOOK_ERRO] ' + String(err));
    return respostaWebhookAsaas_({ ok: true });
  }
}

function registrarRecebimentoAutomaticoAsaas_(input) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    executarComoSistemaWebhookAsaas_(function () {
      apiRegistrarRecebimento({
        idEvento: input.idEvento,
        valor: Number(input.valor || 0),
        referencia: String(input.referencia || ''),
        origem: 'PIX_ASAAS_AUTOMATICO'
      });
    });
    executarComoSistemaWebhookAsaas_(function () {
      atualizarStatusPagamentoEventoAsaas_(input.idEvento);
    });
  } finally {
    lock.releaseLock();
  }
}

function atualizarStatusPagamentoEventoAsaas_(idEvento) {
  const resumo = buscarResumoFinanceiroEvento(idEvento) || {};
  const recebido = Number(resumo.totalRecebido || 0);
  const total = Number(resumo.valorTotal || 0);

  var novoStatus = 'PENDENTE';
  if (recebido <= 0) novoStatus = 'PENDENTE';
  else if (recebido < total) novoStatus = 'PARCIAL';
  else novoStatus = 'PAGO';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('EVENTOS');
  if (!sh) return;
  const data = sh.getDataRange().getValues();
  if (!data || data.length < 2) return;
  const headers = data[0].map(function (h) { return String(h || '').trim(); });
  const idxId = headers.indexOf('ID_EVENTO');
  const idxStatus = headers.indexOf('STATUS_PAGAMENTO');
  if (idxId === -1 || idxStatus === -1) return;

  const alvo = String(idEvento || '').trim();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idxId] || '').trim() !== alvo) continue;
    sh.getRange(i + 1, idxStatus + 1).setValue(novoStatus);
    break;
  }
}

function isTransactionProcessedAsaas_(transactionId) {
  const alvo = String(transactionId || '').trim();
  if (!alvo) return false;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  if (!sh) return false;

  const data = sh.getDataRange().getValues();
  if (!data || data.length < 2) return false;
  const headers = data[0].map(function (h) { return String(h || '').trim(); });
  const idxRef = headers.indexOf('REFERENCIA');
  if (idxRef === -1) return false;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idxRef] || '').trim() === alvo) return true;
  }
  return false;
}

function registrarLogWebhookAsaas_(status, payload) {
  const sh = garantirAbaWebhookLogsAsaas_();
  if (!sh) return;

  const event = payload && payload.event ? String(payload.event) : '';
  const paymentId = payload && payload.payment && payload.payment.id ? String(payload.payment.id) : '';
  const extRef = payload && payload.payment && payload.payment.externalReference
    ? String(payload.payment.externalReference)
    : '';

  sh.appendRow([
    Utilities.getUuid(),
    'ASAAS',
    event,
    paymentId,
    extRef,
    String(status || ''),
    new Date(),
    JSON.stringify(resumirPayloadWebhookAsaas_(payload)),
    ''
  ]);
}

function resumirPayloadWebhookAsaas_(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const payment = p.payment && typeof p.payment === 'object' ? p.payment : {};
  return {
    event: String(p.event || ''),
    paymentId: String(payment.id || ''),
    externalReference: String(payment.externalReference || ''),
    status: String(payment.status || ''),
    billingType: String(payment.billingType || ''),
    value: Number(payment.value || 0),
    netValue: Number(payment.netValue || 0),
    error: String(p.erro || p.error || '').slice(0, 300)
  };
}

function garantirAbaWebhookLogsAsaas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('WEBHOOK_LOGS_ASAAS');
  const headers = [
    'ID_LOG',
    'PROVIDER',
    'EVENTO',
    'TRANSACAO_ID',
    'EXTERNAL_REFERENCE',
    'STATUS',
    'DATA_HORA',
    'PAYLOAD_JSON',
    'OBS'
  ];
  if (!sh) {
    sh = ss.insertSheet('WEBHOOK_LOGS_ASAAS');
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sh;
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

function extrairIdEventoDeExternalReferenceAsaas_(externalReference) {
  const raw = String(externalReference || '').trim();
  if (!raw) return '';
  return raw.split('|')[0].trim();
}

function executarComoSistemaWebhookAsaas_(fn) {
  const prev = globalThis.REQUEST_EMAIL || '';
  try {
    globalThis.REQUEST_EMAIL = resolverEmailSistemaWebhookAsaas_();
    return fn();
  } finally {
    if (prev) globalThis.REQUEST_EMAIL = prev;
    else {
      try { delete globalThis.REQUEST_EMAIL; } catch (_) { globalThis.REQUEST_EMAIL = ''; }
    }
  }
}

function resolverEmailSistemaWebhookAsaas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('USUARIOS');
  if (!sh) throw new Error('USUARIOS_SHEET_NOT_FOUND');
  const data = sh.getDataRange().getValues();
  if (!data || data.length < 2) throw new Error('USUARIOS_VAZIO');

  const headers = data[0].map(function (h) {
    return String(h || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
  });
  const iEmail = headers.indexOf('EMAIL');
  const iPerfil = headers.indexOf('PERFIL');
  const iStatus = headers.indexOf('STATUS');
  if (iEmail === -1 || iPerfil === -1 || iStatus === -1) {
    throw new Error('COLUNAS_USUARIOS_INVALIDAS');
  }

  for (var i = 1; i < data.length; i++) {
    const email = String(data[i][iEmail] || '').trim().toLowerCase();
    const status = String(data[i][iStatus] || '').trim().toLowerCase();
    const perfil = String(data[i][iPerfil] || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
    if (!email || status !== 'ativo') continue;
    if (perfil === 'proprietario') return email;
  }

  for (var j = 1; j < data.length; j++) {
    const email2 = String(data[j][iEmail] || '').trim().toLowerCase();
    const status2 = String(data[j][iStatus] || '').trim().toLowerCase();
    if (email2 && status2 === 'ativo') return email2;
  }

  throw new Error('USUARIO_SISTEMA_NAO_ENCONTRADO');
}

function respostaWebhookAsaas_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function atualizarCobrancaPixAsaasComFallback_(payment, payload, statusInterno) {
  // Se o modulo de integracao completo estiver carregado, reutiliza.
  try {
    if (typeof atualizarCobrancaPixAsaasWebhook_ === 'function') {
      return atualizarCobrancaPixAsaasWebhook_(payment, payload, statusInterno);
    }
  } catch (_) {}

  // Fallback local para manter webhook operacional.
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('COBRANCAS_PIX');
    if (!sh) {
      sh = ss.insertSheet('COBRANCAS_PIX');
      sh.getRange(1, 1, 1, 18).setValues([[
        'ID', 'PROVIDER', 'ID_EVENTO', 'EXTERNAL_REFERENCE', 'PAYMENT_ID', 'TXID',
        'VALOR_COBRANCA', 'VALOR_RECEBIDO', 'STATUS', 'VENCIMENTO', 'LINK_FATURA',
        'PIX_PAYLOAD', 'PIX_COPIA_COLA', 'RAW_PAYLOAD', 'CRIADO_EM', 'ATUALIZADO_EM', 'CRIADO_POR', 'OBS'
      ]]);
    }

    const data = sh.getDataRange().getValues();
    const headers = data[0].map(function (h) { return String(h || '').trim(); });
    const idx = function (n) { return headers.indexOf(n); };
    const paymentId = String((payment && payment.id) || '').trim();
    const ext = String((payment && payment.externalReference) || '').trim();
    const idEvento = extrairIdEventoDeExternalReferenceAsaas_(ext);
    const valor = Number((payment && payment.value) || 0);
    const dueDate = String((payment && payment.dueDate) || '').trim();
    const invoiceUrl = String((payment && payment.invoiceUrl) || '').trim();
    const status = String((payment && payment.status) || statusInterno || '').toUpperCase();

    var row = -1;
    const idxPay = idx('PAYMENT_ID');
    const idxExt = idx('EXTERNAL_REFERENCE');
    const idxEvt = idx('ID_EVENTO');
    for (var i = data.length - 1; i >= 1; i--) {
      if (idxPay !== -1 && paymentId && String(data[i][idxPay] || '').trim() === paymentId) { row = i + 1; break; }
      if (idxExt !== -1 && ext && String(data[i][idxExt] || '').trim() === ext) { row = i + 1; break; }
      if (idxEvt !== -1 && idEvento && String(data[i][idxEvt] || '').trim() === idEvento) { row = i + 1; }
    }

    if (row === -1) {
      sh.appendRow([
        Utilities.getUuid(), 'ASAAS', idEvento, ext, paymentId, paymentId,
        valor, (status === 'RECEIVED' || status === 'CONFIRMED') ? valor : '',
        status, dueDate, invoiceUrl, '', '', JSON.stringify(payload || {}),
        new Date(), new Date(), 'WEBHOOK_ASAAS', ''
      ]);
      return;
    }

    if (idx('PROVIDER') !== -1) sh.getRange(row, idx('PROVIDER') + 1).setValue('ASAAS');
    if (idxEvt !== -1 && idEvento) sh.getRange(row, idxEvt + 1).setValue(idEvento);
    if (idxExt !== -1 && ext) sh.getRange(row, idxExt + 1).setValue(ext);
    if (idxPay !== -1 && paymentId) sh.getRange(row, idxPay + 1).setValue(paymentId);
    if (idx('TXID') !== -1 && paymentId) sh.getRange(row, idx('TXID') + 1).setValue(paymentId);
    if (idx('VALOR_COBRANCA') !== -1) sh.getRange(row, idx('VALOR_COBRANCA') + 1).setValue(valor);
    if (idx('VALOR_RECEBIDO') !== -1 && (status === 'RECEIVED' || status === 'CONFIRMED')) {
      sh.getRange(row, idx('VALOR_RECEBIDO') + 1).setValue(valor);
    }
    if (idx('STATUS') !== -1) sh.getRange(row, idx('STATUS') + 1).setValue(status);
    if (idx('VENCIMENTO') !== -1 && dueDate) sh.getRange(row, idx('VENCIMENTO') + 1).setValue(dueDate);
    if (idx('LINK_FATURA') !== -1 && invoiceUrl) sh.getRange(row, idx('LINK_FATURA') + 1).setValue(invoiceUrl);
    if (idx('RAW_PAYLOAD') !== -1) sh.getRange(row, idx('RAW_PAYLOAD') + 1).setValue(JSON.stringify(payload || {}));
    if (idx('ATUALIZADO_EM') !== -1) sh.getRange(row, idx('ATUALIZADO_EM') + 1).setValue(new Date());
  } catch (_) {}
}
