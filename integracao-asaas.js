/**
 * ======================================================
 * INTEGRACAO ASAAS — COBRANCAS PIX (FASE 1)
 * ======================================================
 * Escopo:
 * - Criar cobranca PIX por evento
 * - Consultar cobranca PIX
 * - Cancelar cobranca PIX
 * - Persistir vinculo na aba COBRANCAS_PIX
 * ======================================================
 */

function pixAsaasCriarCobranca(params, emailAutenticado) {
  if (!asaasIntegracaoAtiva_()) {
    throw new Error('ASAAS_PROVIDER_INATIVO');
  }

  const idEvento = String(params.idEvento || '').trim();
  if (!idEvento) throw new Error('ID_EVENTO_OBRIGATORIO');

  const evento = buscarEvento(idEvento);
  if (!evento) throw new Error('EVENTO_NAO_ENCONTRADO');
  const idContratanteEvento = String(evento.idContratante || '').trim();
  if (!idContratanteEvento) throw new Error('EVENTO_SEM_VINCULO_CONTRATANTE');

  const contratante = buscarContratante(idContratanteEvento);
  const contratanteDoc = buscarDocumentoContratanteAsaas_(idContratanteEvento);
  const cpfCnpjParam = String(params.cpfCnpj || params.cpf || params.cnpj || '').trim();
  const cpfCnpj = normalizarCpfCnpjAsaas_(cpfCnpjParam || contratanteDoc);
  const whatsappParam = String(params.whatsapp || '').trim();
  const emailParam = String(params.email || '').trim();
  const whatsappContato = String(whatsappParam || (contratante && contratante.whatsapp) || '').trim();
  const emailContato = String(emailParam || (contratante && contratante.email) || '').trim();
  const nomeCliente = String((contratante && contratante.nome) || evento.nomeContratante || '').trim();
  if (!nomeCliente) throw new Error('CLIENTE_NOME_OBRIGATORIO');

  const valorPadrao = Number(evento.valorPendente || 0) > 0
    ? Number(evento.valorPendente || 0)
    : Number(evento.valorTotal || 0);
  const valor = Number(params.valor || valorPadrao || 0);
  if (!(valor > 0)) throw new Error('VALOR_COBRANCA_INVALIDO');

  const dueDate = normalizarDataVencimentoAsaas_(params.vencimento);
  const descricao = String(params.descricao || '').trim() || montarDescricaoPadraoAsaas_(idEvento, evento);

  const customerId = asaasObterOuCriarCliente_({
    idContratante: idContratanteEvento,
    nome: nomeCliente,
    email: emailContato,
    whatsapp: whatsappContato,
    cpfCnpj: cpfCnpj
  });

  const externalReference = montarExternalReferenceAsaas_({
    idEvento: idEvento,
    parcelaAtual: params.parcelaAtual,
    parcelaTotal: params.parcelaTotal
  });

  const payloadCobranca = {
    customer: customerId,
    billingType: 'PIX',
    value: arredondar2_(valor),
    dueDate: dueDate,
    description: descricao,
    externalReference: externalReference
  };

  const resp = asaasApiRequest_({
    method: 'post',
    path: '/payments',
    payload: payloadCobranca
  });

  if (!resp || !resp.id) {
    throw new Error('ASAAS_COBRANCA_NAO_CRIADA');
  }

  // Tenta obter payload Pix (QRCode/copia e cola) sem interromper o fluxo principal.
  let pixPayload = null;
  let copiaCola = '';
  try {
    const pixResp = asaasApiRequest_({
      method: 'get',
      path: '/payments/' + encodeURIComponent(resp.id) + '/pixQrCode'
    });
    pixPayload = pixResp || null;
    copiaCola = String((pixResp && (pixResp.payload || pixResp.copyAndPaste || pixResp.encodedImage))) || '';
  } catch (_) {}

  registrarCobrancaPixAsaas_({
    provider: 'ASAAS',
    idEvento: idEvento,
    externalReference: externalReference,
    paymentId: String(resp.id || ''),
    valorCobranca: arredondar2_(valor),
    vencimento: dueDate,
    status: normalizarStatusAsaas_(resp.status || 'PENDING'),
    linkFatura: String(resp.invoiceUrl || ''),
    pixPayload: pixPayload,
    pixCopiaCola: copiaCola,
    rawPayload: resp,
    criadoPor: String(emailAutenticado || '')
  });

  return {
    sucesso: true,
    provider: 'ASAAS',
    idEvento: idEvento,
    paymentId: resp.id,
    externalReference: externalReference,
    status: normalizarStatusAsaas_(resp.status || 'PENDING'),
    valor: arredondar2_(valor),
    vencimento: dueDate,
    invoiceUrl: String(resp.invoiceUrl || ''),
    pix: pixPayload
  };
}

function pixAsaasCriarPlanoParcelado(params, emailAutenticado) {
  if (!asaasIntegracaoAtiva_()) {
    throw new Error('ASAAS_PROVIDER_INATIVO');
  }

  const idEvento = String(params.idEvento || '').trim();
  if (!idEvento) throw new Error('ID_EVENTO_OBRIGATORIO');

  const evento = buscarEvento(idEvento);
  if (!evento) throw new Error('EVENTO_NAO_ENCONTRADO');
  const idContratanteEvento = String(evento.idContratante || '').trim();
  if (!idContratanteEvento) throw new Error('EVENTO_SEM_VINCULO_CONTRATANTE');

  const contratante = buscarContratante(idContratanteEvento);
  const contratanteDoc = buscarDocumentoContratanteAsaas_(idContratanteEvento);
  const cpfCnpjParam = String(params.cpfCnpj || params.cpf || params.cnpj || '').trim();
  const cpfCnpj = normalizarCpfCnpjAsaas_(cpfCnpjParam || contratanteDoc);
  const whatsappParam = String(params.whatsapp || '').trim();
  const emailParam = String(params.email || '').trim();
  const whatsappContato = String(whatsappParam || (contratante && contratante.whatsapp) || '').trim();
  const emailContato = String(emailParam || (contratante && contratante.email) || '').trim();
  const nomeCliente = String((contratante && contratante.nome) || evento.nomeContratante || '').trim();
  if (!nomeCliente) throw new Error('CLIENTE_NOME_OBRIGATORIO');

  const qtdParcelas = Math.min(24, Math.max(2, Number(params.qtdParcelas || 0)));
  if (!Number.isFinite(qtdParcelas) || qtdParcelas < 2) {
    throw new Error('QTD_PARCELAS_INVALIDA');
  }

  const valorParcela = Number(params.valorParcela || params.valor || 0);
  if (!(valorParcela > 0)) throw new Error('VALOR_PARCELA_INVALIDO');

  const periodicidade = normalizarPeriodicidadeAsaas_(params.periodicidade);
  const primeiroVencimento = normalizarDataVencimentoAsaas_(params.vencimento);
  const descricaoBase = String(params.descricao || '').trim() || montarDescricaoPadraoAsaas_(idEvento, evento);

  const customerId = asaasObterOuCriarCliente_({
    idContratante: idContratanteEvento,
    nome: nomeCliente,
    email: emailContato,
    whatsapp: whatsappContato,
    cpfCnpj: cpfCnpj
  });

  const cobrancas = [];
  for (var p = 1; p <= qtdParcelas; p++) {
    const vencimento = calcularVencimentoParcelaAsaas_(primeiroVencimento, p, periodicidade);
    const externalReference = montarExternalReferenceAsaas_({
      idEvento: idEvento,
      parcelaAtual: p,
      parcelaTotal: qtdParcelas
    });
    const descricao = descricaoBase + ' - Parcela ' + p + '/' + qtdParcelas;

    const payloadCobranca = {
      customer: customerId,
      billingType: 'PIX',
      value: arredondar2_(valorParcela),
      dueDate: vencimento,
      description: descricao,
      externalReference: externalReference
    };

    const resp = asaasApiRequest_({
      method: 'post',
      path: '/payments',
      payload: payloadCobranca
    });

    if (!resp || !resp.id) {
      throw new Error('ASAAS_COBRANCA_PARCELA_NAO_CRIADA: ' + p);
    }

    registrarCobrancaPixAsaas_({
      provider: 'ASAAS',
      idEvento: idEvento,
      externalReference: externalReference,
      paymentId: String(resp.id || ''),
      valorCobranca: arredondar2_(valorParcela),
      vencimento: vencimento,
      status: normalizarStatusAsaas_(resp.status || 'PENDING'),
      linkFatura: String(resp.invoiceUrl || ''),
      pixPayload: null,
      pixCopiaCola: '',
      rawPayload: resp,
      criadoPor: String(emailAutenticado || '')
    });

    cobrancas.push({
      parcela: p,
      totalParcelas: qtdParcelas,
      paymentId: String(resp.id || ''),
      status: normalizarStatusAsaas_(resp.status || 'PENDING'),
      valor: arredondar2_(valorParcela),
      vencimento: vencimento,
      invoiceUrl: String(resp.invoiceUrl || '')
    });
  }

  return {
    sucesso: true,
    provider: 'ASAAS',
    idEvento: idEvento,
    periodicidade: periodicidade,
    qtdParcelas: qtdParcelas,
    valorParcela: arredondar2_(valorParcela),
    valorTotalPlano: arredondar2_(valorParcela * qtdParcelas),
    cobrancas: cobrancas
  };
}

function pixAsaasObterContatoEvento(params) {
  if (!asaasIntegracaoAtiva_()) {
    throw new Error('ASAAS_PROVIDER_INATIVO');
  }
  const idEvento = String(params.idEvento || '').trim();
  if (!idEvento) throw new Error('ID_EVENTO_OBRIGATORIO');

  const ref = localizarContratantePorEventoAsaas_(idEvento);
  if (!ref || !ref.ok) {
    return {
      sucesso: false,
      mensagem: 'CONTRATANTE_NAO_LOCALIZADO',
      idEvento: idEvento
    };
  }

  return {
    sucesso: true,
    idEvento: idEvento,
    idContratante: ref.idContratante,
    nomeContratante: ref.nomeContratante,
    whatsapp: ref.whatsapp,
    email: ref.email,
    cpfCnpj: ref.cpfCnpj
  };
}

function pixAsaasAtualizarContatoEvento(params, emailAutenticado) {
  if (!asaasIntegracaoAtiva_()) {
    throw new Error('ASAAS_PROVIDER_INATIVO');
  }
  const idEvento = String(params.idEvento || '').trim();
  if (!idEvento) throw new Error('ID_EVENTO_OBRIGATORIO');

  const ref = localizarContratantePorEventoAsaas_(idEvento);
  if (!ref || !ref.ok) throw new Error('CONTRATANTE_NAO_LOCALIZADO');

  const novoWhatsapp = String(params.whatsapp || '').trim();
  const novoEmail = String(params.email || '').trim();
  const novoCpfCnpj = normalizarCpfCnpjAsaas_(params.cpfCnpj || params.cpf || params.cnpj || '');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('CONTRATANTES');
  if (!sh) throw new Error('ABA_CONTRATANTES_NAO_ENCONTRADA');

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const norm = headers.map(function (h) {
    return normalizarHeaderAsaas_(h);
  });

  const idxWhatsapp = encontrarIndiceHeaderAsaas_(norm, ['WHATSAPP', 'CELULAR', 'TELEFONE']);
  const idxEmail = encontrarIndiceHeaderAsaas_(norm, ['EMAIL', 'E_MAIL', 'E-MAIL']);
  const idxObs = encontrarIndiceHeaderAsaas_(norm, ['OBSERVACOES', 'OBS']);

  const row = Number(ref.row || 0);
  if (!(row > 1)) throw new Error('LINHA_CONTRATANTE_INVALIDA');

  if (idxWhatsapp !== -1 && novoWhatsapp) {
    sh.getRange(row, idxWhatsapp + 1).setValue(novoWhatsapp);
  }
  if (idxEmail !== -1 && novoEmail) {
    sh.getRange(row, idxEmail + 1).setValue(novoEmail);
  }
  if (novoCpfCnpj && idxObs !== -1) {
    sh.getRange(row, idxObs + 1).setValue(novoCpfCnpj);
  }

  return {
    sucesso: true,
    idEvento: idEvento,
    idContratante: ref.idContratante,
    nomeContratante: ref.nomeContratante,
    whatsapp: novoWhatsapp || ref.whatsapp || '',
    email: novoEmail || ref.email || '',
    cpfCnpj: novoCpfCnpj || ref.cpfCnpj || '',
    atualizadoPor: String(emailAutenticado || '')
  };
}

function pixAsaasConsultarCobranca(params) {
  if (!asaasIntegracaoAtiva_()) {
    throw new Error('ASAAS_PROVIDER_INATIVO');
  }
  const paymentId = String(params.paymentId || '').trim();
  if (!paymentId) throw new Error('PAYMENT_ID_OBRIGATORIO');

  const resp = asaasApiRequest_({
    method: 'get',
    path: '/payments/' + encodeURIComponent(paymentId)
  });

  return {
    sucesso: true,
    provider: 'ASAAS',
    payment: resp || null
  };
}

function pixAsaasCancelarCobranca(params, emailAutenticado) {
  if (!asaasIntegracaoAtiva_()) {
    throw new Error('ASAAS_PROVIDER_INATIVO');
  }
  const paymentId = String(params.paymentId || '').trim();
  if (!paymentId) throw new Error('PAYMENT_ID_OBRIGATORIO');

  const resp = asaasApiRequest_({
    method: 'delete',
    path: '/payments/' + encodeURIComponent(paymentId)
  });

  atualizarStatusCobrancaPixAsaas_(paymentId, 'DELETED', resp || null, String(emailAutenticado || ''));

  return {
    sucesso: true,
    provider: 'ASAAS',
    paymentId: paymentId,
    status: 'DELETED'
  };
}

function pixAsaasListarCobrancasEvento(params) {
  if (!asaasIntegracaoAtiva_()) {
    throw new Error('ASAAS_PROVIDER_INATIVO');
  }
  const idEvento = String(params.idEvento || '').trim();
  if (!idEvento) throw new Error('ID_EVENTO_OBRIGATORIO');

  const sh = garantirAbaCobrancasPix_();
  const data = sh.getDataRange().getValues();
  if (!data || data.length < 2) {
    return { sucesso: true, provider: 'ASAAS', cobrancas: [] };
  }

  const headers = data[0].map(function (h) { return String(h || '').trim(); });
  const idx = function (nome) { return headers.indexOf(nome); };
  const iProvider = idx('PROVIDER');
  const iIdEvento = idx('ID_EVENTO');
  const iPaymentId = idx('PAYMENT_ID');
  const iTxid = idx('TXID');
  const iStatus = idx('STATUS');
  const iValorCobranca = idx('VALOR_COBRANCA');
  const iValorRecebido = idx('VALOR_RECEBIDO');
  const iVencimento = idx('VENCIMENTO');
  const iLink = idx('LINK_FATURA');
  const iCriadoEm = idx('CRIADO_EM');
  const iAtualizadoEm = idx('ATUALIZADO_EM');
  const iUltimoSync = idx('ULTIMO_SYNC_EM');
  const iConciliacao = idx('CONCILIACAO_STATUS');
  const iDivergencia = idx('DIVERGENCIA');

  const out = [];
  for (var i = 1; i < data.length; i++) {
    const provider = iProvider === -1 ? '' : String(data[i][iProvider] || '').trim().toUpperCase();
    if (provider && provider !== 'ASAAS') continue;
    if (iIdEvento !== -1 && String(data[i][iIdEvento] || '').trim() !== idEvento) continue;

    out.push({
      paymentId: iPaymentId !== -1 ? String(data[i][iPaymentId] || '').trim() : '',
      txid: iTxid !== -1 ? String(data[i][iTxid] || '').trim() : '',
      status: iStatus !== -1 ? String(data[i][iStatus] || '').trim() : '',
      valorCobranca: iValorCobranca !== -1 ? Number(data[i][iValorCobranca] || 0) : 0,
      valorRecebido: iValorRecebido !== -1 ? Number(data[i][iValorRecebido] || 0) : 0,
      vencimento: iVencimento !== -1 ? String(data[i][iVencimento] || '').trim() : '',
      invoiceUrl: iLink !== -1 ? String(data[i][iLink] || '').trim() : '',
      criadoEm: iCriadoEm !== -1 ? data[i][iCriadoEm] : '',
      atualizadoEm: iAtualizadoEm !== -1 ? data[i][iAtualizadoEm] : '',
      ultimoSyncEm: iUltimoSync !== -1 ? data[i][iUltimoSync] : '',
      conciliacaoStatus: iConciliacao !== -1 ? String(data[i][iConciliacao] || '').trim() : '',
      divergencia: iDivergencia !== -1 ? String(data[i][iDivergencia] || '').trim() : ''
    });
  }

  out.sort(function (a, b) {
    const ta = new Date(a.atualizadoEm || a.criadoEm || 0).getTime() || 0;
    const tb = new Date(b.atualizadoEm || b.criadoEm || 0).getTime() || 0;
    return tb - ta;
  });

  return {
    sucesso: true,
    provider: 'ASAAS',
    cobrancas: out
  };
}

function pixAsaasReconciliar(params, emailAutenticado) {
  if (!asaasIntegracaoAtiva_()) throw new Error('ASAAS_PROVIDER_INATIVO');
  if (!asaasReconciliacaoAtiva_()) throw new Error('ASAAS_RECON_INATIVA');
  const opts = params || {};
  const diasJanela = Math.max(1, Math.min(120, Number(opts.diasJanela || 60)));
  const onlyEvento = String(opts.idEvento || '').trim();
  const dryRun = String(opts.dryRun || '').trim().toUpperCase() === 'TRUE';

  const resultado = reconciliarCobrancasAsaasCore_({
    diasJanela: diasJanela,
    idEvento: onlyEvento,
    dryRun: dryRun,
    origem: 'MANUAL',
    executadoPor: String(emailAutenticado || '')
  });

  return Object.assign({ sucesso: true }, resultado);
}

function pixAsaasConfigurarReconciliacao(params, emailAutenticado) {
  const handler = 'executarReconciliacaoAsaasAgendada_';
  if (!asaasReconciliacaoAtiva_()) {
    const removidosInativo = asaasRemoverTriggersReconciliacao_(handler);
    return {
      sucesso: true,
      mensagem: 'Reconciliação automática desativada em CONFIG (ASAAS_RECON_ATIVO=FALSE).',
      handler: handler,
      horas: [],
      removidos: removidosInativo,
      executadoPor: String(emailAutenticado || '')
    };
  }

  const horasPadrao = ['10', '18'];
  const horasInput = String((params && params.horas) || '').trim();
  const horas = (horasInput ? horasInput.split(',') : horasPadrao)
    .map(function (h) { return String(h || '').trim(); })
    .filter(function (h) { return /^\d{1,2}$/.test(h); })
    .map(function (h) { return Math.max(0, Math.min(23, Number(h))); });
  const horasUnicas = Array.from(new Set(horas)).slice(0, 6);
  if (!horasUnicas.length) throw new Error('HORAS_RECONCILIACAO_INVALIDAS');

  const apagarAnteriores = String((params && params.apagarAnteriores) || 'TRUE').trim().toUpperCase() !== 'FALSE';
  let removidos = 0;
  if (apagarAnteriores) removidos = asaasRemoverTriggersReconciliacao_(handler);

  const criados = [];
  horasUnicas.forEach(function (hora) {
    ScriptApp.newTrigger(handler)
      .timeBased()
      .everyDays(1)
      .atHour(hora)
      .create();
    criados.push(hora);
  });

  return {
    sucesso: true,
    mensagem: 'Reconciliação automática configurada.',
    handler: handler,
    horas: criados,
    removidos: removidos,
    executadoPor: String(emailAutenticado || '')
  };
}

function executarReconciliacaoAsaasAgendada_() {
  if (!asaasIntegracaoAtiva_()) return;
  if (!asaasReconciliacaoAtiva_()) {
    asaasRemoverTriggersReconciliacao_('executarReconciliacaoAsaasAgendada_');
    return;
  }
  try {
    reconciliarCobrancasAsaasCore_({
      diasJanela: Math.max(1, Math.min(120, Number(obterConfigSeguro('ASAAS_RECON_DIAS_JANELA') || 60))),
      idEvento: '',
      dryRun: false,
      origem: 'AGENDADO',
      executadoPor: 'TRIGGER'
    });
  } catch (err) {
    Logger.log('[ASAAS_RECON_AGENDADO_ERRO] ' + String(err));
  }
}

function asaasRemoverTriggersReconciliacao_(handlerNome) {
  const handler = String(handlerNome || 'executarReconciliacaoAsaasAgendada_').trim();
  if (!handler) return 0;
  const existentes = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction && t.getHandlerFunction() === handler;
  });
  let removidos = 0;
  existentes.forEach(function (t) {
    try { ScriptApp.deleteTrigger(t); removidos++; } catch (_) {}
  });
  return removidos;
}

function asaasReconciliacaoAtiva_() {
  const valorConfig = obterConfig('ASAAS_RECON_ATIVO');
  const raw = String(
    valorConfig === null || typeof valorConfig === 'undefined' || String(valorConfig).trim() === ''
      ? 'TRUE'
      : valorConfig
  ).trim().toUpperCase();
  return !(
    raw === 'FALSE' ||
    raw === '0' ||
    raw === 'OFF' ||
    raw === 'INATIVO' ||
    raw === 'NAO' ||
    raw === 'NÃO'
  );
}

function reconciliarCobrancasAsaasCore_(opts) {
  const options = opts || {};
  const diasJanela = Number(options.diasJanela || 60);
  const idEventoFiltro = String(options.idEvento || '').trim();
  const dryRun = !!options.dryRun;
  const origem = String(options.origem || 'MANUAL');
  const executadoPor = String(options.executadoPor || '');

  const sheet = garantirAbaCobrancasPix_();
  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    return { total: 0, verificadas: 0, atualizadas: 0, baixasCriadas: 0, divergencias: 0, erros: 0 };
  }

  const head = data[0].map(function (h) { return String(h || '').trim(); });
  const idx = function (n) { return head.indexOf(n); };
  const iProvider = idx('PROVIDER');
  const iIdEvento = idx('ID_EVENTO');
  const iExt = idx('EXTERNAL_REFERENCE');
  const iPaymentId = idx('PAYMENT_ID');
  const iStatus = idx('STATUS');
  const iValorCobranca = idx('VALOR_COBRANCA');
  const iValorRecebido = idx('VALOR_RECEBIDO');
  const iVenc = idx('VENCIMENTO');
  const iAtual = idx('ATUALIZADO_EM');
  const iUltSync = idx('ULTIMO_SYNC_EM');
  const iConc = idx('CONCILIACAO_STATUS');
  const iDiv = idx('DIVERGENCIA');
  const iObs = idx('OBS');

  const janelaMs = diasJanela * 24 * 60 * 60 * 1000;
  const now = new Date();
  const nowTs = now.getTime();

  const counters = {
    total: 0,
    verificadas: 0,
    atualizadas: 0,
    baixasCriadas: 0,
    divergencias: 0,
    erros: 0
  };
  const detalhes = [];
  const pendenciasEscrita = [];
  const totalCols = Math.max(sheet.getLastColumn(), head.length || 1);
  const referenciasMovimentacoes = carregarReferenciasMovimentacoesAsaas_();

  for (var i = 1; i < data.length; i++) {
    const provider = iProvider === -1 ? '' : String(data[i][iProvider] || '').trim().toUpperCase();
    if (provider && provider !== 'ASAAS') continue;

    const idEvento = iIdEvento !== -1 ? String(data[i][iIdEvento] || '').trim() : '';
    if (idEventoFiltro && idEvento !== idEventoFiltro) continue;

    const paymentId = iPaymentId !== -1 ? String(data[i][iPaymentId] || '').trim() : '';
    if (!paymentId) continue;

    const statusLocal = iStatus !== -1 ? String(data[i][iStatus] || '').trim().toUpperCase() : '';
    const vencLocal = iVenc !== -1 ? String(data[i][iVenc] || '').trim() : '';
    const atualLocal = iAtual !== -1 ? data[i][iAtual] : '';
    const baseData = parseDataSeguraAsaas_(atualLocal) || parseDataSeguraAsaas_(vencLocal);
    if (baseData && (nowTs - baseData.getTime()) > janelaMs && statusLocal === 'RECEIVED') {
      // recebido antigo fora da janela pode ser ignorado
      continue;
    }

    counters.total++;
    counters.verificadas++;

    try {
      const rem = asaasApiRequest_({
        method: 'get',
        path: '/payments/' + encodeURIComponent(paymentId)
      });
      const statusRemoto = normalizarStatusAsaas_(rem && rem.status ? rem.status : '');
      const valorRemoto = Number((rem && rem.value) || 0);
      const extRef = String((rem && rem.externalReference) || (iExt !== -1 ? data[i][iExt] : '') || '').trim();
      const idEventoRef = (extRef ? String(extRef).split('|')[0] : idEvento).trim();
      const recebidoLocal = iValorRecebido !== -1 ? Number(data[i][iValorRecebido] || 0) : 0;
      const movExiste = paymentId ? referenciasMovimentacoes[paymentId] === true : false;

      let conciliacaoStatus = 'OK';
      let divergencia = '';

      const statusEhPago = (statusRemoto === 'RECEIVED' || statusRemoto === 'CONFIRMED');
      if (statusEhPago && !movExiste) {
        if (!dryRun) {
          registrarRecebimentoAsaasViaSistema_({
            idEvento: idEventoRef,
            valor: valorRemoto > 0 ? valorRemoto : Number(data[i][iValorCobranca] || 0),
            referencia: paymentId
          });
          referenciasMovimentacoes[paymentId] = true;
        }
        counters.baixasCriadas++;
        conciliacaoStatus = dryRun ? 'SIMULADO_BAIXA_PENDENTE' : 'BAIXA_RECONCILIADA';
      } else if (!statusEhPago && movExiste) {
        conciliacaoStatus = 'DIVERGENTE';
        divergencia = 'BAIXA_LOCAL_SEM_PAGAMENTO_ASAAS';
        counters.divergencias++;
      } else if (statusEhPago && movExiste && recebidoLocal <= 0) {
        conciliacaoStatus = 'DIVERGENTE';
        divergencia = 'COBRANCA_SEM_VALOR_RECEBIDO_LOCAL';
        counters.divergencias++;
      }

      if (!dryRun) {
        var rowWrite = data[i].slice();
        var houveMudanca = false;
        if (iStatus !== -1 && statusLocal !== statusRemoto) {
          rowWrite[iStatus] = statusRemoto;
          houveMudanca = true;
          counters.atualizadas++;
        }
        if (iValorCobranca !== -1 && valorRemoto > 0) {
          rowWrite[iValorCobranca] = valorRemoto;
          houveMudanca = true;
        }
        if (iValorRecebido !== -1 && statusEhPago) {
          rowWrite[iValorRecebido] = valorRemoto > 0 ? valorRemoto : recebidoLocal;
          houveMudanca = true;
        }
        if (iExt !== -1 && extRef) {
          rowWrite[iExt] = extRef;
          houveMudanca = true;
        }
        if (iIdEvento !== -1 && idEventoRef) {
          rowWrite[iIdEvento] = idEventoRef;
          houveMudanca = true;
        }
        if (iUltSync !== -1) {
          rowWrite[iUltSync] = now;
          houveMudanca = true;
        }
        if (iConc !== -1) {
          rowWrite[iConc] = conciliacaoStatus;
          houveMudanca = true;
        }
        if (iDiv !== -1) {
          rowWrite[iDiv] = divergencia;
          houveMudanca = true;
        }
        if (iObs !== -1) {
          const obsBase = 'Recon ' + origem + ' em ' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
          rowWrite[iObs] = obsBase + (executadoPor ? ' por ' + executadoPor : '');
          houveMudanca = true;
        }
        if (houveMudanca) {
          pendenciasEscrita.push({
            rowNumber: i + 1,
            values: normalizarLinhaEscritaAsaas_(rowWrite, totalCols)
          });
        }
      }

      detalhes.push({
        paymentId: paymentId,
        idEvento: idEventoRef,
        statusLocal: statusLocal,
        statusRemoto: statusRemoto,
        conciliacao: conciliacaoStatus,
        divergencia: divergencia
      });
    } catch (err) {
      counters.erros++;
      if (!dryRun) {
        var rowErro = data[i].slice();
        var mudouErro = false;
        if (iUltSync !== -1) {
          rowErro[iUltSync] = now;
          mudouErro = true;
        }
        if (iConc !== -1) {
          rowErro[iConc] = 'ERRO';
          mudouErro = true;
        }
        if (iDiv !== -1) {
          rowErro[iDiv] = 'ERRO_CONSULTA_ASAAS';
          mudouErro = true;
        }
        if (iObs !== -1) {
          rowErro[iObs] = 'Erro reconciliação: ' + String(err);
          mudouErro = true;
        }
        if (mudouErro) {
          pendenciasEscrita.push({
            rowNumber: i + 1,
            values: normalizarLinhaEscritaAsaas_(rowErro, totalCols)
          });
        }
      }
      detalhes.push({
        paymentId: paymentId,
        idEvento: idEvento,
        erro: String(err)
      });
    }
  }

  if (!dryRun && pendenciasEscrita.length) {
    aplicarPendenciasEscritaAsaas_(sheet, pendenciasEscrita, totalCols);
  }

  return {
    origem: origem,
    dryRun: dryRun,
    diasJanela: diasJanela,
    total: counters.total,
    verificadas: counters.verificadas,
    atualizadas: counters.atualizadas,
    baixasCriadas: counters.baixasCriadas,
    divergencias: counters.divergencias,
    erros: counters.erros,
    detalhes: detalhes.slice(0, 100)
  };
}

function carregarReferenciasMovimentacoesAsaas_() {
  const refs = {};
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
    if (!sh) return refs;
    const data = sh.getDataRange().getValues();
    if (!data || data.length < 2) return refs;
    const headers = data[0].map(function (h) { return String(h || '').trim(); });
    const iRef = headers.indexOf('REFERENCIA');
    if (iRef === -1) return refs;
    for (var i = 1; i < data.length; i++) {
      const ref = String(data[i][iRef] || '').trim();
      if (ref) refs[ref] = true;
    }
  } catch (_) {}
  return refs;
}

function normalizarLinhaEscritaAsaas_(row, totalCols) {
  const out = Array.isArray(row) ? row.slice(0, totalCols) : [];
  while (out.length < totalCols) out.push('');
  return out;
}

function aplicarPendenciasEscritaAsaas_(sheet, pendencias, totalCols) {
  if (!sheet || !Array.isArray(pendencias) || !pendencias.length) return;
  pendencias.sort(function (a, b) { return a.rowNumber - b.rowNumber; });

  let ini = 0;
  while (ini < pendencias.length) {
    let fim = ini;
    while (
      fim + 1 < pendencias.length &&
      pendencias[fim + 1].rowNumber === pendencias[fim].rowNumber + 1
    ) {
      fim++;
    }

    const startRow = pendencias[ini].rowNumber;
    const bloco = [];
    for (let i = ini; i <= fim; i++) {
      bloco.push(normalizarLinhaEscritaAsaas_(pendencias[i].values, totalCols));
    }
    sheet.getRange(startRow, 1, bloco.length, totalCols).setValues(bloco);

    ini = fim + 1;
  }
}

function registrarRecebimentoAsaasViaSistema_(dados) {
  executarComoSistemaAsaas_(function () {
    apiRegistrarRecebimento({
      idEvento: String(dados.idEvento || '').trim(),
      valor: Number(dados.valor || 0),
      referencia: String(dados.referencia || '').trim(),
      origem: 'PIX_ASAAS_RECONCILIACAO'
    });
  });
}

function executarComoSistemaAsaas_(fn) {
  const prev = globalThis.REQUEST_EMAIL || '';
  try {
    globalThis.REQUEST_EMAIL = resolverEmailSistemaAsaas_();
    return fn();
  } finally {
    if (prev) globalThis.REQUEST_EMAIL = prev;
    else {
      try { delete globalThis.REQUEST_EMAIL; } catch (_) { globalThis.REQUEST_EMAIL = ''; }
    }
  }
}

function resolverEmailSistemaAsaas_() {
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

function movimentoComReferenciaExisteAsaas_(referencia) {
  const alvo = String(referencia || '').trim();
  if (!alvo) return false;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  if (!sh) return false;
  const data = sh.getDataRange().getValues();
  if (!data || data.length < 2) return false;
  const headers = data[0].map(function (h) { return String(h || '').trim(); });
  const iRef = headers.indexOf('REFERENCIA');
  if (iRef === -1) return false;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][iRef] || '').trim() === alvo) return true;
  }
  return false;
}

function parseDataSeguraAsaas_(valor) {
  if (!valor) return null;
  if (Object.prototype.toString.call(valor) === '[object Date]' && !isNaN(valor.getTime())) return valor;
  const s = String(valor || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

function asaasObterOuCriarCliente_(cliente) {
  const extRef = String(cliente.idContratante || '').trim()
    ? 'CONTRATANTE:' + String(cliente.idContratante).trim()
    : 'CONTRATANTE:NOME:' + normalizarTextoComparacao_(String(cliente.nome || ''));
  const cpfCnpj = normalizarCpfCnpjAsaas_(cliente.cpfCnpj || '');
  if (!cpfCnpj) {
    throw new Error('CPF_CNPJ_OBRIGATORIO_ASAAS');
  }
  const email = String(cliente.email || '').trim();
  const whatsapp = normalizarTelefoneE164Br_(cliente.whatsapp || '');

  try {
    const busca = asaasApiRequest_({
      method: 'get',
      path: '/customers?externalReference=' + encodeURIComponent(extRef) + '&limit=1'
    });
    const lista = (busca && busca.data) || [];
    if (lista && lista.length && lista[0] && lista[0].id) {
      const existente = lista[0];
      const customerId = String(existente.id);
      const docExistente = normalizarCpfCnpjAsaas_(existente.cpfCnpj || '');
      const precisaAtualizarDoc = !docExistente || docExistente !== cpfCnpj;
      const precisaAtualizarContato = (!!email && String(existente.email || '').trim() !== email) ||
        (!!whatsapp && String(existente.mobilePhone || '').replace(/\D/g, '') !== whatsapp.replace(/\D/g, ''));

      if (precisaAtualizarDoc || precisaAtualizarContato) {
        const payloadUpdate = {
          name: String(cliente.nome || existente.name || '').trim() || 'Cliente',
          cpfCnpj: cpfCnpj
        };
        if (email) payloadUpdate.email = email;
        if (whatsapp) payloadUpdate.mobilePhone = whatsapp;
        asaasApiRequest_({
          method: 'post',
          path: '/customers/' + encodeURIComponent(customerId),
          payload: payloadUpdate
        });
      }

      return customerId;
    }
  } catch (_) {}

  const payload = {
    name: String(cliente.nome || '').trim(),
    externalReference: extRef,
    cpfCnpj: cpfCnpj
  };
  if (email) payload.email = email;
  if (whatsapp) payload.mobilePhone = whatsapp;

  const criado = asaasApiRequest_({
    method: 'post',
    path: '/customers',
    payload: payload
  });

  if (!criado || !criado.id) throw new Error('ASAAS_CLIENTE_NAO_CRIADO');
  return String(criado.id);
}

function asaasApiRequest_(opts) {
  const base = obterConfigSeguro('ASAAS_API_BASE');
  const apiKey = obterConfigSeguro('ASAAS_API_KEY');
  if (!base) throw new Error('ASAAS_API_BASE_NAO_CONFIGURADA');
  if (!apiKey) throw new Error('ASAAS_API_KEY_NAO_CONFIGURADA');

  const method = String((opts && opts.method) || 'get').toLowerCase();
  const path = String((opts && opts.path) || '').trim();
  const payload = (opts && opts.payload) || null;
  if (!path) throw new Error('ASAAS_PATH_INVALIDO');

  const url = String(base).replace(/\/+$/, '') + path;
  const request = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      access_token: apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
  };

  if (payload && method !== 'get' && method !== 'delete') {
    request.payload = JSON.stringify(payload);
  }

  const resp = UrlFetchApp.fetch(url, request);
  const code = Number(resp.getResponseCode() || 0);
  const txt = String(resp.getContentText() || '').trim();

  let data = {};
  if (txt) {
    try { data = JSON.parse(txt); } catch (_) { data = { raw: txt }; }
  }

  if (code < 200 || code >= 300) {
    const erroApi = data && data.errors ? JSON.stringify(data.errors) : txt;
    throw new Error('ASAAS_HTTP_' + code + ': ' + erroApi);
  }

  return data;
}

function registrarCobrancaPixAsaas_(registro) {
  const sheet = garantirAbaCobrancasPix_();
  const idx = mapearColunasPorCabecalho_(sheet);
  const now = new Date();

  const row = [];
  row[idx('ID')] = Utilities.getUuid();
  row[idx('PROVIDER')] = String(registro.provider || 'ASAAS');
  row[idx('ID_EVENTO')] = String(registro.idEvento || '');
  row[idx('EXTERNAL_REFERENCE')] = String(registro.externalReference || '');
  row[idx('PAYMENT_ID')] = String(registro.paymentId || '');
  row[idx('TXID')] = '';
  row[idx('VALOR_COBRANCA')] = Number(registro.valorCobranca || 0);
  row[idx('VALOR_RECEBIDO')] = '';
  row[idx('STATUS')] = String(registro.status || 'PENDING');
  row[idx('VENCIMENTO')] = String(registro.vencimento || '');
  row[idx('LINK_FATURA')] = String(registro.linkFatura || '');
  row[idx('PIX_PAYLOAD')] = registro.pixPayload ? JSON.stringify(registro.pixPayload) : '';
  row[idx('PIX_COPIA_COLA')] = String(registro.pixCopiaCola || '');
  row[idx('RAW_PAYLOAD')] = registro.rawPayload ? JSON.stringify(registro.rawPayload) : '';
  row[idx('CRIADO_EM')] = now;
  row[idx('ATUALIZADO_EM')] = now;
  row[idx('CRIADO_POR')] = String(registro.criadoPor || '');
  row[idx('OBS')] = '';

  sheet.appendRow(row);
}

function atualizarStatusCobrancaPixAsaas_(paymentId, statusAsaas, rawPayload, atualizadoPor) {
  const sheet = garantirAbaCobrancasPix_();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;

  const head = data[0].map(function (h) { return String(h || '').trim(); });
  const idxPayment = head.indexOf('PAYMENT_ID');
  const idxStatus = head.indexOf('STATUS');
  const idxRaw = head.indexOf('RAW_PAYLOAD');
  const idxAtualizadoEm = head.indexOf('ATUALIZADO_EM');
  const idxObs = head.indexOf('OBS');
  if (idxPayment === -1 || idxStatus === -1) return;

  const alvo = String(paymentId || '').trim();
  if (!alvo) return;

  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idxPayment] || '').trim() !== alvo) continue;
    sheet.getRange(i + 1, idxStatus + 1).setValue(normalizarStatusAsaas_(statusAsaas));
    if (idxRaw !== -1) sheet.getRange(i + 1, idxRaw + 1).setValue(rawPayload ? JSON.stringify(rawPayload) : '');
    if (idxAtualizadoEm !== -1) sheet.getRange(i + 1, idxAtualizadoEm + 1).setValue(new Date());
    if (idxObs !== -1 && atualizadoPor) sheet.getRange(i + 1, idxObs + 1).setValue('Atualizado por: ' + atualizadoPor);
    break;
  }
}

function normalizarDataVencimentoAsaas_(valor) {
  const entrada = String(valor || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(entrada)) return entrada;

  const dias = Number(obterConfigSeguro('ASAAS_DIAS_VENCIMENTO_PADRAO') || 3);
  const d = new Date();
  d.setDate(d.getDate() + (Number.isFinite(dias) ? dias : 3));
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function normalizarPeriodicidadeAsaas_(valor) {
  const p = String(valor || '').trim().toLowerCase();
  if (p === 'semanal') return 'semanal';
  if (p === 'quinzenal') return 'quinzenal';
  return 'mensal';
}

function calcularVencimentoParcelaAsaas_(primeiroVencimentoYmd, parcelaAtual, periodicidade) {
  const base = parseDataYmdAsaas_(primeiroVencimentoYmd);
  if (!base) throw new Error('VENCIMENTO_INVALIDO');
  const idx = Math.max(0, Number(parcelaAtual || 1) - 1);
  const data = new Date(base.getTime());

  if (periodicidade === 'semanal') {
    data.setDate(data.getDate() + (idx * 7));
  } else if (periodicidade === 'quinzenal') {
    data.setDate(data.getDate() + (idx * 15));
  } else {
    data.setMonth(data.getMonth() + idx);
  }

  return Utilities.formatDate(data, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function parseDataYmdAsaas_(ymd) {
  const s = String(ymd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(s + 'T00:00:00');
}

function montarDescricaoPadraoAsaas_(idEvento, evento) {
  const prefixo = String(obterConfigSeguro('ASAAS_DESCRICAO_PREFIXO') || 'Agenda FA');
  const contratante = String((evento && evento.nomeContratante) || '').trim();
  return prefixo + ' - Evento ' + idEvento + (contratante ? ' - ' + contratante : '');
}

function montarExternalReferenceAsaas_(opts) {
  const idEvento = String((opts && opts.idEvento) || '').trim();
  const pAtual = Number((opts && opts.parcelaAtual) || 0);
  const pTotal = Number((opts && opts.parcelaTotal) || 0);
  if (pAtual > 0 && pTotal > 0) return idEvento + '|P' + pAtual + '/' + pTotal;
  return idEvento;
}

function normalizarStatusAsaas_(statusRaw) {
  const s = String(statusRaw || '').trim().toUpperCase();
  if (!s) return 'PENDING';
  return s;
}

function normalizarTelefoneE164Br_(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('55') ? digits : '55' + digits;
}

function normalizarCpfCnpjAsaas_(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 || digits.length === 14) return digits;
  return '';
}

function extrairCpfCnpjDeTextoAsaas_(raw) {
  const txt = String(raw || '');
  if (!txt) return '';

  const cnpjMatch = txt.match(/\d{2}\D?\d{3}\D?\d{3}\D?\d{4}\D?\d{2}/);
  if (cnpjMatch && cnpjMatch[0]) {
    const cnpj = cnpjMatch[0].replace(/\D/g, '');
    if (cnpj.length === 14) return cnpj;
  }

  const cpfMatch = txt.match(/\d{3}\D?\d{3}\D?\d{3}\D?\d{2}/);
  if (cpfMatch && cpfMatch[0]) {
    const cpf = cpfMatch[0].replace(/\D/g, '');
    if (cpf.length === 11) return cpf;
  }

  return '';
}

function normalizarHeaderAsaas_(h) {
  return String(h || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .trim();
}

function encontrarIndiceHeaderAsaas_(headersNorm, aliases) {
  for (var i = 0; i < aliases.length; i++) {
    var idx = headersNorm.indexOf(String(aliases[i] || '').toUpperCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

function localizarContratantePorEventoAsaas_(idEvento) {
  const evento = buscarEvento(idEvento);
  if (!evento) return { ok: false };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('CONTRATANTES');
  if (!sh) return { ok: false };
  const data = sh.getDataRange().getValues();
  if (!data || data.length < 2) return { ok: false };

  const headersNorm = data[0].map(function (h) { return normalizarHeaderAsaas_(h); });
  const idxId = encontrarIndiceHeaderAsaas_(headersNorm, ['ID_CONTRATANTE']);
  const idxNome = encontrarIndiceHeaderAsaas_(headersNorm, ['NOME']);
  const idxWhatsapp = encontrarIndiceHeaderAsaas_(headersNorm, ['WHATSAPP', 'CELULAR', 'TELEFONE']);
  const idxEmail = encontrarIndiceHeaderAsaas_(headersNorm, ['EMAIL', 'E_MAIL', 'E-MAIL']);
  const idxObs = encontrarIndiceHeaderAsaas_(headersNorm, ['OBSERVACOES', 'OBS']);
  if (idxId === -1) return { ok: false };

  const idContratante = String(evento.idContratante || '').trim();
  var row = -1;
  if (idContratante) {
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idxId] || '').trim() === idContratante) {
        row = i + 1;
        break;
      }
    }
  }

  if (row === -1) return { ok: false };

  const linha = data[row - 1];
  const docObs = idxObs !== -1 ? extrairCpfCnpjDeTextoAsaas_(linha[idxObs]) : '';
  return {
    ok: true,
    row: row,
    idContratante: String(linha[idxId] || '').trim(),
    nomeContratante: idxNome !== -1 ? String(linha[idxNome] || '').trim() : String(evento.nomeContratante || '').trim(),
    whatsapp: idxWhatsapp !== -1 ? String(linha[idxWhatsapp] || '').trim() : '',
    email: idxEmail !== -1 ? String(linha[idxEmail] || '').trim() : '',
    cpfCnpj: docObs || ''
  };
}

function buscarDocumentoContratanteAsaas_(idContratante) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('CONTRATANTES');
  if (!sheet) return '';
  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return '';

  const headers = data[0].map(function (h) {
    return String(h || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
  });
  const idxId = headers.indexOf('ID_CONTRATANTE');
  if (idxId === -1) return '';

  const idxObs = headers.indexOf('OBSERVACOES');
  if (idxObs === -1) return '';

  const alvo = String(idContratante || '').trim();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idxId] || '').trim() !== alvo) continue;
    const docObs = idxObs !== -1 ? extrairCpfCnpjDeTextoAsaas_(data[i][idxObs]) : '';
    if (docObs) return docObs;
    return '';
  }
  return '';
}

function arredondar2_(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function asaasIntegracaoAtiva_() {
  const ativoWebhook = String(obterConfigSeguro('ASAAS_ATIVO') || '').toUpperCase() === 'TRUE';
  const ativoProvider = String(obterConfigSeguro('ASAAS_PROVIDER_ATIVO') || '').toUpperCase() === 'TRUE';
  return ativoWebhook || ativoProvider;
}

function garantirAbaCobrancasPix_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('COBRANCAS_PIX');
  const headers = [
    'ID',
    'PROVIDER',
    'ID_EVENTO',
    'EXTERNAL_REFERENCE',
    'PAYMENT_ID',
    'TXID',
    'VALOR_COBRANCA',
    'VALOR_RECEBIDO',
    'STATUS',
    'VENCIMENTO',
    'LINK_FATURA',
    'PIX_PAYLOAD',
    'PIX_COPIA_COLA',
    'RAW_PAYLOAD',
    'CRIADO_EM',
    'ATUALIZADO_EM',
    'CRIADO_POR',
    'OBS',
    'ULTIMO_SYNC_EM',
    'CONCILIACAO_STATUS',
    'DIVERGENCIA'
  ];

  if (!sh) {
    sh = ss.insertSheet('COBRANCAS_PIX');
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sh;
  }

  const lastCol = Math.max(sh.getLastColumn(), 1);
  const atual = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h || '').trim();
  });
  const faltantes = headers.filter(function (h) { return atual.indexOf(h) === -1; });
  if (faltantes.length) {
    sh.getRange(1, lastCol + 1, 1, faltantes.length).setValues([faltantes]);
  }

  return sh;
}

function mapearColunasPorCabecalho_(sheet) {
  const headers = sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1))
    .getValues()[0]
    .map(function (h) { return String(h || '').trim(); });
  return function (nome) {
    return headers.indexOf(String(nome || '').trim());
  };
}
