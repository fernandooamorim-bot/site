/**
 * Motor isolado de notificações.
 * Regra fundamental: nenhuma falha deste arquivo pode desfazer ou bloquear
 * uma operação de agenda/financeiro já concluída.
 */

function executarNotificacaoSemBloquear_(rotulo, fn) {
  try {
    return fn();
  } catch (erro) {
    try {
      registrarLog('ERRO_NOTIFICACAO', 'NOTIFICACOES', String(rotulo || ''),
        String(erro && erro.message || erro).slice(0, 500));
    } catch (_) {}
    return { ok: false, erro: String(erro && erro.message || erro) };
  }
}

const NOTIFICACOES_ABA_FILA_ = 'NOTIFICACOES_FILA';

function obterOuCriarFilaNotificacoes_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(NOTIFICACOES_ABA_FILA_);
  const headers = ['ID_FILA','CODIGO_REGRA','CONTEXTO_JSON','STATUS','TENTATIVAS',
    'CRIADO_EM','PROCESSADO_EM','ULTIMO_ERRO'];
  if (!sheet) {
    sheet = ss.insertSheet(NOTIFICACOES_ABA_FILA_);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function enfileirarNotificacaoRegra_(codigo, contexto) {
  const idFila = Utilities.getUuid();
  obterOuCriarFilaNotificacoes_().appendRow([
    idFila, String(codigo || '').toUpperCase(),
    JSON.stringify(contexto || {}), 'PENDENTE', 0, new Date(), '', ''
  ]);
  return { ok: true, enfileirada: true, idFila: idFila };
}

function enfileirarAlteracaoEventoConsolidada_(contexto) {
  const codigo = 'EVENTO_ALTERADO_IMPORTANTE';
  const sheet = obterOuCriarFilaNotificacoes_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return enfileirarNotificacaoRegra_(codigo, contexto);
  try {
    if (sheet.getLastRow() >= 2) {
      const dados = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
      for (let i = dados.length - 1; i >= 0; i--) {
        if (String(dados[i][1] || '').toUpperCase() !== codigo ||
            String(dados[i][3] || '').toUpperCase() !== 'PENDENTE') continue;
        let anterior;
        try { anterior = JSON.parse(String(dados[i][2] || '{}')); } catch (_) { continue; }
        if (String(anterior.idEvento || '') !== String(contexto.idEvento || '')) continue;

        const alteracoes = mesclarAlteracoesNotificacao_(
          anterior.alteracoes || [],
          contexto.alteracoes || []
        );
        const atualizado = Object.assign({}, contexto, {
          alteracoes: alteracoes,
          valores: montarValoresAlteracaoNotificacao_(contexto.valores || {}, alteracoes)
        });
        sheet.getRange(i + 2, 3).setValue(JSON.stringify(atualizado));
        return { ok: true, enfileirada: true, consolidada: true, idFila: String(dados[i][0] || '') };
      }
    }
    const idFila = Utilities.getUuid();
    sheet.appendRow([
      idFila, codigo, JSON.stringify(contexto || {}),
      'PENDENTE', 0, new Date(), '', ''
    ]);
    return { ok: true, enfileirada: true, consolidada: false, idFila: idFila };
  } finally {
    lock.releaseLock();
  }
}

function processarFilaNotificacoes(idFilaAlvo) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: true, ignorado: true, motivo: 'FILA_EM_PROCESSAMENTO' };
  try {
    const sheet = obterOuCriarFilaNotificacoes_();
    if (sheet.getLastRow() < 2) return { ok: true, processadas: 0 };
    const dados = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
    const maxTentativas = Math.max(1, Number(obterConfig('NOTIFICACOES_MAX_TENTATIVAS') || 3));
    let processadas = 0;
    for (let i = 0; i < dados.length && processadas < 20; i++) {
      if (idFilaAlvo && String(dados[i][0] || '') !== String(idFilaAlvo)) continue;
      const status = String(dados[i][3] || '').toUpperCase();
      const tentativas = Number(dados[i][4] || 0);
      if (status === 'ENVIADO' || status === 'IGNORADO' || tentativas >= maxTentativas) continue;
      try {
        const contexto = JSON.parse(String(dados[i][2] || '{}'));
        const resultado = despacharRegraNotificacao_(dados[i][1], contexto);
        sheet.getRange(i + 2, 4, 1, 5).setValues([[
          resultado.ignorado ? 'IGNORADO' : (resultado.erros ? 'ERRO' : 'ENVIADO'),
          tentativas + 1, dados[i][5] || new Date(), new Date(),
          resultado.erros ? String(resultado.erros) + ' erro(s) de canal' : ''
        ]]);
      } catch (erro) {
        sheet.getRange(i + 2, 4, 1, 5).setValues([[
          'ERRO', tentativas + 1, dados[i][5] || new Date(), new Date(),
          String(erro && erro.message || erro).slice(0, 500)
        ]]);
      }
      processadas++;
    }
    return { ok: true, processadas: processadas };
  } finally {
    lock.releaseLock();
  }
}

function obterDiagnosticoFilaNotificacoes_() {
  const sheet = obterOuCriarFilaNotificacoes_();
  if (sheet.getLastRow() < 2) return { pendentes: 0, erros: 0, ultimaCriacao: '' };
  const dados = sheet.getRange(2, 4, sheet.getLastRow() - 1, 3).getDisplayValues();
  return dados.reduce(function (acc, linha) {
    const status = String(linha[0] || '').toUpperCase();
    if (status === 'PENDENTE') acc.pendentes++;
    if (status === 'ERRO') acc.erros++;
    if (String(linha[2] || '') > acc.ultimaCriacao) acc.ultimaCriacao = String(linha[2] || '');
    return acc;
  }, { pendentes: 0, erros: 0, ultimaCriacao: '' });
}

/**
 * Um único gatilho atende a fila e os lembretes por horário.
 * Para este sistema, até 30 minutos de latência operacional é aceitável e
 * reduz o consumo diário do Apps Script para apenas 48 ciclos.
 */
function processarCicloNotificacoes() {
  PropertiesService.getScriptProperties().setProperty(
    'NOTIFICACOES_ULTIMO_CICLO_EM',
    new Date().toISOString()
  );
  const fila = executarNotificacaoSemBloquear_('FILA', function () {
    return processarFilaNotificacoes();
  });
  let lembretes = { ok: true, ignorado: true, motivo: 'LEMBRETES_DESATIVADOS' };
  if (boolNotificacao_(obterConfig('NOTIFICACOES_LEMBRETES_HORARIO_ATIVO'), false)) {
    lembretes = executarNotificacaoSemBloquear_('EVENTO_ANTECEDENCIA', function () {
      return processarLembretesEventoProximo();
    });
  }
  const manutencaoDispositivos = executarNotificacaoSemBloquear_('MANUTENCAO_DISPOSITIVOS', function () {
    return executarManutencaoDispositivosSeNecessario_();
  });
  return { ok: true, fila: fila, lembretes: lembretes, manutencaoDispositivos: manutencaoDispositivos };
}

function obterRegraNotificacaoPorCodigo_(codigo) {
  const alvo = String(codigo || '').trim().toUpperCase();
  return listarRegrasNotificacoes_().filter(function (r) { return r.codigo === alvo; })[0] || null;
}

function preferenciasDispositivoPermitemRegra_(d, codigo) {
  const c = String(codigo || '').toUpperCase();
  if (c.indexOf('FOLHA_CUSTOS') === 0) return d.folhaCustos !== false;
  if (c === 'EVENTO_CRIADO' || c === 'EVENTO_ALTERADO_IMPORTANTE' ||
      c === 'EVENTO_CANCELADO' || c === 'REUNIAO_CRIADA_EDITADA') {
    return d.eventoCriadoEditado !== false;
  }
  return d.eventosDia !== false;
}

function tipoRegistroEventoNotificacao_(linhaOuValor) {
  const valor = Array.isArray(linhaOuValor)
    ? linhaOuValor[COL.TIPO_REGISTRO]
    : linhaOuValor;
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase();
}

function perfilPodeVisualizarTipoAgendaNotificacao_(perfil, tipoRegistro) {
  const p = normalizarPerfilNotificacao_(perfil);
  const tipo = tipoRegistroEventoNotificacao_(tipoRegistro);
  if (p === 'Proprietário' || p === 'Administrador') return true;
  if (p === 'Produção') {
    return tipo === 'evento' || tipo === 'bloqueio' || tipo === 'reserva';
  }
  if (p === 'Músico') return tipo === 'evento';
  return false;
}

function normalizarTextoFiltroNotificacao_(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase();
}

function motivoReuniaoLinhaNotificacao_(linha) {
  return String(linha && linha[COL.OBSERVACOES] || '').trim();
}

function filtroReuniaoPermiteNotificacao_(regra, perfil, motivo) {
  const filtro = regra && regra.filtroReuniao ? regra.filtroReuniao : {};
  const p = normalizarPerfilNotificacao_(perfil);
  const itens = Array.isArray(filtro[p]) ? filtro[p] : [];
  if (!itens.length) return false;
  if (itens.indexOf('*') !== -1) return true;
  const alvo = normalizarTextoFiltroNotificacao_(motivo);
  return itens.some(function (item) {
    return normalizarTextoFiltroNotificacao_(item) === alvo;
  });
}

function destinatarioPodeReceberContextoNotificacao_(regra, perfil, contexto) {
  const ctx = contexto || {};
  const valores = ctx.valores || {};
  const tipo = String(ctx.tipoRegistro || valores.TIPO_REGISTRO || '');
  if (tipo && !perfilPodeVisualizarTipoAgendaNotificacao_(perfil, tipo)) return false;
  if (tipoRegistroEventoNotificacao_(tipo) === 'reuniao') {
    const motivo = String(ctx.motivoReuniao || valores.MOTIVO_REUNIAO || '');
    return filtroReuniaoPermiteNotificacao_(regra, perfil, motivo);
  }
  return true;
}

function montarValoresEventoNotificacao_(linha, extras) {
  const timezone = String(obterConfig('NOTIFICACOES_TIMEZONE') || 'America/Fortaleza');
  return Object.assign({
    ID_EVENTO: String(linha[COL.ID_EVENTO] || ''),
    DATA_COMERCIAL: formatarDataComercialNotificacao_(linha[COL.DATA_EVENTO], timezone),
    HORA: formatarHoraValorNotificacao_(linha[COL.HORA_INICIO]),
    TIPO_EVENTO: String(linha[COL.TIPO_EVENTO] || linha[COL.TIPO_REGISTRO] || 'Evento'),
    TIPO_REGISTRO: String(linha[COL.TIPO_REGISTRO] || 'Evento'),
    MOTIVO_REUNIAO: motivoReuniaoLinhaNotificacao_(linha),
    CONTRATANTE: String(linha[COL.NOME_CONTRATANTE] || 'sem contratante'),
    LOCAL: String(linha[COL.LOCAL] || ''),
    VALOR_PENDENTE: formatarMoedaNotificacao_(linha[COL.VALOR_PENDENTE])
  }, extras || {});
}

function formatarMoedaNotificacao_(valor) {
  const n = Number(valor || 0);
  return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function buscarLinhaEventoNotificacao_(idEvento) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('EVENTOS');
  if (!sheet || sheet.getLastRow() < 2) return null;
  const dados = sheet.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][COL.ID_EVENTO] || '').trim() === String(idEvento || '').trim()) return dados[i];
  }
  return null;
}

function despacharRegraNotificacao_(codigo, contexto, opcoes) {
  const regra = obterRegraNotificacaoPorCodigo_(codigo);
  if (!regra || !regra.ativo) return { ok: true, ignorado: true, motivo: 'REGRA_DESATIVADA' };

  const ctx = contexto || {};
  const opts = opcoes || {};
  const valores = ctx.valores || {};
  const titulo = limitarTextoNotificacao_(aplicarTemplateNotificacao_(regra.titulo || regra.nome, valores), 120);
  const mensagem = limitarTextoNotificacao_(aplicarTemplateNotificacao_(regra.mensagem || regra.descricao, valores), 420);
  const link = String(ctx.link || regra.linkDestino || './index.html?menu=1');
  const idEvento = String(ctx.idEvento || valores.ID_EVENTO || '');
  const referencia = String(ctx.referencia || idEvento || Utilities.getUuid());
  const modoTeste = boolNotificacao_(obterConfig('NOTIFICACOES_MODO_TESTE'), true);
  const emailTeste = String(obterConfig('NOTIFICACOES_DESTINATARIO_TESTE') || '').trim().toLowerCase();
  const emailRestrito = String(opts.emailRestrito || (modoTeste ? emailTeste : '')).trim().toLowerCase();
  const dispositivos = listarTodosDispositivosNotificacao_Interno_().filter(function (d) {
    if (!d.ativo || !preferenciasDispositivoPermitemRegra_(d, codigo)) return false;
    if (emailRestrito && d.email !== emailRestrito) return false;
    const perfil = normalizarPerfilNotificacao_(d.perfil);
    if (opts.perfilRestrito &&
        perfil !== normalizarPerfilNotificacao_(opts.perfilRestrito)) return false;
    return regra.perfis.indexOf(perfil) !== -1 &&
      destinatarioPodeReceberContextoNotificacao_(regra, perfil, ctx);
  });

  let enviadosPush = 0; let enviadosEmail = 0; let duplicados = 0; let erros = 0;
  if (regra.canalPush && (modoTeste || boolNotificacao_(obterConfig('FCM_ATIVO'), false))) {
    dispositivos.forEach(function (d) {
      const dedupe = [codigo, referencia, d.email, hashIdentificadorNotificacao_(d.identificador), 'PUSH'].join('|');
      if (historicoNotificacaoPossuiChave_(dedupe)) { duplicados++; return; }
      const base = {
        codigoRegra: codigo, idEvento: idEvento, email: d.email, perfil: d.perfil,
        identificadorFinal: d.identificador.slice(-10), titulo: titulo, mensagem: mensagem,
        dedupe: dedupe, canal: 'PUSH'
      };
      try {
        const resposta = enviarFcmHttpV1_(d.identificador, {
          title: titulo, body: mensagem, url: link, tipo: codigo
        }, { permitirComEnvioGlobalDesligado: modoTeste, identificadorTipo: d.identificadorTipo });
        if (resposta.ignorado) throw new Error(resposta.motivo || 'FCM_IGNORADO');
        base.idProvedor = String(resposta.firebaseMessageName || '');
        registrarHistoricoNotificacao_(base, 'ACEITO_FCM', '', '');
        enviadosPush++;
      } catch (erro) {
        registrarHistoricoNotificacao_(base, 'ERRO', 'FCM_SEND_ERROR', String(erro && erro.message || erro));
        erros++;
      }
    });
  }

  const emailAtivo = boolNotificacao_(obterConfig('NOTIFICACOES_EMAIL_ATIVO'), false);
  if (regra.canalEmail && emailAtivo) {
    const destinatarios = {};
    listarUsuariosAtivosNotificacao_().forEach(function (u) {
      if (emailRestrito && u.email !== emailRestrito) return;
      const perfil = normalizarPerfilNotificacao_(u.perfil);
      if (opts.perfilRestrito &&
          perfil !== normalizarPerfilNotificacao_(opts.perfilRestrito)) return;
      if (regra.perfis.indexOf(perfil) !== -1 &&
          destinatarioPodeReceberContextoNotificacao_(regra, perfil, ctx)) {
        destinatarios[u.email] = u;
      }
    });
    Object.keys(destinatarios).forEach(function (email) {
      const u = destinatarios[email];
      const dedupe = [codigo, referencia, email, 'EMAIL'].join('|');
      if (historicoNotificacaoPossuiChave_(dedupe)) { duplicados++; return; }
      const base = {
        codigoRegra: codigo, idEvento: idEvento, email: email, perfil: u.perfil,
        identificadorFinal: '', titulo: titulo, mensagem: mensagem, dedupe: dedupe, canal: 'EMAIL'
      };
      try {
        MailApp.sendEmail({
          to: email,
          subject: titulo,
          htmlBody: '<div style="font-family:Arial,sans-serif;line-height:1.5"><h2>' +
            escaparHtmlEmailNotificacao_(titulo) + '</h2><p>' + escaparHtmlEmailNotificacao_(mensagem) +
            '</p><p><a href="' + escaparHtmlEmailNotificacao_(urlAbsolutaNotificacao_(link)) +
            '">Abrir no sistema</a></p></div>',
          name: String(obterConfig('NOME_EMPRESA') || 'Super Agenda')
        });
        registrarHistoricoNotificacao_(base, 'ENVIADO', '', '');
        enviadosEmail++;
      } catch (erro) {
        registrarHistoricoNotificacao_(base, 'ERRO', 'EMAIL_SEND_ERROR', String(erro && erro.message || erro));
        erros++;
      }
    });
  }
  const totalEntregas = enviadosPush + enviadosEmail + duplicados + erros;
  if (!totalEntregas) {
    return { ok: true, ignorado: true, motivo: 'SEM_DESTINATARIOS',
      enviadosPush: 0, enviadosEmail: 0, duplicados: 0, erros: 0 };
  }
  return { ok: true, enviadosPush: enviadosPush, enviadosEmail: enviadosEmail, duplicados: duplicados, erros: erros };
}

function escaparHtmlEmailNotificacao_(valor) {
  return String(valor || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function urlAbsolutaNotificacao_(link) {
  const raw = String(link || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return 'https://fernandooamorim-bot.github.io/site/' + raw.replace(/^\.?\//, '');
}

function normalizarLinkManualNotificacao_(link) {
  const raw = String(link || './index.html?menu=1').trim();
  if (/^https:\/\/fernandooamorim-bot\.github\.io\/site\//i.test(raw)) return raw;
  if (/^(?:\.?\/)?[a-z0-9_-]+\.html(?:[?#][^\s]*)?$/i.test(raw)) return raw.replace(/^\//, './');
  return './index.html?menu=1';
}

function listarUsuariosAtivosNotificacao_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('USUARIOS');
  if (!sheet || sheet.getLastRow() < 2) return [];
  const dados = sheet.getDataRange().getValues();
  const idx = indexarHeadersNotificacao_(dados[0]);
  return dados.slice(1).filter(function (r) {
    return String(valorPorHeaderNotificacao_(r, idx, 'EMAIL') || '').trim() &&
      String(valorPorHeaderNotificacao_(r, idx, 'STATUS') || 'Ativo').trim().toLowerCase() !== 'inativo';
  }).map(function (r) {
    return {
      email: String(valorPorHeaderNotificacao_(r, idx, 'EMAIL') || '').trim().toLowerCase(),
      nome: String(valorPorHeaderNotificacao_(r, idx, 'NOME') || ''),
      perfil: String(valorPorHeaderNotificacao_(r, idx, 'PERFIL') || '')
    };
  });
}

function obterCoberturaNotificacoes_() {
  const dispositivos = listarTodosDispositivosNotificacao_Interno_();
  return listarUsuariosAtivosNotificacao_().map(function (u) {
    const ds = dispositivos.filter(function (d) { return d.email === u.email; });
    const ativos = ds.filter(function (d) { return d.ativo; });
    return {
      email: u.email, nome: u.nome, perfil: u.perfil,
      aparelhos: ds.length, aparelhosAtivos: ativos.length,
      status: ativos.length ? 'ATIVO' : (ds.length ? 'DESATIVADO' : 'NUNCA_ATIVOU'),
      ultimoAcesso: ds.reduce(function (acc, d) {
        return String(d.ultimoAcesso || '') > String(acc || '') ? d.ultimoAcesso : acc;
      }, '')
    };
  });
}

function enviarComunicadoManual_(emailAutor, params) {
  const titulo = limitarTextoNotificacao_(params.titulo, 100);
  const mensagem = limitarTextoNotificacao_(params.mensagem, 400);
  if (titulo.length < 3 || mensagem.length < 3) throw new Error('COMUNICADO_TITULO_MENSAGEM_OBRIGATORIOS');
  const perfis = Array.from(new Set(
    parseJsonArrayNotificacao_(params.perfis).map(normalizarPerfilNotificacao_).filter(function (p) {
      return NOTIFICACOES_PERFIS_PERMITIDOS_.indexOf(p) !== -1;
    })
  ));
  const emails = parseJsonArrayNotificacao_(params.emails).map(function (e) { return String(e).trim().toLowerCase(); });
  if (!perfis.length && !emails.length) throw new Error('COMUNICADO_DESTINATARIO_OBRIGATORIO');
  const codigo = 'COMUNICADO_MANUAL';
  const regra = {
    codigo: codigo, ativo: true, canalPush: boolNotificacao_(params.push, true),
    canalEmail: boolNotificacao_(params.email, false), perfis: perfis.length ? perfis : NOTIFICACOES_PERFIS_PERMITIDOS_
  };
  const referencia = 'MANUAL-' + Utilities.getUuid();
  const modoTeste = boolNotificacao_(obterConfig('NOTIFICACOES_MODO_TESTE'), true);
  const emailTeste = String(obterConfig('NOTIFICACOES_DESTINATARIO_TESTE') || '').trim().toLowerCase();
  const permitidos = {};
  listarUsuariosAtivosNotificacao_().forEach(function (u) {
    const porPerfil = perfis.length && perfis.indexOf(normalizarPerfilNotificacao_(u.perfil)) !== -1;
    const porEmail = emails.indexOf(u.email) !== -1;
    if (porPerfil || porEmail) permitidos[u.email] = u;
  });
  if (modoTeste) {
    Object.keys(permitidos).forEach(function (e) { if (e !== emailTeste) delete permitidos[e]; });
  }
  const dispositivos = listarTodosDispositivosNotificacao_Interno_().filter(function (d) {
    return d.ativo && !!permitidos[d.email];
  });
  let pushEnviados = 0; let emailEnviados = 0; let erros = 0;
  if (regra.canalPush && (modoTeste || boolNotificacao_(obterConfig('FCM_ATIVO'), false))) {
    dispositivos.forEach(function (d) {
      const base = {
        codigoRegra: codigo, idEvento: '', email: d.email, perfil: d.perfil,
        identificadorFinal: d.identificador.slice(-10), titulo: titulo, mensagem: mensagem,
        dedupe: [referencia, d.email, hashIdentificadorNotificacao_(d.identificador), 'PUSH'].join('|'), canal: 'PUSH'
      };
      try {
        const resposta = enviarFcmHttpV1_(d.identificador, { title: titulo, body: mensagem,
          url: normalizarLinkManualNotificacao_(params.link), tipo: codigo },
          { permitirComEnvioGlobalDesligado: modoTeste, identificadorTipo: d.identificadorTipo });
        base.idProvedor = String(resposta.firebaseMessageName || '');
        registrarHistoricoNotificacao_(base, 'ACEITO_FCM', '', 'Autor: ' + emailAutor);
        pushEnviados++;
      } catch (erro) {
        registrarHistoricoNotificacao_(base, 'ERRO', 'FCM_SEND_ERROR', String(erro && erro.message || erro));
        erros++;
      }
    });
  }
  if (regra.canalEmail && boolNotificacao_(obterConfig('NOTIFICACOES_EMAIL_ATIVO'), false)) {
    Object.keys(permitidos).forEach(function (destino) {
      const u = permitidos[destino];
      const base = {
        codigoRegra: codigo, idEvento: '', email: destino, perfil: u.perfil,
        identificadorFinal: '', titulo: titulo, mensagem: mensagem,
        dedupe: [referencia, destino, 'EMAIL'].join('|'), canal: 'EMAIL'
      };
      try {
        MailApp.sendEmail(destino, titulo, mensagem + '\n\nEnviado por ' + emailAutor);
        registrarHistoricoNotificacao_(base, 'ENVIADO', '', 'Autor: ' + emailAutor);
        emailEnviados++;
      } catch (erro) {
        registrarHistoricoNotificacao_(base, 'ERRO', 'EMAIL_SEND_ERROR', String(erro && erro.message || erro));
        erros++;
      }
    });
  }
  registrarLog('ENVIAR', 'NOTIFICACOES', referencia,
    'Comunicado manual por ' + emailAutor + '; push=' + pushEnviados + '; email=' + emailEnviados);
  return { ok: true, referencia: referencia, destinatarios: Object.keys(permitidos).length,
    aparelhos: dispositivos.length, pushEnviados: pushEnviados, emailEnviados: emailEnviados, erros: erros };
}

function enfileirarNotificacaoImediata_(codigo, contexto, consolidar) {
  const fila = consolidar
    ? enfileirarAlteracaoEventoConsolidada_(contexto)
    : enfileirarNotificacaoRegra_(codigo, contexto);
  const processamento = processarFilaNotificacoes(fila && fila.idFila);
  return {
    ok: true,
    enfileirada: true,
    idFila: fila && fila.idFila || '',
    processamento: processamento
  };
}

function notificarEventoCriado_(idEvento) {
  const linha = buscarLinhaEventoNotificacao_(idEvento);
  if (!linha) return { ok: true, ignorado: true, motivo: 'EVENTO_NAO_ENCONTRADO' };
  const tipo = tipoRegistroEventoNotificacao_(linha);
  if (tipo !== 'evento' && tipo !== 'reuniao') {
    return { ok: true, ignorado: true, motivo: 'TIPO_NAO_ELEGIVEL', tipo: tipo };
  }
  const codigo = tipo === 'reuniao' ? 'REUNIAO_CRIADA_EDITADA' : 'EVENTO_CRIADO';
  const valores = montarValoresEventoNotificacao_(linha, {
    ACAO_REUNIAO: 'criada',
    RESUMO_ALTERACOES: 'Confira os detalhes na agenda.'
  });
  return enfileirarNotificacaoImediata_(codigo, {
    idEvento: idEvento,
    referencia: idEvento + '|CRIADO',
    tipoRegistro: String(linha[COL.TIPO_REGISTRO] || ''),
    motivoReuniao: motivoReuniaoLinhaNotificacao_(linha),
    valores: valores
  }, false);
}

function notificarEventoAlterado_(idEvento, alteracoesRecebidas) {
  const importantes = {
    dataEvento: true, dataFim: true, horaInicio: true, duracao: true,
    tipoEvento: true, projeto: true, idEndereco: true, local: true,
    nomeLocalEditado: true, look: true, somResponsavel: true,
    observacoes: true, motivo: true
  };
  const alteracoes = (Array.isArray(alteracoesRecebidas) ? alteracoesRecebidas : []).filter(function (a) {
    return a && importantes[String(a.campo || '')] === true &&
      String(a.de == null ? '' : a.de) !== String(a.para == null ? '' : a.para);
  });
  if (!alteracoes.length) return { ok: true, ignorado: true, motivo: 'SEM_CAMPO_IMPORTANTE' };
  const linha = buscarLinhaEventoNotificacao_(idEvento);
  if (!linha) return { ok: true, ignorado: true, motivo: 'EVENTO_NAO_ENCONTRADO' };
  const tipo = tipoRegistroEventoNotificacao_(linha);
  if (tipo !== 'evento' && tipo !== 'reuniao') {
    return { ok: true, ignorado: true, motivo: 'TIPO_NAO_ELEGIVEL', tipo: tipo };
  }
  const versao = linha[COL.ULTIMA_EDICAO] instanceof Date ? linha[COL.ULTIMA_EDICAO].getTime() : String(linha[COL.ULTIMA_EDICAO] || '');
  const valoresEvento = montarValoresEventoNotificacao_(linha);
  const codigo = tipo === 'reuniao' ? 'REUNIAO_CRIADA_EDITADA' : 'EVENTO_ALTERADO_IMPORTANTE';
  const valores = tipo === 'reuniao'
    ? Object.assign({}, valoresEvento, {
        ACAO_REUNIAO: 'atualizada',
        RESUMO_ALTERACOES: montarValoresAlteracaoNotificacao_(valoresEvento, alteracoes).RESUMO_ALTERACOES
      })
    : montarValoresAlteracaoNotificacao_(valoresEvento, alteracoes);
  return enfileirarNotificacaoImediata_(codigo, {
    idEvento: idEvento, referencia: idEvento + '|ALTERADO|' + versao,
    tipoRegistro: String(linha[COL.TIPO_REGISTRO] || ''),
    motivoReuniao: motivoReuniaoLinhaNotificacao_(linha),
    alteracoes: alteracoes,
    valores: valores
  }, tipo === 'evento');
}

function mesclarAlteracoesNotificacao_(anteriores, novas) {
  const ordem = [];
  const mapa = {};
  (anteriores || []).concat(novas || []).forEach(function (a) {
    const campo = String(a && a.campo || '');
    if (!campo) return;
    if (!mapa[campo]) {
      mapa[campo] = { campo: campo, de: a.de, para: a.para };
      ordem.push(campo);
    } else {
      mapa[campo].para = a.para;
    }
  });
  return ordem.map(function (campo) { return mapa[campo]; }).filter(function (a) {
    return String(a.de == null ? '' : a.de) !== String(a.para == null ? '' : a.para);
  });
}

function rotuloCampoAlteracaoNotificacao_(campo) {
  const rotulos = {
    dataEvento: 'Data', dataFim: 'Data final', horaInicio: 'Horário',
    duracao: 'Duração', tipoEvento: 'Tipo do evento', projeto: 'Formação',
    idEndereco: 'Local', local: 'Local', nomeLocalEditado: 'Local', look: 'Look',
    somResponsavel: 'Responsável pelo som', observacoes: 'Observações',
    motivo: 'Motivo'
  };
  return rotulos[String(campo || '')] || 'Informação';
}

function formatarValorAlteracaoNotificacao_(campo, valor) {
  const texto = String(valor == null ? '' : valor).trim();
  if (!texto) return 'não informado';
  if (campo === 'horaInicio') {
    const hora = texto.match(/T(\d{2}):(\d{2})/) || texto.match(/^(\d{1,2}):(\d{2})/);
    if (hora) return hora[1].padStart(2, '0') + ':' + hora[2];
  }
  if (campo === 'dataEvento' || campo === 'dataFim') {
    const data = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (data) return data[3] + '/' + data[2] + '/' + data[1];
  }
  return limitarTextoNotificacao_(texto, 48);
}

function montarValoresAlteracaoNotificacao_(valoresEvento, alteracoes) {
  const unicas = [];
  const rotulosVistos = {};
  (alteracoes || []).forEach(function (a) {
    const rotulo = rotuloCampoAlteracaoNotificacao_(a.campo);
    if (rotulosVistos[rotulo]) return;
    rotulosVistos[rotulo] = true;
    unicas.push(a);
  });
  let titulo = 'Evento atualizado';
  let resumo = '';
  if (unicas.length === 1) {
    const a = unicas[0];
    const rotulo = rotuloCampoAlteracaoNotificacao_(a.campo);
    titulo = rotulo + ' do evento alterado';
    resumo = rotulo + ': de ' +
      formatarValorAlteracaoNotificacao_(a.campo, a.de) + ' para ' +
      formatarValorAlteracaoNotificacao_(a.campo, a.para) + '.';
  } else {
    const nomes = unicas.map(function (a) {
      return rotuloCampoAlteracaoNotificacao_(a.campo).toLowerCase();
    });
    resumo = 'Alterações: ' + nomes.slice(0, 3).join(', ') +
      (nomes.length > 3 ? ' e mais ' + (nomes.length - 3) : '') + '.';
  }
  return Object.assign({}, valoresEvento || {}, {
    TITULO_ALTERACAO: titulo,
    RESUMO_ALTERACOES: resumo,
    CAMPOS_ALTERADOS: unicas.map(function (a) {
      return rotuloCampoAlteracaoNotificacao_(a.campo);
    }).join(', ')
  });
}

function notificarEventoCancelado_(idEvento) {
  const linha = buscarLinhaEventoNotificacao_(idEvento);
  if (!linha) return { ok: true, ignorado: true, motivo: 'EVENTO_NAO_ENCONTRADO' };
  const tipo = tipoRegistroEventoNotificacao_(linha);
  if (tipo !== 'evento' && tipo !== 'reuniao') {
    return { ok: true, ignorado: true, motivo: 'TIPO_NAO_ELEGIVEL', tipo: tipo };
  }
  const codigo = tipo === 'reuniao' ? 'REUNIAO_CRIADA_EDITADA' : 'EVENTO_CANCELADO';
  return enfileirarNotificacaoImediata_(codigo, {
    idEvento: idEvento,
    referencia: idEvento + '|CANCELADO',
    tipoRegistro: String(linha[COL.TIPO_REGISTRO] || ''),
    motivoReuniao: motivoReuniaoLinhaNotificacao_(linha),
    valores: montarValoresEventoNotificacao_(linha, {
      ACAO_REUNIAO: 'cancelada',
      RESUMO_ALTERACOES: 'Confira os detalhes na agenda.'
    })
  }, false);
}

function notificarFolhaEnviada_(payload) {
  const p = payload || {};
  const agenda = (p.Folhas_Custo && p.Folhas_Custo.agenda) || {};
  const idEvento = String(p.idEvento || p.idEventoAgenda || agenda.idEvento || '');
  return enfileirarNotificacaoImediata_('FOLHA_CUSTOS_ENVIADA', {
    idEvento: idEvento, referencia: String(p.id || p.idFolha || idEvento || Utilities.getUuid()),
    valores: { EVENTO: String(p.nomeEvento || p.eventoNome || p.evento || idEvento || 'Evento'),
      VALOR: formatarMoedaNotificacao_(p.valorTotal || p.totalGeral || p.valor || 0) }
  }, false);
}

function notificarFolhaAprovada_(resultado) {
  const r = resultado || {};
  return enfileirarNotificacaoImediata_('FOLHA_CUSTOS_DECISAO', {
    idEvento: r.idEvento, referencia: String(r.idFolha || r.idEvento) + '|APROVADO',
    valores: { EVENTO: String(r.idEvento || 'Evento'), STATUS: 'aprovada', MOTIVO: '' }
  }, false);
}

function processarLembretesEventoProximo() {
  if (!boolNotificacao_(obterConfig('NOTIFICACOES_LEMBRETES_HORARIO_ATIVO'), false)) {
    return { ok: true, ignorado: true, motivo: 'LEMBRETES_DESATIVADOS' };
  }
  const regra = obterRegraNotificacaoPorCodigo_('EVENTO_ANTECEDENCIA');
  if (!regra || !regra.ativo) return { ok: true, ignorado: true, motivo: 'REGRA_DESATIVADA' };
  const agora = new Date();
  const antecedencia = Math.max(1, Number(regra.antecedenciaMin || obterConfig('NOTIFICACOES_ANTECEDENCIA_EVENTO_MIN') || 60));
  // O ciclo roda a cada 30 minutos. A margem de 35 minutos tolera a pequena
  // variação natural dos gatilhos sem perder o lembrete; a deduplicação
  // garante no máximo um envio por aparelho e horário real do evento.
  const margem = 35;
  const eventos = listarLinhasEventosAtivosNotificacao_();
  let processados = 0;
  eventos.forEach(function (linha) {
    const instante = instanteRealEventoNotificacao_(linha);
    if (!instante) return;
    const faltam = (instante.getTime() - agora.getTime()) / 60000;
    if (faltam < antecedencia - margem || faltam > antecedencia + margem) return;
    despacharRegraNotificacao_('EVENTO_ANTECEDENCIA', {
      idEvento: linha[COL.ID_EVENTO],
      referencia: linha[COL.ID_EVENTO] + '|' + instante.getTime(),
      valores: montarValoresEventoNotificacao_(linha)
    });
    processados++;
  });
  return { ok: true, processados: processados };
}

function listarLinhasEventosAtivosNotificacao_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('EVENTOS');
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getDataRange().getValues().slice(1).filter(function (r) {
    return String(r[COL.TIPO_REGISTRO] || '') === 'Evento' &&
      String(r[COL.STATUS_GERAL] || 'ATIVO').toUpperCase() !== 'CANCELADO';
  });
}

function instanteRealEventoNotificacao_(linha) {
  const timezone = String(obterConfig('NOTIFICACOES_TIMEZONE') || 'America/Fortaleza');
  const data = formatarDataComercialNotificacao_(linha[COL.DATA_EVENTO], timezone);
  const hora = formatarHoraValorNotificacao_(linha[COL.HORA_INICIO]);
  const dm = data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const hm = hora.match(/^(\d{2}):(\d{2})$/);
  if (!dm || !hm) return null;
  const d = new Date(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]), Number(hm[1]), Number(hm[2]), 0, 0);
  const virada = Number(obterConfig('AGENDA_HORA_VIRADA_MADRUGADA') || 6);
  if (Number(hm[1]) < virada) d.setDate(d.getDate() + 1);
  return d;
}

function instanteTerminoEventoNotificacao_(linha) {
  const inicio = instanteRealEventoNotificacao_(linha);
  if (!inicio) return null;
  const duracaoMin = Math.max(0, Number(linha[COL.DURACAO] || 0));
  return new Date(inicio.getTime() + duracaoMin * 60000);
}

function marcoCadenciaRegraNotificacao_(regra, dias, padrao, repetirPadrao) {
  const valor = Math.floor(Number(dias));
  if (!isFinite(valor) || valor < 0) return '';
  const intervalos = regra && Array.isArray(regra.intervalosDias) && regra.intervalosDias.length
    ? regra.intervalosDias
    : (padrao || []);
  if (intervalos.indexOf(valor) !== -1) return 'DIA_' + valor;
  const repetir = regra && regra.repetirSemanal !== undefined
    ? regra.repetirSemanal
    : !!repetirPadrao;
  const base = intervalos.length ? Math.max.apply(null, intervalos) : 0;
  if (repetir && valor > base && (valor - base) % 7 === 0) return 'DIA_' + valor;
  return '';
}

function processarPendenciasMatinaisNotificacoes() {
  if (!boolNotificacao_(obterConfig('NOTIFICACOES_PENDENCIAS_MATINAIS_ATIVO'), false)) {
    return { ok: true, ignorado: true, motivo: 'PENDENCIAS_DESATIVADAS' };
  }
  PropertiesService.getScriptProperties().setProperty(
    'NOTIFICACOES_ULTIMA_PENDENCIA_EM',
    new Date().toISOString()
  );
  const agora = new Date();
  let processados = 0;
  listarLinhasEventosAtivosNotificacao_().forEach(function (linha) {
    const instante = instanteRealEventoNotificacao_(linha);
    const termino = instanteTerminoEventoNotificacao_(linha);
    if (!instante || !termino) return;
    const diasDesdeEvento = diasDesdeDataComercialNotificacao_(linha, agora);
    const id = String(linha[COL.ID_EVENTO] || '');
    const valores = montarValoresEventoNotificacao_(linha);
    const recebido = Number(linha[COL.VALOR_RECEBIDO] || 0);
    const pendente = Number(linha[COL.VALOR_PENDENTE] || 0);
    const total = Number(linha[COL.VALOR_TOTAL] || 0);

    if (instante > agora && pendente > 0) {
      const regraAntes = obterRegraNotificacaoPorCodigo_('EVENTO_SALDO_PENDENTE_ANTES');
      const diasAntes = Math.max(0, -diasDesdeEvento);
      const marcoAntes = marcoCadenciaRegraNotificacao_(regraAntes, diasAntes, [3, 1, 0], false);
      if (marcoAntes) {
        despacharRegraNotificacao_('EVENTO_SALDO_PENDENTE_ANTES', {
          idEvento: id, referencia: id + '|SALDO_ANTES|' + marcoAntes, valores: valores
        });
        processados++;
      }
      return;
    }
    if (termino >= agora) return;

    const regraSem = obterRegraNotificacaoPorCodigo_('EVENTO_REALIZADO_SEM_RECEBIMENTO');
    const regraParcial = obterRegraNotificacaoPorCodigo_('EVENTO_REALIZADO_PARCIAL');
    const marcoSem = marcoCadenciaRegraNotificacao_(regraSem, diasDesdeEvento, [1, 3], true);
    const marcoParcial = marcoCadenciaRegraNotificacao_(regraParcial, diasDesdeEvento, [1, 3], true);
    if (marcoSem && recebido <= 0 && total > 0) {
      despacharRegraNotificacao_('EVENTO_REALIZADO_SEM_RECEBIMENTO', {
        idEvento: id, referencia: id + '|SEM_RECEBIMENTO|' + marcoSem, valores: valores
      }); processados++;
    } else if (marcoParcial && pendente > 0) {
      despacharRegraNotificacao_('EVENTO_REALIZADO_PARCIAL', {
        idEvento: id, referencia: id + '|PARCIAL|' + marcoParcial, valores: valores
      }); processados++;
    }
    const regraFolha = obterRegraNotificacaoPorCodigo_('FOLHA_CUSTOS_PENDENTE');
    const marcoFolha = marcoCadenciaRegraNotificacao_(regraFolha, diasDesdeEvento, [1], false);
    if (marcoFolha && Number(linha[COL.FOLHA_CUSTO_VALOR] || 0) <= 0) {
      despacharRegraNotificacao_('FOLHA_CUSTOS_PENDENTE', {
        idEvento: id, referencia: id + '|FOLHA_PENDENTE|' + marcoFolha, valores: valores
      }); processados++;
    }
    if (diasDesdeEvento > 2) return;
    if (String(linha[COL.STATUS_RECEBIMENTO] || '').toUpperCase() === 'QUITADO') {
      if (Number(linha[COL.VALOR_BV] || 0) > 0 && String(linha[COL.STATUS_BV] || '').toUpperCase() !== 'PROCESSADO') {
        despacharRegraNotificacao_('QUITADO_BV_PENDENTE', {
          idEvento: id, referencia: id + '|BV_PENDENTE|' + dataHojeNotificacao_(), valores: Object.assign({ EVENTO: id }, valores)
        }); processados++;
      }
      if (boolNotificacao_(linha[COL.TEM_NF], false) && String(linha[COL.STATUS_NF] || '').toUpperCase() !== 'PROCESSADO') {
        despacharRegraNotificacao_('QUITADO_NF_PENDENTE', {
          idEvento: id, referencia: id + '|NF_PENDENTE|' + dataHojeNotificacao_(), valores: Object.assign({ EVENTO: id }, valores)
        }); processados++;
      }
    }
  });
  limparHistoricoNotificacoesExpirado_();
  return { ok: true, processados: processados };
}

function diasDesdeDataComercialNotificacao_(linha, agora) {
  const timezone = String(obterConfig('NOTIFICACOES_TIMEZONE') || 'America/Fortaleza');
  const dataEvento = formatarDataComercialNotificacao_(linha[COL.DATA_EVENTO], timezone);
  const partesEvento = dataEvento.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const hojeIso = Utilities.formatDate(agora || new Date(), timezone, 'yyyy-MM-dd');
  const partesHoje = hojeIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!partesEvento || !partesHoje) return -1;
  const eventoUtc = Date.UTC(Number(partesEvento[3]), Number(partesEvento[2]) - 1, Number(partesEvento[1]));
  const hojeUtc = Date.UTC(Number(partesHoje[1]), Number(partesHoje[2]) - 1, Number(partesHoje[3]));
  return Math.floor((hojeUtc - eventoUtc) / 86400000);
}

function dataHojeNotificacao_() {
  return Utilities.formatDate(new Date(), String(obterConfig('NOTIFICACOES_TIMEZONE') || 'America/Fortaleza'), 'yyyy-MM-dd');
}

function limparHistoricoNotificacoesExpirado_() {
  const dias = Math.max(30, Number(obterConfig('NOTIFICACOES_DIAS_RETER_HISTORICO') || 180));
  const limite = Date.now() - dias * 86400000;
  const sheet = obterAbaHistoricoNotificacoes_();
  if (sheet.getLastRow() < 2) return { ok: true, removidas: 0 };
  const dados = sheet.getRange(2, 1, sheet.getLastRow() - 1, 18).getValues();
  const manter = dados.filter(function (r) {
    const criada = r[16] instanceof Date ? r[16].getTime() : new Date(r[16]).getTime();
    return !criada || isNaN(criada) || criada >= limite;
  });
  const removidas = dados.length - manter.length;
  if (!removidas) return { ok: true, removidas: 0 };
  sheet.getRange(2, 1, dados.length, 18).clearContent();
  if (manter.length) sheet.getRange(2, 1, manter.length, 18).setValues(manter);
  return { ok: true, removidas: removidas };
}
