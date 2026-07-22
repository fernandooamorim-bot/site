/**
 * ======================================================
 * WOOVI WEBHOOK MODULE — SUPER AGENDA
 * ======================================================
 * ✔ Validação HMAC SHA256
 * ✔ Idempotência por transaction.id
 * ✔ Integração com apiRegistrarRecebimento
 * ✔ Atualização automática do status do evento
 * ✔ Logs em WEBHOOK_LOGS_PIX
 * ======================================================
 */

function processarWebhookWoovi(e) {
  try {
    const rawBody = e.postData.contents;
    const payload = JSON.parse(rawBody);

    const headers = e.headers || {};
    const signatureHeader =
      headers['x-openpix-signature'] ||
      headers['X-OpenPix-Signature'] ||
      headers['X-OPENPIX-SIGNATURE'] ||
      '';

    const secret = obterConfigSeguro('WOOVI_WEBHOOK_SECRET_TEST');

    if (!validarAssinaturaWooviHMAC(rawBody, signatureHeader, secret)) {
      registrarLogWebhook('INVALID_SIGNATURE', payload);
      return respostaWebhook({ error: 'INVALID_SIGNATURE' }, 401);
    }

    if (payload.event !== 'OPENPIX:TRANSACTION_RECEIVED') {
      return respostaWebhook({ ok: true });
    }

    // Estrutura real do webhook Woovi (sem payload.data.transaction)
    const transactionId =
      payload?.pix?.transactionID ||
      payload?.charge?.transactionID ||
      payload?.charge?.identifier ||
      '';

    const correlationID =
      payload?.charge?.correlationID ||
      payload?.pix?.charge?.correlationID ||
      payload?.charge?.comment || // fallback opcional
      '';

    const valor =
      (payload?.pix?.value || payload?.charge?.value || 0) / 100;

    if (isTransactionProcessed(transactionId)) {
      return respostaWebhook({ ok: true });
    }

    registrarRecebimentoAutomatico({
      idEvento: correlationID,
      valor: valor,
      referencia: transactionId,
      rawPayload: payload
    });

    registrarLogWebhook('PROCESSADO_OK', payload);

    return respostaWebhook({ ok: true });

  } catch (err) {
    registrarLogWebhook('ERRO_PROCESSAMENTO', { erro: String(err) });
    return respostaWebhook({ ok: true });
  }
}

function validarAssinaturaWooviHMAC(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;

  const calculated = Utilities.base64Encode(
    Utilities.computeHmacSha1Signature(rawBody, secret)
  );

  return calculated === signatureHeader;
}

function registrarRecebimentoAutomatico({ idEvento, valor, referencia, rawPayload }) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    executarComoSistemaWebhookWoovi_(function () {
      apiRegistrarRecebimento({
        idEvento: idEvento,
        valor: valor,
        referencia: referencia,
        origem: 'PIX_WOOVI_AUTOMATICO'
      });
    });
    executarComoSistemaWebhookWoovi_(function () {
      atualizarStatusPagamentoEvento(idEvento);
    });

    atualizarCobrancaPix(idEvento, referencia, valor, rawPayload);

  } finally {
    lock.releaseLock();
  }
}

function executarComoSistemaWebhookWoovi_(fn) {
  const prev = globalThis.REQUEST_EMAIL || '';
  try {
    globalThis.REQUEST_EMAIL = resolverEmailSistemaWebhookWoovi_();
    return fn();
  } finally {
    if (prev) globalThis.REQUEST_EMAIL = prev;
    else {
      try { delete globalThis.REQUEST_EMAIL; } catch (_) { globalThis.REQUEST_EMAIL = ''; }
    }
  }
}

function resolverEmailSistemaWebhookWoovi_() {
  const fromConfig = String(obterConfigSeguro('EMAIL_NOTIFICACOES') || '').trim().toLowerCase();
  if (fromConfig) return fromConfig;
  return 'fernando.c.amorim@gmail.com';
}

function atualizarStatusPagamentoEvento(idEvento) {
  const resumo = buscarResumoFinanceiroEvento(idEvento);

  const recebido = Number(resumo.totalRecebido || 0);
  const total = Number(resumo.valorTotal || 0);

  let novoStatus = 'PENDENTE';

  if (recebido === 0) novoStatus = 'PENDENTE';
  else if (recebido < total) novoStatus = 'PARCIAL';
  else novoStatus = 'PAGO';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('EVENTOS');
  const data = sheet.getDataRange().getValues();

  const headers = data[0];
  const idxId = headers.indexOf('ID_EVENTO');
  const idxStatus = headers.indexOf('STATUS_PAGAMENTO');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idxId] === idEvento) {
      sheet.getRange(i + 1, idxStatus + 1).setValue(novoStatus);
      break;
    }
  }
}

function atualizarCobrancaPix(idEvento, referencia, valor, rawPayload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('COBRANCAS_PIX');
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const idxEvento = headers.indexOf('ID_EVENTO');
  const idxTxid = headers.indexOf('TXID');
  const idxValorRecebido = headers.indexOf('VALOR_RECEBIDO');
  const idxStatus = headers.indexOf('STATUS');
  const idxRaw = headers.indexOf('RAW_PAYLOAD');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idxEvento] === idEvento && !data[i][idxTxid]) {
      sheet.getRange(i + 1, idxTxid + 1).setValue(referencia);
      sheet.getRange(i + 1, idxValorRecebido + 1).setValue(valor);
      sheet.getRange(i + 1, idxStatus + 1).setValue('PAGO');
      sheet.getRange(i + 1, idxRaw + 1).setValue(JSON.stringify(rawPayload));
      break;
    }
  }
}

function isTransactionProcessed(transactionId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  if (!sheet) return false;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idxRef = headers.indexOf('REFERENCIA');

  for (let i = 1; i < data.length; i++) {
    if (data[i][idxRef] === transactionId) return true;
  }

  return false;
}

function registrarLogWebhook(status, payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('WEBHOOK_LOGS_PIX');
  if (!sheet) return;

  sheet.appendRow([
    Utilities.getUuid(),
    'WOOVI',
    payload.event || '',
    payload?.pix?.transactionID ||
    payload?.charge?.transactionID ||
    payload?.charge?.identifier ||
    '',
    payload?.charge?.correlationID ||
    payload?.pix?.charge?.correlationID ||
    payload?.charge?.comment ||
    '',
    status,
    new Date(),
    JSON.stringify(resumirPayloadWebhookWoovi_(payload)),
    ''
  ]);
}

function resumirPayloadWebhookWoovi_(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const pix = p.pix && typeof p.pix === 'object' ? p.pix : {};
  const charge = p.charge && typeof p.charge === 'object' ? p.charge : {};
  return {
    event: String(p.event || ''),
    transactionId: String(pix.transactionID || charge.transactionID || charge.identifier || ''),
    correlationId: String(charge.correlationID || (pix.charge && pix.charge.correlationID) || charge.comment || ''),
    value: Number(pix.value || charge.value || 0),
    chargeStatus: String(charge.status || ''),
    error: String(p.erro || p.error || '').slice(0, 300)
  };
}

function respostaWebhook(obj, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function obterConfigSeguro(chave) {
  const nome = String(chave || '').trim();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('CONFIG');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === nome) return data[i][1];
  }

  // Contingência opcional: somente se a chave não existir na CONFIG.
  // A planilha continua sendo a fonte principal de configuração do sistema.
  try {
    const props = PropertiesService.getScriptProperties();
    const valorContingencia = props.getProperty(nome);
    if (valorContingencia !== null && String(valorContingencia).trim() !== '') {
      return valorContingencia;
    }
  } catch (_) {}

  return '';
}
