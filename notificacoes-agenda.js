/**
 * Primeira automação controlada: resumo dos eventos da data comercial.
 * O gatilho pode ser instalado pelo proprietário, mas só envia quando a
 * chave NOTIFICACOES_RESUMO_AUTOMATICO_ATIVO estiver ligada na CONFIG.
 */

const NOTIFICACOES_HANDLER_AGENDADO_ = 'processarNotificacoesAgendadas';

function processarNotificacoesAgendadas() {
  if (!boolNotificacao_(obterConfig('NOTIFICACOES_RESUMO_AUTOMATICO_ATIVO'), false)) {
    return { ok: true, ignorado: true, motivo: 'AUTOMACAO_DESATIVADA' };
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: true, ignorado: true, motivo: 'PROCESSAMENTO_EM_ANDAMENTO' };
  try {
    return processarResumoEventosHoje_({});
  } finally {
    lock.releaseLock();
  }
}

function atualizarAutomacaoResumoNotificacoes_(email, ativa) {
  const habilitar = boolNotificacao_(ativa, false);
  definirConfigNotificacao_(
    'NOTIFICACOES_RESUMO_AUTOMATICO_ATIVO',
    habilitar ? 'TRUE' : 'FALSE',
    'Executa automaticamente o resumo diário de eventos no horário configurado.'
  );
  removerGatilhosNotificacaoPorHandler_(NOTIFICACOES_HANDLER_AGENDADO_);
  if (habilitar) {
    ScriptApp.newTrigger(NOTIFICACOES_HANDLER_AGENDADO_).timeBased().everyMinutes(15).create();
  }
  registrarLog('ATUALIZAR', 'CONFIG', 'NOTIFICACOES_RESUMO_AUTOMATICO_ATIVO',
    (habilitar ? 'Automação ativada' : 'Automação desativada') + ' por ' + String(email || ''));
  return { ok: true, ativa: habilitar, gatilhoInstalado: habilitar && possuiGatilhoNotificacao_(NOTIFICACOES_HANDLER_AGENDADO_) };
}

function possuiGatilhoNotificacao_(handler) {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === handler; });
}

function removerGatilhosNotificacaoPorHandler_(handler) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t);
  });
}

function executarResumoEventosHojeTeste_(email) {
  const alvo = String(obterConfig('NOTIFICACOES_DESTINATARIO_TESTE') || '').trim().toLowerCase();
  if (!boolNotificacao_(obterConfig('NOTIFICACOES_MODO_TESTE'), true)) throw new Error('NOTIFICACOES_MODO_TESTE_DESLIGADO');
  if (!alvo || alvo !== String(email || '').trim().toLowerCase()) throw new Error('NOTIFICACOES_EMAIL_TESTE_DIVERGENTE');
  return processarResumoEventosHoje_({ forcarHorario: true, emailRestrito: alvo });
}

function processarResumoEventosHoje_(opcoes) {
  const opts = opcoes || {};
  const timezone = String(obterConfig('NOTIFICACOES_TIMEZONE') || 'America/Fortaleza');
  const hoje = Utilities.formatDate(new Date(), timezone, 'dd/MM/yyyy');
  const regra = listarRegrasNotificacoes_().filter(function (r) { return r.codigo === 'EVENTO_HOJE'; })[0];
  if (!regra || !regra.ativo || !regra.canalPush) return { ok: true, ignorado: true, motivo: 'REGRA_DESATIVADA' };
  if (!opts.forcarHorario && !horarioResumoDisponivel_(regra.horarioEnvio, timezone)) {
    return { ok: true, ignorado: true, motivo: 'FORA_DO_HORARIO' };
  }

  const eventos = listarEventosDataComercialNotificacao_(hoje, timezone);
  if (!eventos.length) return { ok: true, dataComercial: hoje, eventos: 0, enviados: 0, motivo: 'SEM_EVENTOS' };

  const titulo = aplicarTemplateNotificacao_(regra.titulo || 'Eventos de hoje', { QTD_EVENTOS: eventos.length });
  const mensagem = aplicarTemplateNotificacao_(regra.mensagem, { QTD_EVENTOS: eventos.length });
  const modoTeste = boolNotificacao_(obterConfig('NOTIFICACOES_MODO_TESTE'), true);
  if (!modoTeste && !boolNotificacao_(obterConfig('FCM_ATIVO'), false)) {
    return { ok: true, ignorado: true, motivo: 'ENVIO_GLOBAL_DESLIGADO' };
  }
  const emailRestrito = String(opts.emailRestrito || (modoTeste ? obterConfig('NOTIFICACOES_DESTINATARIO_TESTE') : '') || '').trim().toLowerCase();
  const dispositivos = listarTodosDispositivosNotificacao_Interno_().filter(function (d) {
    if (!d.ativo || !d.eventosDia) return false;
    if (emailRestrito && d.email !== emailRestrito) return false;
    return regra.perfis.indexOf(d.perfil) !== -1;
  });

  let enviados = 0; let duplicados = 0; const resultados = [];
  dispositivos.forEach(function (d) {
    const dedupe = ['EVENTO_HOJE', hoje, d.email, hashIdentificadorNotificacao_(d.identificador)].join('|');
    const dedupeLegado = ['EVENTO_HOJE', hoje, d.email, d.identificador].join('|');
    if (historicoNotificacaoPossuiChave_(dedupe) || historicoNotificacaoPossuiChave_(dedupeLegado)) { duplicados++; return; }
    const baseHistorico = {
      codigoRegra: 'EVENTO_HOJE', email: d.email, perfil: d.perfil,
      identificadorFinal: d.identificador.slice(-10), titulo: titulo,
      mensagem: mensagem, dedupe: dedupe
    };
    try {
      const resposta = enviarFcmHttpV1_(d.identificador, {
        title: titulo, body: mensagem, url: './agenda.html', tipo: 'EVENTO_HOJE'
      }, {
        permitirComEnvioGlobalDesligado: modoTeste,
        identificadorTipo: d.identificadorTipo
      });
      if (resposta.ignorado) throw new Error(resposta.motivo || 'FCM_IGNORADO');
      registrarHistoricoNotificacao_(baseHistorico, 'ENVIADO', '', '');
      enviados++;
      resultados.push({ plataforma: d.plataforma, final: d.identificador.slice(-10), status: 'ENVIADO' });
    } catch (erro) {
      registrarHistoricoNotificacao_(baseHistorico, 'ERRO', 'FCM_SEND_ERROR', String(erro && erro.message || erro));
      resultados.push({ plataforma: d.plataforma, final: d.identificador.slice(-10), status: 'ERRO' });
    }
  });
  return { ok: true, dataComercial: hoje, eventos: eventos.length, enviados: enviados, duplicados: duplicados, resultados: resultados };
}

function hashIdentificadorNotificacao_(identificador) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(identificador || ''), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '').slice(0, 20);
}

function listarEventosDataComercialNotificacao_(dataAlvo, timezone) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('EVENTOS');
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getDataRange().getValues().slice(1).filter(function (r) {
    if (!r[COL.ID_EVENTO]) return false;
    if (String(r[COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase() === 'CANCELADO') return false;
    return formatarDataComercialNotificacao_(r[COL.DATA_EVENTO], timezone) === dataAlvo;
  });
}

function formatarDataComercialNotificacao_(valor, timezone) {
  if (valor instanceof Date) return Utilities.formatDate(valor, timezone, 'dd/MM/yyyy');
  const s = String(valor || '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + m[3];
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? m[3].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + m[1] : '';
}

function horarioResumoDisponivel_(hora, timezone) {
  const agora = Utilities.formatDate(new Date(), timezone, 'HH:mm');
  const inicio = String(obterConfig('NOTIFICACOES_HORARIO_INICIO') || '07:00');
  const fim = String(obterConfig('NOTIFICACOES_HORARIO_FIM') || '23:00');
  const alvo = validarHoraNotificacao_(hora) || String(obterConfig('NOTIFICACOES_HORA_RESUMO_DIA') || '09:00');
  return agora >= alvo && agora >= inicio && agora <= fim;
}

function aplicarTemplateNotificacao_(template, valores) {
  return String(template || '').replace(/\{([A-Z0-9_]+)\}/g, function (_, chave) {
    return valores[chave] === undefined ? '' : String(valores[chave]);
  });
}

function listarTodosDispositivosNotificacao_Interno_() {
  const sheet = obterOuCriarAbaDispositivosNotificacao_();
  const dados = sheet.getDataRange().getValues();
  const idx = indexarHeadersNotificacao_(dados[0]);
  return dados.slice(1).filter(function (r) { return String(valorPorHeaderNotificacao_(r, idx, 'TOKEN') || '').trim(); }).map(function (r) {
    return {
      identificador: String(valorPorHeaderNotificacao_(r, idx, 'TOKEN') || '').trim(),
      identificadorTipo: normalizarTipoIdentificadorNotificacao_(valorPorHeaderNotificacao_(r, idx, 'TIPO_IDENTIFICADOR')),
      email: String(valorPorHeaderNotificacao_(r, idx, 'EMAIL') || '').trim().toLowerCase(),
      perfil: String(valorPorHeaderNotificacao_(r, idx, 'PERFIL') || '').trim(),
      plataforma: String(valorPorHeaderNotificacao_(r, idx, 'PLATAFORMA') || ''),
      ativo: boolNotificacao_(valorPorHeaderNotificacao_(r, idx, 'ATIVO'), false),
      eventosDia: boolNotificacao_(valorPorHeaderNotificacao_(r, idx, 'EVENTOS_DIA'), true)
    };
  });
}

function obterAbaHistoricoNotificacoes_() {
  const headers = ['ID_ENVIO','CODIGO_REGRA','ID_EVENTO','EMAIL_DESTINATARIO','PERFIL','TOKEN_FINAL','CANAL','TITULO','MENSAGEM_RESUMO','STATUS','TENTATIVA','AGENDADO_PARA','ENVIADO_EM','CODIGO_ERRO','DETALHE_ERRO','CHAVE_DEDUPLICACAO','CRIADO_EM'];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(NOTIFICACOES_ABA_HISTORICO_);
  if (!sheet) { sheet = ss.insertSheet(NOTIFICACOES_ABA_HISTORICO_); sheet.getRange(1,1,1,headers.length).setValues([headers]); sheet.setFrozenRows(1); }
  return sheet;
}

function historicoNotificacaoPossuiChave_(chave) {
  const sheet = obterAbaHistoricoNotificacoes_();
  if (sheet.getLastRow() < 2) return false;
  const dados = sheet.getRange(2, 10, sheet.getLastRow() - 1, 7).getDisplayValues();
  return dados.some(function (r) { return String(r[0]).toUpperCase() === 'ENVIADO' && r[6] === chave; });
}

function registrarHistoricoNotificacao_(base, status, codigoErro, detalheErro) {
  const agora = new Date();
  obterAbaHistoricoNotificacoes_().appendRow([
    Utilities.getUuid(), base.codigoRegra, '', base.email, base.perfil,
    base.identificadorFinal, 'PUSH', base.titulo, String(base.mensagem || '').slice(0, 240),
    status, 1, agora, status === 'ENVIADO' ? agora : '', codigoErro || '',
    String(detalheErro || '').slice(0, 500), base.dedupe, agora
  ]);
}
