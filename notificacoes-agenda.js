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
    const inicio = Date.now();
    const resultado = processarResumoEventosHoje_({});
    PropertiesService.getScriptProperties().setProperty(
      'NOTIFICACOES_ULTIMO_RESUMO_RESULTADO',
      JSON.stringify({
        executadoEm: new Date().toISOString(),
        duracaoMs: Date.now() - inicio,
        resultado: resultado
      })
    );
    return resultado;
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
    const hora = validarHoraNotificacao_(obterConfig('NOTIFICACOES_HORA_RESUMO_DIA')) || '09:00';
    const partes = hora.split(':').map(Number);
    ScriptApp.newTrigger(NOTIFICACOES_HANDLER_AGENDADO_).timeBased()
      .atHour(partes[0]).nearMinute(partes[1]).everyDays(1)
      .inTimezone(String(obterConfig('NOTIFICACOES_TIMEZONE') || 'America/Fortaleza')).create();
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

function atualizarAutomacoesNotificacoes_(email, params) {
  const resumo = boolNotificacao_(params.resumo, false);
  const lembretes = boolNotificacao_(params.lembretes, false);
  const pendencias = boolNotificacao_(params.pendencias, false);
  atualizarAutomacaoResumoNotificacoes_(email, resumo);
  definirConfigNotificacao_('NOTIFICACOES_LEMBRETES_HORARIO_ATIVO', lembretes ? 'TRUE' : 'FALSE',
    'Ativa lembretes baseados no horário real do evento.');
  definirConfigNotificacao_('NOTIFICACOES_PENDENCIAS_MATINAIS_ATIVO', pendencias ? 'TRUE' : 'FALSE',
    'Ativa a verificação matinal de pendências financeiras e folhas.');
  obterOuCriarFilaNotificacoes_();
  removerGatilhosNotificacaoPorHandler_('processarLembretesEventoProximo');
  removerGatilhosNotificacaoPorHandler_('processarPendenciasMatinaisNotificacoes');
  removerGatilhosNotificacaoPorHandler_('processarFilaNotificacoes');
  removerGatilhosNotificacaoPorHandler_('processarCicloNotificacoes');
  removerGatilhosNotificacaoPorHandler_('onEditValidacao');
  ScriptApp.newTrigger('processarCicloNotificacoes').timeBased().everyMinutes(30).create();
  if (pendencias) {
    ScriptApp.newTrigger('processarPendenciasMatinaisNotificacoes').timeBased()
      .atHour(9).nearMinute(30).everyDays(1)
      .inTimezone(String(obterConfig('NOTIFICACOES_TIMEZONE') || 'America/Fortaleza')).create();
  }
  return {
    ok: true, resumo: resumo, lembretes: lembretes, pendencias: pendencias,
    gatilhos: {
      resumo: possuiGatilhoNotificacao_(NOTIFICACOES_HANDLER_AGENDADO_),
      lembretes: possuiGatilhoNotificacao_('processarCicloNotificacoes'),
      pendencias: possuiGatilhoNotificacao_('processarPendenciasMatinaisNotificacoes')
    }
  };
}

function removerGatilhosObsoletosNotificacao_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('NOTIFICACOES_GATILHOS_OBSOLETOS_V1') === 'OK') {
    return { ok: true, ignorado: true };
  }
  removerGatilhosNotificacaoPorHandler_('onEditValidacao');
  props.setProperty('NOTIFICACOES_GATILHOS_OBSOLETOS_V1', 'OK');
  return { ok: true, removidos: ['onEditValidacao'] };
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
  const modoTeste = boolNotificacao_(obterConfig('NOTIFICACOES_MODO_TESTE'), true);
  if (!modoTeste && !boolNotificacao_(obterConfig('FCM_ATIVO'), false)) {
    return { ok: true, ignorado: true, motivo: 'ENVIO_GLOBAL_DESLIGADO' };
  }
  const emailRestrito = String(opts.emailRestrito || (modoTeste ? obterConfig('NOTIFICACOES_DESTINATARIO_TESTE') : '') || '').trim().toLowerCase();
  const totais = { enviadosPush: 0, enviadosEmail: 0, duplicados: 0, erros: 0 };
  const recursos = {
    regra: regra,
    dispositivos: listarTodosDispositivosNotificacao_Interno_(),
    usuarios: listarUsuariosAtivosNotificacao_(),
    dedupeSet: obterChavesHistoricoNotificacoes_()
  };
  regra.perfis.forEach(function (perfil) {
    const visiveis = eventos.filter(function (linha) {
      if (!perfilPodeVisualizarTipoAgendaNotificacao_(perfil, linha[COL.TIPO_REGISTRO])) return false;
      if (tipoRegistroEventoNotificacao_(linha) !== 'reuniao') return true;
      return filtroReuniaoPermiteNotificacao_(
        regra,
        perfil,
        motivoReuniaoLinhaNotificacao_(linha)
      );
    });
    if (!visiveis.length) return;
    const contagem = contarTiposResumoAgendaNotificacao_(visiveis);
    const textoResumo = montarTextoResumoAgendaNotificacao_(contagem);
    const resultado = despacharRegraNotificacao_('EVENTO_HOJE', {
      referencia: hoje + '|' + normalizarPerfilNotificacao_(perfil),
      titulo: tituloResumoAgendaNotificacao_(contagem),
      mensagem: textoResumo,
      valores: {
        QTD_EVENTOS: contagem.eventos,
        QTD_REUNIOES: contagem.reunioes,
        QTD_COMPROMISSOS: contagem.compromissos,
        QTD_RESERVAS: contagem.reservas,
        QTD_BLOQUEIOS: contagem.bloqueios,
        QTD_OUTROS: contagem.outros,
        QTD_TOTAL: visiveis.length
      },
      link: './agenda.html'
    }, Object.assign({}, recursos, {
      emailRestrito: emailRestrito,
      perfilRestrito: perfil
    }));
    totais.enviadosPush += Number(resultado.enviadosPush || 0);
    totais.enviadosEmail += Number(resultado.enviadosEmail || 0);
    totais.duplicados += Number(resultado.duplicados || 0);
    totais.erros += Number(resultado.erros || 0);
  });
  return {
    ok: true, dataComercial: hoje, eventos: eventos.length,
    enviados: totais.enviadosPush + totais.enviadosEmail,
    enviadosPush: totais.enviadosPush,
    enviadosEmail: totais.enviadosEmail,
    duplicados: totais.duplicados,
    erros: totais.erros
  };
}

function contarTiposResumoAgendaNotificacao_(linhas) {
  return (linhas || []).reduce(function (acc, linha) {
    const tipo = tipoRegistroEventoNotificacao_(linha);
    if (tipo === 'reuniao') acc.reunioes++;
    else if (tipo === 'evento') acc.eventos++;
    else if (tipo === 'compromisso') acc.compromissos++;
    else if (tipo === 'reserva') acc.reservas++;
    else if (tipo === 'bloqueio') acc.bloqueios++;
    else acc.outros++;
    return acc;
  }, {
    eventos: 0,
    reunioes: 0,
    compromissos: 0,
    reservas: 0,
    bloqueios: 0,
    outros: 0
  });
}

function itemContagemResumoAgendaNotificacao_(quantidade, singular, plural) {
  const n = Number(quantidade || 0);
  return n ? n + ' ' + (n === 1 ? singular : plural) : '';
}

function montarTextoResumoAgendaNotificacao_(contagem) {
  const c = contagem || {};
  const itens = [
    itemContagemResumoAgendaNotificacao_(c.eventos, 'evento', 'eventos'),
    itemContagemResumoAgendaNotificacao_(c.reunioes, 'reunião', 'reuniões'),
    itemContagemResumoAgendaNotificacao_(c.compromissos, 'compromisso', 'compromissos'),
    itemContagemResumoAgendaNotificacao_(c.reservas, 'reserva', 'reservas'),
    itemContagemResumoAgendaNotificacao_(c.bloqueios, 'bloqueio', 'bloqueios'),
    itemContagemResumoAgendaNotificacao_(c.outros, 'outro registro', 'outros registros')
  ].filter(Boolean);
  let lista = itens.join(', ');
  if (itens.length > 1) {
    lista = itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1];
  }
  return 'Você tem ' + lista + ' hoje. Abra a agenda para conferir horários e locais.';
}

function tituloResumoAgendaNotificacao_(contagem) {
  const c = contagem || {};
  const outrosTipos = Number(c.reservas || 0) + Number(c.bloqueios || 0) + Number(c.outros || 0);
  if (c.reunioes > 0 && !c.eventos && !c.compromissos && !outrosTipos) return c.reunioes === 1 ? 'Reunião de hoje' : 'Reuniões de hoje';
  if (c.eventos > 0 && !c.reunioes && !c.compromissos && !outrosTipos) return c.eventos === 1 ? 'Evento de hoje' : 'Eventos de hoje';
  if (c.compromissos > 0 && !c.eventos && !c.reunioes && !outrosTipos) return c.compromissos === 1 ? 'Compromisso de hoje' : 'Compromissos de hoje';
  if (c.reservas > 0 && !c.eventos && !c.reunioes && !c.compromissos && !c.bloqueios && !c.outros) return c.reservas === 1 ? 'Reserva de hoje' : 'Reservas de hoje';
  if (c.bloqueios > 0 && !c.eventos && !c.reunioes && !c.compromissos && !c.reservas && !c.outros) return c.bloqueios === 1 ? 'Bloqueio de hoje' : 'Bloqueios de hoje';
  return 'Agenda de hoje';
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
    if (['CANCELADO', 'ARQUIVADO'].indexOf(
      String(r[COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase()
    ) !== -1) return false;
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
      eventosDia: boolNotificacao_(valorPorHeaderNotificacao_(r, idx, 'EVENTOS_DIA'), true),
      eventoCriadoEditado: boolNotificacao_(valorPorHeaderNotificacao_(r, idx, 'EVENTO_CRIADO_EDITADO'), true),
      folhaCustos: boolNotificacao_(valorPorHeaderNotificacao_(r, idx, 'FOLHA_CUSTOS'), true),
      ultimoAcesso: valorPorHeaderNotificacao_(r, idx, 'ULTIMO_ACESSO')
    };
  });
}

function obterAbaHistoricoNotificacoes_() {
  const headers = ['ID_ENVIO','CODIGO_REGRA','ID_EVENTO','EMAIL_DESTINATARIO','PERFIL','TOKEN_FINAL','CANAL','TITULO','MENSAGEM_RESUMO','STATUS','TENTATIVA','AGENDADO_PARA','ENVIADO_EM','CODIGO_ERRO','DETALHE_ERRO','CHAVE_DEDUPLICACAO','CRIADO_EM','ID_PROVEDOR'];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(NOTIFICACOES_ABA_HISTORICO_);
  if (!sheet) {
    sheet = ss.insertSheet(NOTIFICACOES_ABA_HISTORICO_);
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else if (String(sheet.getRange(1, 18).getValue() || '').trim() !== 'ID_PROVEDOR') {
    sheet.getRange(1, 18).setValue('ID_PROVEDOR');
  }
  return sheet;
}

function obterChavesHistoricoNotificacoes_() {
  const sheet = obterAbaHistoricoNotificacoes_();
  const chaves = {};
  if (sheet.getLastRow() < 2) return chaves;
  const dados = sheet.getRange(2, 10, sheet.getLastRow() - 1, 7).getDisplayValues();
  dados.forEach(function (r) {
    const status = String(r[0]).toUpperCase();
    if ((status === 'ENVIADO' || status === 'ACEITO_FCM') && r[6]) chaves[r[6]] = true;
  });
  return chaves;
}

function historicoNotificacaoPossuiChave_(chave, chavesCarregadas) {
  if (chavesCarregadas) return !!chavesCarregadas[chave];
  return !!obterChavesHistoricoNotificacoes_()[chave];
}

function registrarHistoricoNotificacao_(base, status, codigoErro, detalheErro) {
  const agora = new Date();
  obterAbaHistoricoNotificacoes_().appendRow([
    Utilities.getUuid(), base.codigoRegra, base.idEvento || '', base.email, base.perfil,
    base.identificadorFinal, base.canal || 'PUSH', base.titulo, String(base.mensagem || '').slice(0, 240),
    status, 1, agora, status === 'ENVIADO' ? agora : '', codigoErro || '',
    String(detalheErro || '').slice(0, 500), base.dedupe, agora,
    String(base.idProvedor || '').slice(0, 250)
  ]);
}
