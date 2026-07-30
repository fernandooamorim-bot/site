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

function enfileirarNotificacoesEmLote_(itens) {
  const lista = Array.isArray(itens) ? itens : [];
  if (!lista.length) return { ok: true, enfileiradas: 0, duplicadas: 0 };
  const sheet = obterOuCriarFilaNotificacoes_();
  const existentes = {};
  if (sheet.getLastRow() >= 2) {
    sheet.getRange(2, 2, sheet.getLastRow() - 1, 3).getValues().forEach(function (r) {
      let ctx;
      try { ctx = JSON.parse(String(r[1] || '{}')); } catch (_) { return; }
      existentes[String(r[0] || '').toUpperCase() + '|' + String(ctx.referencia || '')] = true;
    });
  }
  const agora = new Date();
  const linhas = [];
  let duplicadas = 0;
  lista.forEach(function (item) {
    const codigo = String(item.codigo || '').toUpperCase();
    const contexto = item.contexto || {};
    const chave = codigo + '|' + String(contexto.referencia || '');
    if (existentes[chave]) { duplicadas++; return; }
    existentes[chave] = true;
    linhas.push([
      Utilities.getUuid(), codigo, JSON.stringify(contexto), 'PENDENTE', 0,
      agora, '', ''
    ]);
  });
  if (linhas.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, linhas.length, 8).setValues(linhas);
  }
  return { ok: true, enfileiradas: linhas.length, duplicadas: duplicadas };
}

function enfileirarAlteracaoEventoConsolidada_(codigoRecebido, contextoRecebido) {
  const codigo = String(codigoRecebido || 'EVENTO_ALTERADO_IMPORTANTE').toUpperCase();
  const contexto = contextoRecebido || {};
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
    const temProcessavel = dados.some(function (r) {
      if (idFilaAlvo && String(r[0] || '') !== String(idFilaAlvo)) return false;
      const status = String(r[3] || '').toUpperCase();
      return status !== 'ENVIADO' && status !== 'IGNORADO' &&
        Number(r[4] || 0) < maxTentativas;
    });
    if (!temProcessavel) return { ok: true, processadas: 0 };
    const regras = {};
    listarRegrasNotificacoes_().forEach(function (r) { regras[r.codigo] = r; });
    const recursos = {
      regras: regras,
      dispositivos: listarTodosDispositivosNotificacao_Interno_(),
      usuarios: listarUsuariosAtivosNotificacao_(),
      dedupeSet: obterChavesHistoricoNotificacoes_(),
      contextoTempo: criarContextoTempoNotificacao_(new Date()),
      eventosPorId: indexarEventosNotificacao_()
    };
    let descartadasVencidas = 0;
    const atualizacoesFila = dados.map(function (r) {
      return [r[3], r[4], r[5], r[6], r[7]];
    });
    dados.forEach(function (r, i) {
      if (idFilaAlvo && String(r[0] || '') !== String(idFilaAlvo)) return;
      const status = String(r[3] || '').toUpperCase();
      if (status === 'ENVIADO' || status === 'IGNORADO') return;
      let contexto;
      try { contexto = JSON.parse(String(r[2] || '{}')); } catch (_) { return; }
      const validacao = validarContextoTemporalFilaNotificacao_(
        String(r[1] || '').toUpperCase(), contexto, recursos
      );
      if (validacao.valido) return;
      atualizacoesFila[i] = [
        'IGNORADO', r[4], r[5] || new Date(), new Date(),
        String(validacao.motivo || 'FORA_JANELA_OPERACIONAL')
      ];
      dados[i][3] = 'IGNORADO';
      descartadasVencidas++;
    });
    if (descartadasVencidas) {
      sheet.getRange(2, 4, atualizacoesFila.length, 5).setValues(atualizacoesFila);
    }
    const inicio = Date.now();
    let processadas = 0;
    for (let i = 0; i < dados.length && processadas < 8 && Date.now() - inicio < 240000; i++) {
      if (idFilaAlvo && String(dados[i][0] || '') !== String(idFilaAlvo)) continue;
      const status = String(dados[i][3] || '').toUpperCase();
      const tentativas = Number(dados[i][4] || 0);
      if (status === 'ENVIADO' || status === 'IGNORADO' || tentativas >= maxTentativas) continue;
      try {
        const contexto = JSON.parse(String(dados[i][2] || '{}'));
        const resultado = despacharRegraNotificacao_(dados[i][1], contexto, recursos);
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
    return {
      ok: true, processadas: processadas,
      descartadasVencidas: descartadasVencidas
    };
  } finally {
    lock.releaseLock();
  }
}

function indexarEventosNotificacao_() {
  const mapa = {};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('EVENTOS');
  if (!sheet || sheet.getLastRow() < 2) return mapa;
  sheet.getDataRange().getValues().slice(1).forEach(function (linha) {
    const id = String(linha[COL.ID_EVENTO] || '').trim();
    if (id) mapa[id] = linha;
  });
  return mapa;
}

function marcoReferenciaNotificacao_(referencia) {
  const match = String(referencia || '').match(/\|DIA_(\d+)(?:\||$)/);
  return match ? Number(match[1]) : null;
}

function validarContextoTemporalFilaNotificacao_(codigo, contexto, recursos) {
  const temporais = {
    EVENTO_SALDO_PENDENTE_ANTES: true,
    EVENTO_REALIZADO_SEM_RECEBIMENTO: true,
    EVENTO_REALIZADO_PARCIAL: true,
    FOLHA_CUSTOS_PENDENTE: true
  };
  if (!temporais[codigo]) return { valido: true };
  const ctx = contexto || {};
  const linha = recursos.eventosPorId[String(ctx.idEvento || '')];
  if (!linha) return { valido: false, motivo: 'EVENTO_NAO_ENCONTRADO' };
  if (String(linha[COL.STATUS_GERAL] || 'ATIVO').toUpperCase() === 'CANCELADO') {
    return { valido: false, motivo: 'EVENTO_CANCELADO' };
  }
  const marco = marcoReferenciaNotificacao_(ctx.referencia);
  if (marco === null) return { valido: false, motivo: 'CADENCIA_INVALIDA' };
  const tempo = recursos.contextoTempo;
  const agora = tempo.agora;
  const inicioEvento = instanteRealEventoNotificacao_(linha, tempo);
  const terminoEvento = instanteTerminoEventoNotificacao_(linha, inicioEvento, tempo);
  const diasDesde = diasDesdeDataComercialNotificacao_(linha, agora, tempo);
  const recebido = Number(linha[COL.VALOR_RECEBIDO] || 0);
  const pendente = Number(linha[COL.VALOR_PENDENTE] || 0);
  const total = Number(linha[COL.VALOR_TOTAL] || 0);
  const statusRecebimento = String(linha[COL.STATUS_RECEBIMENTO] || '').trim().toUpperCase();
  const regraTemporal = recursos.regras && recursos.regras[codigo];
  const janelaMaxDias = normalizarJanelaMaximaNotificacao_(
    regraTemporal && regraTemporal.janelaMaxDias,
    codigo
  );

  if (codigo === 'EVENTO_SALDO_PENDENTE_ANTES') {
    const diasAntes = Math.max(0, -diasDesde);
    const dentroDaJanela = marco >= diasAntes && marco - diasAntes <= 1;
    return {
      valido: !!inicioEvento && inicioEvento > agora && dentroDaJanela &&
        statusRecebimento !== 'QUITADO' && pendente > 0,
      motivo: 'SALDO_ANTES_FORA_JANELA'
    };
  }

  const atraso = diasDesde - marco;
  const dentroDaJanelaPosterior = atraso >= 0 && atraso <= 1;
  if (!terminoEvento || terminoEvento >= agora || !dentroDaJanelaPosterior ||
      diasDesde > janelaMaxDias) {
    return { valido: false, motivo: 'POS_EVENTO_FORA_JANELA' };
  }
  if (codigo === 'EVENTO_REALIZADO_SEM_RECEBIMENTO') {
    return {
      valido: statusRecebimento !== 'QUITADO' && recebido <= 0 && total > 0,
      motivo: 'RECEBIMENTO_JA_REGULARIZADO'
    };
  }
  if (codigo === 'EVENTO_REALIZADO_PARCIAL') {
    return {
      valido: statusRecebimento !== 'QUITADO' && recebido > 0 && pendente > 0,
      motivo: 'RECEBIMENTO_JA_REGULARIZADO'
    };
  }
  return {
    valido: Number(linha[COL.FOLHA_CUSTO_VALOR] || 0) <= 0,
    motivo: 'FOLHA_JA_REGULARIZADA'
  };
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
  const inicioCiclo = Date.now();
  const tempos = {};
  function medir(etapa, fn) {
    const inicioEtapa = Date.now();
    const resultado = fn();
    tempos[etapa] = Date.now() - inicioEtapa;
    return resultado;
  }
  PropertiesService.getScriptProperties().setProperty(
    'NOTIFICACOES_ULTIMO_CICLO_EM',
    new Date().toISOString()
  );
  medir('limpezaGatilhosMs', function () {
    return executarNotificacaoSemBloquear_('LIMPEZA_GATILHOS_OBSOLETOS', function () {
      return removerGatilhosObsoletosNotificacao_();
    });
  });
  const fila = medir('filaMs', function () {
    return executarNotificacaoSemBloquear_('FILA', function () {
      return processarFilaNotificacoes();
    });
  });
  let lembretes = { ok: true, ignorado: true, motivo: 'LEMBRETES_DESATIVADOS' };
  if (boolNotificacao_(obterConfig('NOTIFICACOES_LEMBRETES_HORARIO_ATIVO'), false)) {
    lembretes = medir('lembretesMs', function () {
      return executarNotificacaoSemBloquear_('EVENTO_ANTECEDENCIA', function () {
        return processarLembretesEventoProximo();
      });
    });
  }
  const manutencaoDispositivos = medir('manutencaoDispositivosMs', function () {
    return executarNotificacaoSemBloquear_('MANUTENCAO_DISPOSITIVOS', function () {
      return executarManutencaoDispositivosSeNecessario_();
    });
  });
  tempos.totalMs = Date.now() - inicioCiclo;
  PropertiesService.getScriptProperties().setProperty(
    'NOTIFICACOES_ULTIMO_CICLO_RESULTADO',
    JSON.stringify({
      executadoEm: new Date().toISOString(),
      tempos: tempos,
      fila: fila,
      lembretes: lembretes,
      manutencaoDispositivos: manutencaoDispositivos
    })
  );
  return {
    ok: true, fila: fila, lembretes: lembretes,
    manutencaoDispositivos: manutencaoDispositivos, tempos: tempos
  };
}

function obterRegraNotificacaoPorCodigo_(codigo) {
  const alvo = String(codigo || '').trim().toUpperCase();
  let regra = listarRegrasNotificacoes_().filter(function (r) { return r.codigo === alvo; })[0] || null;
  if (!regra && (
      alvo === 'COMPROMISSO_CRIADO_EDITADO' ||
      alvo === 'COMPROMISSO_ANTECEDENCIA' ||
      alvo === 'REUNIAO_ANTECEDENCIA'
    ) &&
      typeof garantirRegrasAgendaComplementaresNotificacao_ === 'function') {
    garantirRegrasAgendaComplementaresNotificacao_();
    regra = listarRegrasNotificacoes_().filter(function (r) { return r.codigo === alvo; })[0] || null;
  }
  return regra;
}

function preferenciasDispositivoPermitemRegra_(d, codigo) {
  const c = String(codigo || '').toUpperCase();
  if (c.indexOf('FOLHA_CUSTOS') === 0) return d.folhaCustos !== false;
  if (c === 'EVENTO_CRIADO' || c === 'EVENTO_ALTERADO_IMPORTANTE' ||
      c === 'EVENTO_CANCELADO' || c === 'REUNIAO_CRIADA_EDITADA' ||
      c === 'RESERVA_CRIADA_EDITADA' || c === 'COMPROMISSO_CRIADO_EDITADO') {
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
  if (tipo === 'compromisso') {
    return typeof perfilPodeVerCompromissoAgenda_ === 'function'
      ? perfilPodeVerCompromissoAgenda_(p)
      : (p === 'Proprietário' || p === 'Administrador');
  }
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
  const termos = regra && regra.termosReuniao ? regra.termosReuniao : {};
  const p = normalizarPerfilNotificacao_(perfil);
  const itens = Array.isArray(filtro[p]) ? filtro[p] : [];
  if (itens.indexOf('*') !== -1) return true;
  const alvo = normalizarTextoFiltroNotificacao_(motivo);
  if (itens.some(function (item) {
    return normalizarTextoFiltroNotificacao_(item) === alvo;
  })) return true;
  const palavras = Array.isArray(termos[p]) ? termos[p] : [];
  return palavras.some(function (termo) {
    const normalizado = normalizarTextoFiltroNotificacao_(termo);
    // Termos excessivamente curtos geram falsos positivos (ex.: "a" casa com
    // praticamente qualquer motivo). O filtro por motivo exato continua livre.
    return normalizado.length >= 3 && alvo.indexOf(normalizado) !== -1;
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

function montarValoresEventoNotificacao_(linha, extras, contextoTempo) {
  const timezone = String(
    contextoTempo && contextoTempo.timezone ||
    obterConfig('NOTIFICACOES_TIMEZONE') ||
    'America/Fortaleza'
  );
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
  const opts = opcoes || {};
  const regra = opts.regra ||
    (opts.regras && opts.regras[String(codigo || '').toUpperCase()]) ||
    obterRegraNotificacaoPorCodigo_(codigo);
  if (!regra || !regra.ativo) return { ok: true, ignorado: true, motivo: 'REGRA_DESATIVADA' };

  const ctx = contexto || {};
  const valores = ctx.valores || {};
  const titulo = limitarTextoNotificacao_(
    aplicarTemplateNotificacao_(ctx.titulo || regra.titulo || regra.nome, valores),
    120
  );
  const mensagem = limitarTextoNotificacao_(
    aplicarTemplateNotificacao_(ctx.mensagem || regra.mensagem || regra.descricao, valores),
    420
  );
  const link = String(ctx.link || regra.linkDestino || './index.html?menu=1');
  const idEvento = String(ctx.idEvento || valores.ID_EVENTO || '');
  const referencia = String(ctx.referencia || idEvento || Utilities.getUuid());
  const modoTeste = boolNotificacao_(obterConfig('NOTIFICACOES_MODO_TESTE'), true);
  const emailTeste = String(obterConfig('NOTIFICACOES_DESTINATARIO_TESTE') || '').trim().toLowerCase();
  const emailRestrito = String(opts.emailRestrito || (modoTeste ? emailTeste : '')).trim().toLowerCase();
  const autorEmail = String(ctx.autorEmail || '').trim().toLowerCase();
  const dispositivos = (opts.dispositivos || listarTodosDispositivosNotificacao_Interno_()).filter(function (d) {
    if (!d.ativo || !preferenciasDispositivoPermitemRegra_(d, codigo)) return false;
    if (emailRestrito && d.email !== emailRestrito) return false;
    if (autorEmail && !regra.notificarAutor && d.email === autorEmail) return false;
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
      if (historicoNotificacaoPossuiChave_(dedupe, opts.dedupeSet)) { duplicados++; return; }
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
        if (opts.dedupeSet) opts.dedupeSet[dedupe] = true;
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
    (opts.usuarios || listarUsuariosAtivosNotificacao_()).forEach(function (u) {
      if (emailRestrito && u.email !== emailRestrito) return;
      if (autorEmail && !regra.notificarAutor && u.email === autorEmail) return;
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
      if (historicoNotificacaoPossuiChave_(dedupe, opts.dedupeSet)) { duplicados++; return; }
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
        if (opts.dedupeSet) opts.dedupeSet[dedupe] = true;
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

function obterPainelComunicadosNotificacao_(email) {
  return {
    ok: true,
    solicitante: String(email || '').trim().toLowerCase(),
    modoTeste: boolNotificacao_(obterConfig('NOTIFICACOES_MODO_TESTE'), true),
    emailAtivo: boolNotificacao_(obterConfig('NOTIFICACOES_EMAIL_ATIVO'), false),
    perfis: NOTIFICACOES_PERFIS_PERMITIDOS_.slice(),
    usuarios: obterCoberturaNotificacoes_().map(function (u) {
      return {
        email: u.email, nome: u.nome, perfil: u.perfil,
        aparelhosAtivos: u.aparelhosAtivos, status: u.status
      };
    })
  };
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
    ? enfileirarAlteracaoEventoConsolidada_(codigo, contexto)
    : enfileirarNotificacaoRegra_(codigo, contexto);
  const processamento = processarFilaNotificacoes(fila && fila.idFila);
  return {
    ok: true,
    enfileirada: true,
    idFila: fila && fila.idFila || '',
    processamento: processamento
  };
}

function notificarEventoCriado_(idEvento, autorEmail) {
  const linha = buscarLinhaEventoNotificacao_(idEvento);
  if (!linha) return { ok: true, ignorado: true, motivo: 'EVENTO_NAO_ENCONTRADO' };
  const tipo = tipoRegistroEventoNotificacao_(linha);
  if (tipo !== 'evento' && tipo !== 'reuniao' && tipo !== 'reserva' && tipo !== 'compromisso') {
    return { ok: true, ignorado: true, motivo: 'TIPO_NAO_ELEGIVEL', tipo: tipo };
  }
  const codigo = tipo === 'reuniao' ? 'REUNIAO_CRIADA_EDITADA'
    : tipo === 'reserva' ? 'RESERVA_CRIADA_EDITADA'
    : tipo === 'compromisso' ? 'COMPROMISSO_CRIADO_EDITADO'
    : 'EVENTO_CRIADO';
  const valores = montarValoresEventoNotificacao_(linha, {
    ACAO_REUNIAO: 'criada',
    ACAO_RESERVA: 'criada',
    ACAO_COMPROMISSO: 'criado',
    RESUMO_ALTERACOES: 'Confira os detalhes na agenda.'
  });
  return enfileirarNotificacaoImediata_(codigo, {
    idEvento: idEvento,
    referencia: idEvento + '|CRIADO',
    tipoRegistro: String(linha[COL.TIPO_REGISTRO] || ''),
    motivoReuniao: motivoReuniaoLinhaNotificacao_(linha),
    autorEmail: String(autorEmail || '').trim().toLowerCase(),
    valores: valores
  }, false);
}

function notificarEventoAlterado_(idEvento, alteracoesRecebidas, autorEmail) {
  const alteracoesOriginais = Array.isArray(alteracoesRecebidas) ? alteracoesRecebidas : [];
  const conversaoReserva = alteracoesOriginais.some(function (a) {
    return a && String(a.campo || '') === 'tipoRegistro' &&
      tipoRegistroEventoNotificacao_(a.de) === 'reserva' &&
      tipoRegistroEventoNotificacao_(a.para) === 'evento';
  });
  const importantes = {
    dataEvento: true, dataFim: true, horaInicio: true, duracao: true,
    tipoEvento: true, projeto: true, idEndereco: true, local: true,
    nomeLocalEditado: true, look: true, somResponsavel: true,
    observacoes: true, motivo: true
  };
  const alteracoes = alteracoesOriginais.filter(function (a) {
    return a && importantes[String(a.campo || '')] === true &&
      String(a.de == null ? '' : a.de) !== String(a.para == null ? '' : a.para);
  });
  if (!alteracoes.length && !conversaoReserva) {
    return { ok: true, ignorado: true, motivo: 'SEM_CAMPO_IMPORTANTE' };
  }
  const linha = buscarLinhaEventoNotificacao_(idEvento);
  if (!linha) return { ok: true, ignorado: true, motivo: 'EVENTO_NAO_ENCONTRADO' };
  const tipo = tipoRegistroEventoNotificacao_(linha);
  if (tipo !== 'evento' && tipo !== 'reuniao' && tipo !== 'reserva' &&
      tipo !== 'compromisso' && !conversaoReserva) {
    return { ok: true, ignorado: true, motivo: 'TIPO_NAO_ELEGIVEL', tipo: tipo };
  }
  const versao = linha[COL.ULTIMA_EDICAO] instanceof Date ? linha[COL.ULTIMA_EDICAO].getTime() : String(linha[COL.ULTIMA_EDICAO] || '');
  const valoresEvento = montarValoresEventoNotificacao_(linha);
  const codigo = conversaoReserva || tipo === 'reserva' ? 'RESERVA_CRIADA_EDITADA'
    : tipo === 'compromisso' ? 'COMPROMISSO_CRIADO_EDITADO'
    : tipo === 'reuniao' ? 'REUNIAO_CRIADA_EDITADA'
    : 'EVENTO_ALTERADO_IMPORTANTE';
  const valores = conversaoReserva
    ? Object.assign({}, valoresEvento, {
        ACAO_RESERVA: 'convertida em evento',
        RESUMO_ALTERACOES: 'A reserva foi confirmada como evento.'
      })
    : tipo === 'reserva'
    ? Object.assign({}, valoresEvento, {
        ACAO_RESERVA: 'atualizada',
        RESUMO_ALTERACOES: montarValoresAlteracaoNotificacao_(valoresEvento, alteracoes).RESUMO_ALTERACOES
      })
    : tipo === 'compromisso'
    ? Object.assign({}, valoresEvento, {
        ACAO_COMPROMISSO: 'atualizado',
        RESUMO_ALTERACOES: montarValoresAlteracaoNotificacao_(valoresEvento, alteracoes).RESUMO_ALTERACOES
      })
    : tipo === 'reuniao'
    ? Object.assign({}, valoresEvento, {
        ACAO_REUNIAO: 'atualizada',
        RESUMO_ALTERACOES: montarValoresAlteracaoNotificacao_(valoresEvento, alteracoes).RESUMO_ALTERACOES
      })
    : montarValoresAlteracaoNotificacao_(valoresEvento, alteracoes);
  return enfileirarNotificacaoImediata_(codigo, {
    idEvento: idEvento, referencia: idEvento + '|ALTERADO|' + versao,
    tipoRegistro: String(linha[COL.TIPO_REGISTRO] || ''),
    motivoReuniao: motivoReuniaoLinhaNotificacao_(linha),
    autorEmail: String(autorEmail || '').trim().toLowerCase(),
    alteracoes: alteracoes,
    valores: valores
  }, !conversaoReserva && (tipo === 'evento' || tipo === 'reserva' || tipo === 'compromisso'));
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

function notificarEventoCancelado_(idEvento, autorEmail) {
  const linha = buscarLinhaEventoNotificacao_(idEvento);
  if (!linha) return { ok: true, ignorado: true, motivo: 'EVENTO_NAO_ENCONTRADO' };
  const tipo = tipoRegistroEventoNotificacao_(linha);
  if (tipo !== 'evento' && tipo !== 'reuniao' && tipo !== 'reserva' && tipo !== 'compromisso') {
    return { ok: true, ignorado: true, motivo: 'TIPO_NAO_ELEGIVEL', tipo: tipo };
  }
  const codigo = tipo === 'reuniao' ? 'REUNIAO_CRIADA_EDITADA'
    : tipo === 'reserva' ? 'RESERVA_CRIADA_EDITADA'
    : tipo === 'compromisso' ? 'COMPROMISSO_CRIADO_EDITADO'
    : 'EVENTO_CANCELADO';
  return enfileirarNotificacaoImediata_(codigo, {
    idEvento: idEvento,
    referencia: idEvento + '|CANCELADO',
    tipoRegistro: String(linha[COL.TIPO_REGISTRO] || ''),
    motivoReuniao: motivoReuniaoLinhaNotificacao_(linha),
    autorEmail: String(autorEmail || '').trim().toLowerCase(),
    valores: montarValoresEventoNotificacao_(linha, {
      ACAO_REUNIAO: 'cancelada',
      ACAO_RESERVA: 'cancelada',
      ACAO_COMPROMISSO: 'cancelado',
      RESUMO_ALTERACOES: 'Confira os detalhes na agenda.'
    })
  }, false);
}

function notificarFolhaEnviada_(payload, autorEmail) {
  const p = payload || {};
  const agenda = (p.Folhas_Custo && p.Folhas_Custo.agenda) || {};
  const idEvento = String(p.idEvento || p.idEventoAgenda || agenda.idEvento || '');
  const totais = typeof extrairTotaisFolha_ === 'function'
    ? extrairTotaisFolha_(p)
    : {};
  const valorTotal = Number(
    totais.geral ||
    (p.totais && p.totais.geral) ||
    p.valorTotal ||
    p.totalGeral ||
    p.valor ||
    0
  ) || 0;
  return enfileirarNotificacaoImediata_('FOLHA_CUSTOS_ENVIADA', {
    idEvento: idEvento, referencia: String(p.id || p.idFolha || idEvento || Utilities.getUuid()),
    autorEmail: String(autorEmail || '').trim().toLowerCase(),
    valores: { EVENTO: String(p.nomeEvento || p.eventoNome || p.evento || idEvento || 'Evento'),
      VALOR: formatarMoedaNotificacao_(valorTotal) }
  }, false);
}

function notificarFolhaAprovada_(resultado, autorEmail) {
  const r = resultado || {};
  return enfileirarNotificacaoImediata_('FOLHA_CUSTOS_DECISAO', {
    idEvento: r.idEvento, referencia: String(r.idFolha || r.idEvento) + '|APROVADO',
    autorEmail: String(autorEmail || '').trim().toLowerCase(),
    valores: { EVENTO: String(r.idEvento || 'Evento'), STATUS: 'aprovada', MOTIVO: '' }
  }, false);
}

function processarLembretesEventoProximo() {
  if (!boolNotificacao_(obterConfig('NOTIFICACOES_LEMBRETES_HORARIO_ATIVO'), false)) {
    return { ok: true, ignorado: true, motivo: 'LEMBRETES_DESATIVADOS' };
  }
  const regrasPorTipo = {
    evento: {
      codigo: 'EVENTO_ANTECEDENCIA',
      regra: obterRegraNotificacaoPorCodigo_('EVENTO_ANTECEDENCIA')
    },
    compromisso: {
      codigo: 'COMPROMISSO_ANTECEDENCIA',
      regra: obterRegraNotificacaoPorCodigo_('COMPROMISSO_ANTECEDENCIA')
    },
    reuniao: {
      codigo: 'REUNIAO_ANTECEDENCIA',
      regra: obterRegraNotificacaoPorCodigo_('REUNIAO_ANTECEDENCIA')
    }
  };
  const algumaRegraAtiva = Object.keys(regrasPorTipo).some(function (tipo) {
    return regrasPorTipo[tipo].regra && regrasPorTipo[tipo].regra.ativo;
  });
  if (!algumaRegraAtiva) return { ok: true, ignorado: true, motivo: 'REGRAS_DESATIVADAS' };

  const agora = new Date();
  const contextoTempo = criarContextoTempoNotificacao_(agora);
  // O ciclo roda a cada 30 minutos. A margem de 35 minutos tolera a pequena
  // variação natural dos gatilhos sem perder o lembrete; a deduplicação
  // garante no máximo um envio por aparelho e horário real do evento.
  const margem = 35;
  const eventos = listarLinhasEventosAtivosNotificacao_();
  const recursosComuns = {
    dispositivos: listarTodosDispositivosNotificacao_Interno_(),
    usuarios: listarUsuariosAtivosNotificacao_(),
    dedupeSet: obterChavesHistoricoNotificacoes_()
  };
  let processados = 0;
  const processadosPorTipo = { evento: 0, compromisso: 0, reuniao: 0 };
  eventos.forEach(function (linha) {
    const tipo = tipoRegistroEventoNotificacao_(linha);
    const definicao = regrasPorTipo[tipo];
    if (!definicao || !definicao.regra || !definicao.regra.ativo) return;
    const antecedencia = Math.max(1, Number(
      definicao.regra.antecedenciaMin ||
      obterConfig('NOTIFICACOES_ANTECEDENCIA_EVENTO_MIN') ||
      60
    ));
    const instante = instanteRealEventoNotificacao_(linha, contextoTempo);
    if (!instante) return;
    const faltam = (instante.getTime() - agora.getTime()) / 60000;
    if (faltam < antecedencia - margem || faltam > antecedencia + margem) return;
    despacharRegraNotificacao_(definicao.codigo, {
      idEvento: linha[COL.ID_EVENTO],
      referencia: linha[COL.ID_EVENTO] + '|' + instante.getTime(),
      tipoRegistro: String(linha[COL.TIPO_REGISTRO] || ''),
      motivoReuniao: motivoReuniaoLinhaNotificacao_(linha),
      valores: montarValoresEventoNotificacao_(linha, null, contextoTempo)
    }, Object.assign({ regra: definicao.regra }, recursosComuns));
    processados++;
    processadosPorTipo[tipo]++;
  });
  return { ok: true, processados: processados, porTipo: processadosPorTipo };
}

function listarLinhasEventosAtivosNotificacao_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('EVENTOS');
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getDataRange().getValues().slice(1).filter(function (r) {
    const tipo = tipoRegistroEventoNotificacao_(r);
    const status = String(r[COL.STATUS_GERAL] || 'ATIVO').trim().toUpperCase();
    return (tipo === 'evento' || tipo === 'compromisso' || tipo === 'reuniao') &&
      status !== 'CANCELADO' && status !== 'ARQUIVADO';
  });
}

function criarContextoTempoNotificacao_(agora) {
  const timezone = String(obterConfig('NOTIFICACOES_TIMEZONE') || 'America/Fortaleza');
  const referencia = agora instanceof Date ? agora : new Date();
  const hojeIso = Utilities.formatDate(referencia, timezone, 'yyyy-MM-dd');
  const partesHoje = hojeIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return {
    timezone: timezone,
    viradaMadrugada: Number(obterConfig('AGENDA_HORA_VIRADA_MADRUGADA') || 6),
    agora: referencia,
    hojeIso: hojeIso,
    hojeUtc: partesHoje
      ? Date.UTC(Number(partesHoje[1]), Number(partesHoje[2]) - 1, Number(partesHoje[3]))
      : NaN
  };
}

function instanteRealEventoNotificacao_(linha, contextoTempo) {
  const contexto = contextoTempo || criarContextoTempoNotificacao_();
  const timezone = contexto.timezone;
  const data = formatarDataComercialNotificacao_(linha[COL.DATA_EVENTO], timezone);
  const hora = formatarHoraValorNotificacao_(linha[COL.HORA_INICIO]);
  const dm = data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const hm = hora.match(/^(\d{2}):(\d{2})$/);
  if (!dm || !hm) return null;
  const d = new Date(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]), Number(hm[1]), Number(hm[2]), 0, 0);
  const virada = contexto.viradaMadrugada;
  if (Number(hm[1]) < virada) d.setDate(d.getDate() + 1);
  return d;
}

function instanteTerminoEventoNotificacao_(linha, inicioCalculado, contextoTempo) {
  const inicio = inicioCalculado || instanteRealEventoNotificacao_(linha, contextoTempo);
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

function marcoCadenciaComRecuperacaoNotificacao_(regra, dias, padrao, repetirPadrao, contagemRegressiva) {
  const valor = Math.floor(Number(dias));
  if (!isFinite(valor) || valor < 0) return '';

  const exato = marcoCadenciaRegraNotificacao_(regra, valor, padrao, repetirPadrao);
  if (exato) return exato;

  const intervalos = (regra && Array.isArray(regra.intervalosDias) && regra.intervalosDias.length
    ? regra.intervalosDias
    : (padrao || []))
    .map(function (n) { return Math.floor(Number(n)); })
    .filter(function (n) { return isFinite(n) && n >= 0; });
  if (!intervalos.length) return '';

  if (contagemRegressiva) {
    const vencidos = intervalos.filter(function (n) { return n > valor; })
      .sort(function (a, b) { return a - b; });
    return vencidos.length && vencidos[0] - valor <= 1 ? 'DIA_' + vencidos[0] : '';
  }

  const repetir = regra && regra.repetirSemanal !== undefined
    ? regra.repetirSemanal
    : !!repetirPadrao;
  const base = Math.max.apply(null, intervalos);
  let ultimoMarco = intervalos.filter(function (n) { return n < valor; })
    .sort(function (a, b) { return b - a; })[0];
  if (repetir && valor > base) {
    const semanal = base + Math.floor((valor - base) / 7) * 7;
    if (semanal <= valor && (ultimoMarco === undefined || semanal > ultimoMarco)) {
      ultimoMarco = semanal;
    }
  }
  return ultimoMarco === undefined || valor - ultimoMarco > 1
    ? ''
    : 'DIA_' + ultimoMarco;
}

function processarPendenciasMatinaisNotificacoes() {
  if (!boolNotificacao_(obterConfig('NOTIFICACOES_PENDENCIAS_MATINAIS_ATIVO'), false)) {
    return { ok: true, ignorado: true, motivo: 'PENDENCIAS_DESATIVADAS' };
  }
  PropertiesService.getScriptProperties().setProperty(
    'NOTIFICACOES_ULTIMA_PENDENCIA_EM',
    new Date().toISOString()
  );
  const inicio = Date.now();
  const limiteSeguroMs = 240000;
  const agora = new Date();
  const contextoTempo = criarContextoTempoNotificacao_(agora);
  const diagnostico = {
    inicio: agora.toISOString(),
    etapa: 'INICIANDO',
    eventosLidos: 0,
    eventosAnalisados: 0,
    candidatas: 0,
    duracaoMs: 0
  };
  const properties = PropertiesService.getScriptProperties();
  function registrarEtapa(etapa) {
    diagnostico.etapa = etapa;
    diagnostico.duracaoMs = Date.now() - inicio;
    properties.setProperty(
      'NOTIFICACOES_PENDENCIA_DIAGNOSTICO',
      JSON.stringify(diagnostico)
    );
  }
  function tempoSeguroDisponivel() {
    return Date.now() - inicio < limiteSeguroMs;
  }
  registrarEtapa('CARREGANDO_REGRAS');
  const regras = {};
  listarRegrasNotificacoes_().forEach(function (r) { regras[r.codigo] = r; });
  const tarefas = [];
  function adicionar(codigo, contexto, prioridade) {
    const regra = regras[codigo];
    if (!regra || !regra.ativo) return;
    tarefas.push({ codigo: codigo, contexto: contexto, prioridade: prioridade || 99 });
  }
  registrarEtapa('CARREGANDO_EVENTOS');
  const eventos = listarLinhasEventosAtivosNotificacao_();
  diagnostico.eventosLidos = eventos.length;
  registrarEtapa('ANALISANDO_EVENTOS');
  for (let indice = 0; indice < eventos.length; indice++) {
    if (!tempoSeguroDisponivel()) {
      diagnostico.interrompidaComSeguranca = true;
      diagnostico.proximoIndice = indice;
      registrarEtapa('LIMITE_SEGURO_ATINGIDO');
      break;
    }
    const linha = eventos[indice];
    diagnostico.eventosAnalisados++;
    // Pendências financeiras e de folha pertencem exclusivamente a eventos
    // remunerados. Reuniões, reservas, bloqueios e compromissos nunca entram
    // nesta rotina, mesmo que contenham valores residuais em células antigas.
    if (tipoRegistroEventoNotificacao_(linha) !== 'evento') continue;
    const instante = instanteRealEventoNotificacao_(linha, contextoTempo);
    const termino = instanteTerminoEventoNotificacao_(linha, instante, contextoTempo);
    if (!instante || !termino) continue;
    const diasDesdeEvento = diasDesdeDataComercialNotificacao_(linha, agora, contextoTempo);
    const id = String(linha[COL.ID_EVENTO] || '');
    const valores = montarValoresEventoNotificacao_(linha, null, contextoTempo);
    const recebido = Number(linha[COL.VALOR_RECEBIDO] || 0);
    const pendente = Number(linha[COL.VALOR_PENDENTE] || 0);
    const total = Number(linha[COL.VALOR_TOTAL] || 0);
    const statusRecebimento = String(linha[COL.STATUS_RECEBIMENTO] || '').trim().toUpperCase();

    if (instante > agora && statusRecebimento !== 'QUITADO' && pendente > 0) {
      const regraAntes = regras.EVENTO_SALDO_PENDENTE_ANTES;
      const diasAntes = Math.max(0, -diasDesdeEvento);
      const marcoAntes = marcoCadenciaComRecuperacaoNotificacao_(
        regraAntes, diasAntes, [3, 1, 0], false, true
      );
      if (marcoAntes) {
        adicionar('EVENTO_SALDO_PENDENTE_ANTES', {
          idEvento: id, referencia: id + '|SALDO_ANTES|' + marcoAntes, valores: valores
        }, 2);
      }
      continue;
    }
    if (termino >= agora) continue;

    const regraSem = regras.EVENTO_REALIZADO_SEM_RECEBIMENTO;
    const regraParcial = regras.EVENTO_REALIZADO_PARCIAL;
    const janelaSem = normalizarJanelaMaximaNotificacao_(
      regraSem && regraSem.janelaMaxDias, 'EVENTO_REALIZADO_SEM_RECEBIMENTO'
    );
    const janelaParcial = normalizarJanelaMaximaNotificacao_(
      regraParcial && regraParcial.janelaMaxDias, 'EVENTO_REALIZADO_PARCIAL'
    );
    const marcoSem = diasDesdeEvento <= janelaSem
      ? marcoCadenciaComRecuperacaoNotificacao_(
        regraSem, diasDesdeEvento, [1, 3], true, false
      ) : '';
    const marcoParcial = diasDesdeEvento <= janelaParcial
      ? marcoCadenciaComRecuperacaoNotificacao_(
        regraParcial, diasDesdeEvento, [1, 3], true, false
      ) : '';
    if (statusRecebimento !== 'QUITADO' && marcoSem && recebido <= 0 && total > 0) {
      adicionar('EVENTO_REALIZADO_SEM_RECEBIMENTO', {
        idEvento: id, referencia: id + '|SEM_RECEBIMENTO|' + marcoSem, valores: valores
      }, 3);
    } else if (statusRecebimento !== 'QUITADO' && marcoParcial && recebido > 0 && pendente > 0) {
      adicionar('EVENTO_REALIZADO_PARCIAL', {
        idEvento: id, referencia: id + '|PARCIAL|' + marcoParcial, valores: valores
      }, 3);
    }
    const regraFolha = regras.FOLHA_CUSTOS_PENDENTE;
    const janelaFolha = normalizarJanelaMaximaNotificacao_(
      regraFolha && regraFolha.janelaMaxDias, 'FOLHA_CUSTOS_PENDENTE'
    );
    const marcoFolha = diasDesdeEvento <= janelaFolha
      ? marcoCadenciaComRecuperacaoNotificacao_(
        regraFolha, diasDesdeEvento, [1], false, false
      ) : '';
    if (marcoFolha && Number(linha[COL.FOLHA_CUSTO_VALOR] || 0) <= 0) {
      adicionar('FOLHA_CUSTOS_PENDENTE', {
        idEvento: id, referencia: id + '|FOLHA_PENDENTE|' + marcoFolha, valores: valores
      }, 1);
    }
    if (diasDesdeEvento > 2) continue;
    if (String(linha[COL.STATUS_RECEBIMENTO] || '').toUpperCase() === 'QUITADO') {
      if (Number(linha[COL.VALOR_BV] || 0) > 0 && String(linha[COL.STATUS_BV] || '').toUpperCase() !== 'PROCESSADO') {
        adicionar('QUITADO_BV_PENDENTE', {
          idEvento: id, referencia: id + '|BV_PENDENTE|' + dataHojeNotificacao_(), valores: Object.assign({ EVENTO: id }, valores)
        }, 4);
      }
      if (boolNotificacao_(linha[COL.TEM_NF], false) && String(linha[COL.STATUS_NF] || '').toUpperCase() !== 'PROCESSADO') {
        adicionar('QUITADO_NF_PENDENTE', {
          idEvento: id, referencia: id + '|NF_PENDENTE|' + dataHojeNotificacao_(), valores: Object.assign({ EVENTO: id }, valores)
        }, 4);
      }
    }
  }
  diagnostico.candidatas = tarefas.length;
  registrarEtapa('ENFILEIRANDO');
  tarefas.sort(function (a, b) { return a.prioridade - b.prioridade; });
  const fila = enfileirarNotificacoesEmLote_(tarefas);
  const resumo = {
    ok: true, candidatas: tarefas.length, enfileiradas: fila.enfileiradas,
    duplicadasFila: fila.duplicadas, duracaoMs: Date.now() - inicio
  };
  PropertiesService.getScriptProperties().setProperty(
    'NOTIFICACOES_ULTIMA_PENDENCIA_RESULTADO',
    JSON.stringify(resumo)
  );
  diagnostico.enfileiradas = fila.enfileiradas;
  diagnostico.duplicadasFila = fila.duplicadas;
  registrarEtapa('CONCLUIDO');
  return resumo;
}

function diasDesdeDataComercialNotificacao_(linha, agora, contextoTempo) {
  const contexto = contextoTempo || criarContextoTempoNotificacao_(agora);
  const timezone = contexto.timezone;
  const dataEvento = formatarDataComercialNotificacao_(linha[COL.DATA_EVENTO], timezone);
  const partesEvento = dataEvento.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!partesEvento || !isFinite(contexto.hojeUtc)) return -1;
  const eventoUtc = Date.UTC(Number(partesEvento[3]), Number(partesEvento[2]) - 1, Number(partesEvento[1]));
  return Math.floor((contexto.hojeUtc - eventoUtc) / 86400000);
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
