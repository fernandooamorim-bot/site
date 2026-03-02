/**
 * ======================================================
 * ASAAS WEBHOOK MODULE — SUPER AGENDA
 * ======================================================
 * ✔ Validação por Token Header
 * ✔ Idempotência por payment.id
 * ✔ Integração com apiRegistrarRecebimento
 * ✔ Atualização automática do status do evento
 * ✔ Logs em WEBHOOK_LOGS_PIX
 * ======================================================
 */

function processarWebhookAsaas(e) {
  try {

    if (obterConfigSeguro('ASAAS_ATIVO') !== 'TRUE') {
      return respostaWebhook({ ok: true });
    }

    const rawBody = e.postData.contents;
    const payload = JSON.parse(rawBody);
    const headers = e.headers || {};

    const tokenRecebido =
      headers['asaas-access-token'] ||
      headers['Asaas-Access-Token'] ||
      '';

    const TOKEN_ESPERADO = obterConfigSeguro('ASAAS_WEBHOOK_TOKEN');

    if (!tokenRecebido || tokenRecebido !== TOKEN_ESPERADO) {
      registrarLogWebhookAsaas('TOKEN_INVALIDO', payload);
      return respostaWebhook({ error: 'TOKEN_INVALIDO' });
    }

    const evento = payload.event;
    const payment = payload.payment;

    if (!evento || !payment) {
      return respostaWebhook({ ok: true });
    }

    const transactionId = payment.id;
    const correlationID = payment.externalReference || '';
    const valor = Number(payment.value || 0);

    if (isTransactionProcessed(transactionId)) {
      return respostaWebhook({ ok: true });
    }

  if (evento === 'PAYMENT_RECEIVED' || evento === 'PAYMENT_CONFIRMED') {

      registrarRecebimentoAutomatico({
        idEvento: correlationID,
        valor: valor,
        referencia: transactionId,
        rawPayload: payload
      });

      registrarLogWebhookAsaas('RECEBIDO_OK', payload);
    }

    if (evento === 'PAYMENT_REFUNDED') {

      apiEstornarRecebimento({
        referencia: transactionId
      });

      registrarLogWebhookAsaas('ESTORNO_OK', payload);
    }

    if (evento === 'PAYMENT_DELETED') {

      registrarLogWebhookAsaas('COBRANCA_DELETADA', payload);
    }

    return respostaWebhook({ ok: true });

  } catch (err) {

    registrarLogWebhookAsaas('ERRO_PROCESSAMENTO', { erro: String(err) });
    return respostaWebhook({ ok: true });
  }
}

function registrarLogWebhookAsaas(status, payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('WEBHOOK_LOGS_ASAAS');
  if (!sheet) return;

  sheet.appendRow([
    Utilities.getUuid(),
    'ASAAS',
    payload.event || '',
    payload?.payment?.id || '',
    payload?.payment?.externalReference || '',
    status,
    new Date(),
    JSON.stringify(payload),
    ''
  ]);
}