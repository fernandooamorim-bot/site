

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

    const signatureHeader =
      e.parameter['x-openpix-signature'] ||
      e.parameter['X-OpenPix-Signature'] ||
      '';

    const secret = obterConfigSeguro('WOOVI_WEBHOOK_SECRET_TEST');

    if (!validarAssinaturaWoovi(rawBody, signatureHeader, secret)) {
      registrarLogWebhook('INVALID_SIGNATURE', payload);
      return respostaWebhook({ error: 'INVALID_SIGNATURE' }, 401);
    }

    if (payload.event !== 'OPENPIX:TRANSACTION_RECEIVED') {
      return respostaWebhook({ ok: true });
    }

    const transaction = payload.data.transaction;
    const transactionId = transaction.id;
    const correlationID = transaction.correlationID;
    const valor = transaction.value / 100;

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

function validarAssinaturaWoovi(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;

  const calculated = Utilities.base64Encode(
    Utilities.computeHmacSha256Signature(rawBody, secret)
  );

  return calculated === signatureHeader;
}

function registrarRecebimentoAutomatico({ idEvento, valor, referencia, rawPayload }) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    apiRegistrarRecebimento({
      idEvento: idEvento,
      valor: valor,
      referencia: referencia,
      origem: 'PIX_WOOVI_AUTOMATICO'
    });

    atualizarStatusPagamentoEvento(idEvento);

    atualizarCobrancaPix(idEvento, referencia, valor, rawPayload);

  } finally {
    lock.releaseLock();
  }
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
    payload?.data?.transaction?.id || '',
    payload?.data?.transaction?.correlationID || '',
    status,
    new Date(),
    JSON.stringify(payload),
    ''
  ]);
}

function respostaWebhook(obj, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function obterConfigSeguro(chave) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('CONFIG');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === chave) return data[i][1];
  }

  return '';
}