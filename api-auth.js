/**
 * ======================================================
 * API AUTH — AUTENTICAÇÃO + ACL (VERSÃO DEFINITIVA)
 * ======================================================
 * ✔ Frontend externo (GitHub Pages / Netlify)
 * ✔ OAuth Google ocorre SOMENTE no frontend
 * ✔ Backend autentica por EMAIL recebido
 * ✔ Fonte da verdade: Aba USUARIOS
 * ✔ ACL aplicado DENTRO das funções de negócio
 * ======================================================
 */

/**
 * ======================================================
 * ENTRYPOINT ÚNICO
 * ======================================================
 */
const AUTH_CONFIG = {
  GOOGLE_CLIENT_ID: '179346910046-ph0lma4i52sc9prtlkfdd63d82m350qj.apps.googleusercontent.com',
  SESSION_TTL_DIAS_PADRAO: 30
};

function doPost(e) {
  let action = '';
  let email = '';
  let emailAutenticado = '';
  let params = {};
  const requestId = 'REQ-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  const startedAt = Date.now();
  try {
    // ======================================================
    // 1. NORMALIZA ENTRADA (JSON OU FORM)
    // ======================================================
    params = {};

    const raw =
      e &&
      e.postData &&
      typeof e.postData.contents === 'string'
        ? e.postData.contents.trim()
        : '';

    if (raw && (raw.startsWith('{') || raw.startsWith('['))) {
      try {
        params = JSON.parse(raw);
      } catch (err) {
        params = {};
      }
    } else {
      params = e.parameter || {};
    }

// ======================================================
// WEBHOOK ASAAS
// ======================================================

if (raw && raw.startsWith('{')) {
  try {
    const possibleWebhook = JSON.parse(raw);

    if (
      possibleWebhook &&
      possibleWebhook.event &&
      possibleWebhook.payment &&
      String(possibleWebhook.event).startsWith('PAYMENT_')
    ) {
      return processarWebhookAsaas(e);
    }

  } catch (err) {}
}

    // ======================================================
    // WEBHOOK WOOVI — DETECÇÃO ANTES DE ACTION
    // ======================================================
    if (raw && raw.startsWith('{')) {
      try {
        const possibleWebhook = JSON.parse(raw);

        if (
          possibleWebhook &&
          possibleWebhook.event &&
          String(possibleWebhook.event).indexOf('OPENPIX') !== -1
        ) {
          return processarWebhookWoovi(e);
        }
      } catch (err) {
        // não é webhook, segue fluxo normal
      }
    }

    action = params.action;
    email  = params.email;

    // ======================================================
    // 2. VALIDAÇÃO MÍNIMA
    // ======================================================
    if (!action) {
      return json({ error: 'ACTION_REQUIRED' });
    }

    // ======================================================
    // 3. LOGIN
    // ======================================================
    if (action === 'verificarUsuario') {
      return verificarUsuario(params);
    }

    // ======================================================
    // 4. CONTEXTO GLOBAL (APÓS LOGIN)
    // ======================================================
    emailAutenticado = autenticarRequisicaoComSessao_(params);
    globalThis.REQUEST_EMAIL = emailAutenticado;

    if (action === 'atualizarPreferenciaPaginaInicial') {
      return json(atualizarPreferenciaPaginaInicial_(emailAutenticado, params.paginaInicial));
    }

    // ======================================================
    // 5. AGENDA
    // ======================================================
    if (action === 'listarEventos') {
      exigirAcao('eventos:listar');
      return json({
        ok: true,
        eventos: listarEventosPorUsuario(emailAutenticado, {
          incluirCancelados: paramBool_(params.incluirCancelados)
        })
      });
    }

    if (action === 'listarEventosBootstrap') {
      exigirAcao('eventos:listar');
      return json(
        Object.assign({ ok: true }, listarEventosBootstrap(emailAutenticado, {
          incluirCancelados: paramBool_(params.incluirCancelados)
        }))
      );
    }

    if (action === 'buscarEventosPorData') {
      exigirAcao('eventos:listar');
      return json(buscarEventosPorData(params.data));
    }

    if (action === 'obterAgendaSyncInfo') {
      exigirAcao('eventos:listar');
      return json(obterAgendaSyncInfo(emailAutenticado));
    }

    // ======================================================
    // 6. CONFIGURAÇÕES
    // ======================================================
    if (action === 'carregarConfiguracoes') return json(carregarConfiguracoesPublicas());
    if (action === 'listarDuracoesPadrao') return json(listarDuracoesPadrao());
    if (action === 'listarProjetosSugeridos') return json(listarProjetosSugeridos());
    if (action === 'listarTiposEvento') return json(listarTiposEvento());
    if (action === 'obterConfig') return json(obterConfigPublica(params.chave));
    if (action === 'obterPercentualNF') return json(obterPercentualNF());
    if (action === 'listarAclReadOnly') {
      exigirPerfilProprietario_();
      return json(listarAclReadOnly_());
    }
    if (action === 'listarConfigCatalogReadOnly') {
      exigirPerfilProprietario_();
      return json(listarConfigCatalogReadOnly_());
    }
    if (action === 'listarAtividadeSistemaReadOnly') {
      exigirPerfilProprietario_();
      return json(listarAtividadeSistemaReadOnly_(params));
    }
    if (action === 'obterStatusNotificacoes') {
      return json(obterStatusNotificacoes_(emailAutenticado, params));
    }
    if (action === 'registrarDispositivoNotificacao') {
      return json(registrarDispositivoNotificacao_(emailAutenticado, params));
    }
    if (action === 'removerDispositivoNotificacao') {
      return json(removerDispositivoNotificacao_(emailAutenticado, params));
    }
    if (action === 'atualizarPreferenciasNotificacao') {
      return json(atualizarPreferenciasNotificacao_(emailAutenticado, params));
    }
    if (action === 'enviarNotificacaoTeste') {
      exigirPerfilProprietario_();
      return json(enviarNotificacaoTeste_(emailAutenticado));
    }
    if (action === 'executarResumoEventosHojeTeste') {
      exigirPerfilProprietario_();
      return json(executarResumoEventosHojeTeste_(emailAutenticado));
    }
    if (action === 'atualizarAutomacaoResumoNotificacoes') {
      exigirPerfilProprietario_();
      return json(atualizarAutomacaoResumoNotificacoes_(emailAutenticado, params.ativa));
    }
    if (action === 'atualizarAutomacoesNotificacoes') {
      exigirPerfilProprietario_();
      return json(atualizarAutomacoesNotificacoes_(emailAutenticado, params));
    }
    if (action === 'enviarComunicadoManual') {
      exigirPerfilProprietario_();
      return json(enviarComunicadoManual_(emailAutenticado, params));
    }
    if (action === 'obterCentralNotificacoes') {
      exigirPerfilProprietario_();
      return json(obterCentralNotificacoes_(emailAutenticado));
    }
    if (action === 'gerenciarDispositivoNotificacao') {
      exigirPerfilProprietario_();
      return json(gerenciarDispositivoNotificacao_(emailAutenticado, params));
    }
    if (action === 'executarManutencaoDispositivosNotificacao') {
      exigirPerfilProprietario_();
      return json(executarManutencaoDispositivosSeNecessario_({ forcar: true }));
    }
    if (action === 'atualizarRegraNotificacao') {
      exigirPerfilProprietario_();
      return json(atualizarRegraNotificacao_(emailAutenticado, params));
    }
    if (action === 'atualizarConfigNotificacoes') {
      exigirPerfilProprietario_();
      return json(atualizarConfigNotificacoes_(emailAutenticado, params));
    }
    if (action === 'salvarConfiguracaoGlobalNotificacoes') {
      exigirPerfilProprietario_();
      return json(salvarConfiguracaoGlobalNotificacoes_(emailAutenticado, params));
    }

    // ======================================================
    // 7. LISTAGENS AUXILIARES
    // ======================================================
    if (action === 'listarVendedores') return json(listarVendedores());
    if (action === 'listarContratantes') return json(listarContratantes(params));
    if (action === 'listarCerimonialistas') return json(listarCerimonialistas(params));
    if (action === 'listarEnderecos') return json(listarEnderecos(params));
    if (action === 'listarParceirosBV') return json(listarParceirosBV(params));
    if (action === 'buscarContratantesVinculo') {
      exigirAcao('eventos:editar');
      return json(buscarContratantesVinculo(params));
    }
    if (action === 'buscarEnderecosVinculo') {
      exigirAcao('eventos:editar');
      return json(buscarEnderecosVinculo(params));
    }

    // ======================================================
    // 8. CADASTROS RÁPIDOS
    // ======================================================
    if (action === 'cadastrarContratanteRapido') {
      exigirAcao('eventos:criar');
      return json(cadastrarContratanteRapido(params));
    }

    if (action === 'cadastrarCerimonialistaRapido') {
      exigirAcao('eventos:criar');
      return json(cadastrarCerimonialistaRapido(params));
    }

    if (action === 'cadastrarEnderecoRapido') {
      exigirAcao('eventos:criar');
      return json(cadastrarEnderecoRapido(params));
    }

    if (action === 'cadastrarParceiroBVRapido') {
      exigirAcao('eventos:criar');
      return json(cadastrarParceiroBVRapido(params));
    }

    if (action === 'regularizarContratante') {
      exigirAcao('eventos:editar');
      return json(regularizarContratante(params));
    }

    if (action === 'regularizarLocal') {
      exigirAcao('eventos:editar');
      return json(regularizarLocal(params));
    }

    if (action === 'atualizarContratante') {
      exigirAcao('eventos:editar');
      return json(atualizarContratante(params));
    }

    if (action === 'obterContratantePorId') {
      exigirAcao('eventos:editar');
      return json(obterContratantePorId(params));
    }

    if (action === 'obterEnderecoPorId') {
      exigirAcao('eventos:editar');
      return json(obterEnderecoPorId(params));
    }

    if (action === 'atualizarEndereco') {
      exigirAcao('eventos:editar');
      return json(atualizarEndereco(params));
    }

    if (action === 'obterCerimonialistaPorId') {
      exigirAcao('eventos:editar');
      return json(obterCerimonialistaPorId(params));
    }

    if (action === 'atualizarCerimonialista') {
      exigirAcao('eventos:editar');
      return json(atualizarCerimonialista(params));
    }

    if (action === 'obterParceiroBVPorId') {
      exigirAcao('eventos:editar');
      return json(obterParceiroBVPorId(params));
    }

    if (action === 'atualizarParceiroBV') {
      exigirAcao('eventos:editar');
      return json(atualizarParceiroBV(params));
    }

    if (action === 'inativarCadastroMestre') {
      exigirAcao('eventos:editar');
      return json(inativarCadastroMestre(params));
    }

    if (action === 'reativarCadastroMestre') {
      exigirAcao('eventos:editar');
      return json(reativarCadastroMestre(params));
    }

    // ======================================================
    // 9. CRIAÇÃO DE EVENTO
    // ======================================================
    if (action === 'criarEvento') {
      exigirAcao('eventos:criar');
      const resultadoCriacao = criarEvento(params, emailAutenticado);
      if (resultadoCriacao && resultadoCriacao.sucesso && resultadoCriacao.idEvento) {
        executarNotificacaoSemBloquear_('EVENTO_CRIADO', function () {
          return notificarEventoCriado_(resultadoCriacao.idEvento);
        });
      }
      return json(resultadoCriacao);
    }

    // ======================================================
    // 10. EDIÇÃO DE EVENTO — FRONTEND EXTERNO
    // ======================================================

    if (action === 'buscarEventoParaEdicao') {
      exigirAcao('eventos:editar');
      return json(buscarEventoParaEdicao(params.idEvento));
    }

    if (action === 'buscarEventoPorID') {
      exigirAcao('eventos:editar');
      return json(buscarEventoPorID(params.idEvento));
    }

    if (action === 'buscarEventoPorContratante') {
      exigirAcao('eventos:editar');
      return json(buscarEventoPorContratante(params.nome));
    }

    if (action === 'buscarEventoPorData') {
  exigirAcao('eventos:editar');
  return json(buscarEventoPorData(params.data));
}

function paramBool_(v) {
  if (v === true || v === 1) return true;
  const s = String(v || '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'sim' || s === 'yes' || s === 'on';
}

    if (action === 'buscarEventoPorPeriodo') {
      exigirAcao('eventos:editar');
      return json(buscarEventoPorPeriodo(params.periodo));
    }

    if (action === 'verificarPermissaoEdicaoFinanceira') {
      exigirAcao('eventos:editar');
      return json(verificarPermissaoEdicaoFinanceira(params.idEvento));
    }

    if (action === 'validarAlteracoesEvento') {
      exigirAcao('eventos:editar');
      return json(validarAlteracoesEvento(params.idEvento, params));
    }

    if (action === 'salvarEdicaoEvento') {
      exigirAcao('eventos:editar');
      const resultadoEdicao = salvarEdicaoEvento(params.idEvento, params, emailAutenticado);
      if (resultadoEdicao && resultadoEdicao.sucesso) {
        executarNotificacaoSemBloquear_('EVENTO_ALTERADO_IMPORTANTE', function () {
          return notificarEventoAlterado_(
            params.idEvento,
            resultadoEdicao.alteracoes || []
          );
        });
      }
      return json(resultadoEdicao);
    }

    if (action === 'cancelarEvento') {
      exigirAcao('eventos:cancelar');
      const resultadoCancelamento = cancelarEvento(params.idEvento, params.motivo || '');
      if (resultadoCancelamento && resultadoCancelamento.sucesso && !resultadoCancelamento.jaCancelado) {
        executarNotificacaoSemBloquear_('EVENTO_CANCELADO', function () {
          return notificarEventoCancelado_(params.idEvento);
        });
      }
      return json(resultadoCancelamento);
    }

    // ======================================================
// 11. FINANCEIRO — CENTRAL FINANCEIRA
// ======================================================

if (action === 'buscarResumoFinanceiroEvento') {
  exigirAcao('eventos:visualizarFinanceiro');
  return json(buscarResumoFinanceiroEvento(params.idEvento));
}

if (action === 'listarRecebimentosPorEvento') {
  exigirAcao('eventos:visualizarFinanceiro');
  return json(listarRecebimentosPorEvento(params.idEvento));
}

if (action === 'financeiroGarantirVinculoContratanteEvento') {
  exigirAcao('eventos:registrarRecebimento');
  return json(financeiroGarantirVinculoContratanteEvento(params));
}

if (action === 'apiRegistrarRecebimento') {
  exigirAcao('eventos:registrarRecebimento');
  return json(
    executarComIdempotenciaFinanceira_(
      { action: action, email: emailAutenticado, params: params },
      function () {
        return apiRegistrarRecebimento(params);
      }
    )
  );
}

if (action === 'apiEstornarRecebimento') {
  exigirAcao('eventos:estornarRecebimento');
  return json(
    executarComIdempotenciaFinanceira_(
      { action: action, email: emailAutenticado, params: params },
      function () {
        return apiEstornarRecebimento(params);
      }
    )
  );
}

if (action === 'apiRegistrarSaidaEvento') {
  const tipoSaida = String(params.tipoSaida || '').trim();
  const usuarioSaida = getUsuarioAtual();
  const processamentoAutoFiscal = paramBool_(params.autoFiscalizacao);
  if (
    tipoSaida === 'BV_EVENTO' &&
    processamentoAutoFiscal &&
    String((usuarioSaida && usuarioSaida.PERFIL) || '') !== 'Proprietário'
  ) {
    throw new Error('FORBIDDEN_ACTION: eventos:processarBVAutoFiscalizacao');
  }
  if (tipoSaida === 'BV_EVENTO') {
    requirePermission(usuarioSaida, 'eventos:registrarSaidaBV');
  } else {
    requirePermission(usuarioSaida, 'eventos:registrarSaida');
  }
  return json(
    executarComIdempotenciaFinanceira_(
      { action: action, email: emailAutenticado, params: params },
      function () {
        const resultadoSaida = apiRegistrarSaidaEvento(params);
        if (tipoSaida === 'FOLHA_EVENTO' && resultadoSaida && resultadoSaida.sucesso) {
          limparCacheFolhaCustoAprovacao_(params.idEvento);
        }
        return resultadoSaida;
      }
    )
  );
}

if (action === 'apiUploadComprovante') {
  // Upload de comprovante é usado nas operações financeiras da Central.
  const categoriaComprovante = String(params.categoria || '').toUpperCase().trim();
  if (categoriaComprovante === 'SAIDA_EVENTO') {
    try {
      exigirAcao('eventos:registrarSaidaBV');
    } catch (err) {
      exigirAcao('eventos:registrarSaida');
    }
  } else if (categoriaComprovante === 'FECHAMENTO_COMISSAO') {
    exigirAcao('comissao:fechar');
  } else {
    exigirAcao('eventos:registrarRecebimento');
  }
  return json(apiUploadComprovante(params));
}

if (action === 'visualizarPreviewFechamento') {
  exigirAcao('comissao:fechar');
  return json(visualizarPreviewFechamento(params.idVendedor));
}

if (action === 'fecharComissaoVendedor') {
  exigirAcao('comissao:fechar');
  const ajusteCredito = Number(params.ajusteCredito);
  const ajusteDebito = Number(params.ajusteDebito);
  let ajustesDetalhados = [];
  try {
    const rawAjustes = String(params.ajustesDetalhadosJson || '').trim();
    ajustesDetalhados = rawAjustes ? JSON.parse(rawAjustes) : [];
  } catch (_) {
    ajustesDetalhados = [];
  }

  return json(
    executarComIdempotenciaFinanceira_(
      { action: action, email: emailAutenticado, params: params },
      function () {
        return fecharComissaoVendedor(
          params.idVendedor,
          null,
          null,
          isNaN(ajusteCredito) ? 0 : ajusteCredito,
          isNaN(ajusteDebito) ? 0 : ajusteDebito,
          params.linkComprovante || '',
          ajustesDetalhados
        );
      }
    )
  );
}

if (action === 'regerarPdfFechamentoComissao') {
  exigirAcao('comissao:fechar');
  return json(regerarPdfFechamentoComissao(params.idFechamento));
}

if (action === 'listarEventosFinanceiros') {
  exigirAcao('eventos:visualizarFinanceiro');
  return json(listarEventosFinanceiros());
}

if (action === 'pixAsaasCriarCobranca') {
  const usuario = exigirAcao('eventos:visualizarFinanceiro');
  const perfilNorm = String((usuario && usuario.PERFIL) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (perfilNorm !== 'proprietario') {
    throw new Error('FORBIDDEN_ACTION: pixAsaas:criarCobranca');
  }
  return json(pixAsaasCriarCobranca(params, emailAutenticado));
}

if (action === 'pixAsaasCriarPlanoParcelado') {
  const usuario = exigirAcao('eventos:visualizarFinanceiro');
  const perfilNorm = String((usuario && usuario.PERFIL) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (perfilNorm !== 'proprietario') {
    throw new Error('FORBIDDEN_ACTION: pixAsaas:criarPlanoParcelado');
  }
  return json(pixAsaasCriarPlanoParcelado(params, emailAutenticado));
}

if (action === 'pixAsaasConsultarCobranca') {
  const usuario = exigirAcao('eventos:visualizarFinanceiro');
  const perfilNorm = String((usuario && usuario.PERFIL) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (perfilNorm !== 'proprietario') {
    throw new Error('FORBIDDEN_ACTION: pixAsaas:consultarCobranca');
  }
  return json(pixAsaasConsultarCobranca(params));
}

if (action === 'pixAsaasCancelarCobranca') {
  const usuario = exigirAcao('eventos:visualizarFinanceiro');
  const perfilNorm = String((usuario && usuario.PERFIL) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (perfilNorm !== 'proprietario') {
    throw new Error('FORBIDDEN_ACTION: pixAsaas:cancelarCobranca');
  }
  return json(pixAsaasCancelarCobranca(params, emailAutenticado));
}

if (action === 'pixAsaasListarCobrancasEvento') {
  const usuario = exigirAcao('eventos:visualizarFinanceiro');
  const perfilNorm = String((usuario && usuario.PERFIL) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (perfilNorm !== 'proprietario') {
    throw new Error('FORBIDDEN_ACTION: pixAsaas:listarCobrancasEvento');
  }
  return json(pixAsaasListarCobrancasEvento(params));
}

if (action === 'pixAsaasObterContatoEvento') {
  const usuario = exigirAcao('eventos:visualizarFinanceiro');
  const perfilNorm = String((usuario && usuario.PERFIL) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (perfilNorm !== 'proprietario') {
    throw new Error('FORBIDDEN_ACTION: pixAsaas:obterContatoEvento');
  }
  return json(pixAsaasObterContatoEvento(params));
}

if (action === 'pixAsaasAtualizarContatoEvento') {
  const usuario = exigirAcao('eventos:visualizarFinanceiro');
  const perfilNorm = String((usuario && usuario.PERFIL) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (perfilNorm !== 'proprietario') {
    throw new Error('FORBIDDEN_ACTION: pixAsaas:atualizarContatoEvento');
  }
  return json(pixAsaasAtualizarContatoEvento(params, emailAutenticado));
}

if (action === 'pixAsaasReconciliar') {
  const usuario = exigirAcao('eventos:visualizarFinanceiro');
  const perfilNorm = String((usuario && usuario.PERFIL) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (perfilNorm !== 'proprietario') {
    throw new Error('FORBIDDEN_ACTION: pixAsaas:reconciliar');
  }
  return json(pixAsaasReconciliar(params, emailAutenticado));
}

if (action === 'pixAsaasConfigurarReconciliacao') {
  const usuario = exigirAcao('eventos:visualizarFinanceiro');
  const perfilNorm = String((usuario && usuario.PERFIL) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (perfilNorm !== 'proprietario') {
    throw new Error('FORBIDDEN_ACTION: pixAsaas:configurarReconciliacao');
  }
  return json(pixAsaasConfigurarReconciliacao(params, emailAutenticado));
}

if (action === 'obterDashboardGestao') {
  exigirAcao('eventos:visualizarFinanceiro');
  return json(obterDashboardGestao(params));
}

if (action === 'obterMetaAnualDashboard') {
  const usuario = exigirAcao('eventos:visualizarFinanceiro');
  const bruto = obterConfig('DASHBOARD_META_ANUAL_PCT');
  const valor = Number(bruto);
  const metaPct = Number.isFinite(valor) ? Math.max(0, Math.min(200, valor)) : 30;
  const perfil = String(usuario?.PERFIL || '');
  const podeEditar = perfil === 'Proprietário';
  return json({ sucesso: true, metaPct: metaPct, podeEditar: podeEditar });
}

if (action === 'atualizarMetaAnualDashboard') {
  const usuario = exigirAcao('eventos:visualizarFinanceiro');
  if (String(usuario?.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: dashboard:metaAnual:editar');
  }
  const metaPct = Number(params?.metaPct);
  if (!Number.isFinite(metaPct)) {
    throw new Error('INVALID_META_PCT');
  }
  const safe = Math.max(0, Math.min(200, Math.round(metaPct)));
  let ok = setConfig('DASHBOARD_META_ANUAL_PCT', safe);
  if (!ok) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('CONFIG');
    if (!sh) throw new Error('CONFIG_SHEET_NOT_FOUND');
    sh.appendRow(['DASHBOARD_META_ANUAL_PCT', safe, 'Percentual da meta anual do dashboard sobre vendido do ano anterior (%)']);
    ok = true;
  }
  return json({ sucesso: true, metaPct: safe });
}

if (action === 'diagnosticarIntegridadeFinanceira') {
  exigirAcao('eventos:visualizarFinanceiro');
  return json(diagnosticarIntegridadeFinanceira(params));
}

if (action === 'reconciliarResumoFinanceiroEvento') {
  const usuario = exigirAcao('eventos:editar');
  if (String(usuario.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: eventos:reconciliarFinanceiro');
  }
  return json(reconciliarResumoFinanceiroEvento(params.idEvento));
}

if (action === 'migrarSaldoInicialFinanceiro') {
  const usuario = exigirAcao('financeiro:migrarSaldoInicial');
  if (String(usuario.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: financeiro:migrarSaldoInicial');
  }
  return json(migrarSaldoInicialFinanceiro(params));
}

if (action === 'auditarSaldoInicialFinanceiro') {
  const usuario = exigirAcao('financeiro:migrarSaldoInicial');
  if (String(usuario.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: financeiro:migrarSaldoInicial');
  }
  return json(auditarSaldoInicialFinanceiro(params));
}

if (action === 'reconciliarMovimentacoesSaldoInicialPosAuditoria') {
  const usuario = exigirAcao('financeiro:migrarSaldoInicial');
  if (String(usuario.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: financeiro:migrarSaldoInicial');
  }
  return json(reconciliarMovimentacoesSaldoInicialPosAuditoria(params));
}

if (action === 'auditarSaidasLegado2025') {
  const usuario = exigirAcao('financeiro:migrarSaldoInicial');
  if (String(usuario.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: financeiro:migrarSaldoInicial');
  }
  return json(auditarSaidasLegado2025(params));
}

if (action === 'migrarSaidasLegadoNfFolha2025') {
  const usuario = exigirAcao('financeiro:migrarSaldoInicial');
  if (String(usuario.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: financeiro:migrarSaldoInicial');
  }
  return json(migrarSaidasLegadoNfFolha2025(params));
}

if (action === 'auditarBvLegado2025a2027') {
  const usuario = exigirAcao('financeiro:migrarSaldoInicial');
  if (String(usuario.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: financeiro:migrarSaldoInicial');
  }
  return json(auditarBvLegado2025a2027(params));
}

if (action === 'migrarBvLegado2025a2027') {
  const usuario = exigirAcao('financeiro:migrarSaldoInicial');
  if (String(usuario.PERFIL || '') !== 'Proprietário') {
    throw new Error('FORBIDDEN_ACTION: financeiro:migrarSaldoInicial');
  }
  return json(migrarBvLegado2025a2027(params));
}

// ======================================================
// 12. AGENDA SEMANAL (WHATSAPP)
// ======================================================
if (action === 'carregarAgendaSemanalPreview') {
  exigirAcao('agenda:gerarSemanal');
  return json(carregarAgendaSemanalPreview(params));
}

if (action === 'gerarTextoAgendaSemanal') {
  exigirAcao('agenda:gerarSemanal');
  let eventos = [];
  try {
    const eventosJson = String(params.eventosJson || '').trim();
    eventos = eventosJson ? JSON.parse(eventosJson) : [];
  } catch (_) {
    eventos = [];
  }
  return json(gerarTextoAgendaSemanal({
    dataInicio: params.dataInicio,
    dataFim: params.dataFim,
    eventos: eventos,
    incluirLinksCalendario: params.incluirLinksCalendario,
    baseUrlCalendario: params.baseUrlCalendario,
    lembreteCalendarioMinutos: params.lembreteCalendarioMinutos
  }));
}

// ======================================================
// 13. ORÇAMENTO (UTILITÁRIO EXTERNO INTEGRADO)
// ======================================================
if (action === 'gerarOrcamentoInterno') {
  exigirAcao('orcamento:gerar');
  return json(gerarOrcamentoInterno(params, emailAutenticado));
}

// ======================================================
// 14. FOLHA DE CUSTOS (UTILITÁRIO EXTERNO INTEGRADO)
// ======================================================
if (action === 'folhaCustosProxy') {
  const usuario = exigirAcao('eventos:listar');
  const perfilNorm = String((usuario && usuario.PERFIL) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  const permitido = (
    perfilNorm === 'proprietario' ||
    perfilNorm === 'producao'
  );
  if (!permitido) {
    throw new Error('FORBIDDEN_ACTION: folhaCustos:acessar');
  }
  const resultadoFolhaProxy = folhaCustosProxy(params, emailAutenticado);
  if (resultadoFolhaProxy && resultadoFolhaProxy.sucesso &&
      String(params.externalAction || '') === 'salvarFolhaCusto') {
    const payloadFolhaSalva = extrairPayloadFolhaCustos_(params);
    const dadosFolhaSalva = payloadFolhaSalva.data && typeof payloadFolhaSalva.data === 'object'
      ? payloadFolhaSalva.data
      : payloadFolhaSalva;
    const metaFolhaSalva = extrairMetaAgendaFolha_(dadosFolhaSalva);
    limparCacheFolhaCustoAprovacao_(
      String((metaFolhaSalva && metaFolhaSalva.idEvento) || dadosFolhaSalva.idEvento || dadosFolhaSalva.idEventoAgenda || '').trim()
    );
    executarNotificacaoSemBloquear_('FOLHA_CUSTOS_ENVIADA', function () {
      const folhaEnviada = dadosFolhaSalva;
      if (String(folhaEnviada.statusAprovacao || '').toUpperCase().indexOf('PENDENTE') !== -1) {
        return notificarFolhaEnviada_(folhaEnviada);
      }
      return { ok: true, ignorado: true };
    });
  }
  return json(resultadoFolhaProxy);
}

if (action === 'listarPendenciasFolhaCustoAprovacao') {
  const usuario = exigirAcao('eventos:visualizarFinanceiro');
  const perfilNorm = String((usuario && usuario.PERFIL) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (!(perfilNorm === 'proprietario' || perfilNorm === 'socio' || perfilNorm === 'administrador' || perfilNorm === 'admin')) {
    throw new Error('FORBIDDEN_ACTION: folhaCustos:listarPendencias');
  }
  return json(listarPendenciasFolhaCustoAprovacao(params, emailAutenticado));
}

if (action === 'aprovarPendenciaFolhaCusto') {
  const usuario = exigirAcao('eventos:registrarSaida');
  const perfilNorm = String((usuario && usuario.PERFIL) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (perfilNorm !== 'proprietario') {
    throw new Error('FORBIDDEN_ACTION: folhaCustos:aprovar');
  }
  return json(
    executarComIdempotenciaFinanceira_(
      { action: action, email: emailAutenticado, params: params },
      function () {
        const resultadoAprovacaoFolha = aprovarPendenciaFolhaCusto(params, emailAutenticado);
        if (resultadoAprovacaoFolha && resultadoAprovacaoFolha.sucesso) {
          executarNotificacaoSemBloquear_('FOLHA_CUSTOS_DECISAO', function () {
            return notificarFolhaAprovada_(resultadoAprovacaoFolha);
          });
        }
        return resultadoAprovacaoFolha;
      }
    )
  );
}

// ======================================================
// 15. PRECIFICADOR DE SHOW (UTILITÁRIO EXTERNO INTEGRADO)
// ======================================================
if (action === 'precificadorShowProxy') {
  const usuario = exigirAcao('eventos:visualizarFinanceiro');
  const perfilNorm = String((usuario && usuario.PERFIL) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  const permitido = (
    perfilNorm === 'proprietario' ||
    perfilNorm === 'administrador' ||
    perfilNorm === 'admin' ||
    perfilNorm === 'socio'
  );
  if (!permitido) {
    throw new Error('FORBIDDEN_ACTION: precificadorShow:acessar');
  }
  return json(precificadorShowProxy(params, emailAutenticado));
}

    // ======================================================
    // FALLBACK
    // ======================================================
    return json({ error: 'AÇÃO_INVALIDA', action });

  } catch (err) {
  const msg = String(err.message || err);
  const stack = err && err.stack ? String(err.stack) : '';

  let codigo = 'ERRO_INTERNO';
  let mensagem = 'Ocorreu um erro inesperado.';

  if (msg.startsWith('FORBIDDEN_ACTION')) {
    codigo = 'SEM_PERMISSAO';
    mensagem = 'Você não tem permissão para executar esta ação.';
  }

  if (msg === 'USER_NOT_FOUND') {
    codigo = 'USUARIO_NAO_ENCONTRADO';
    mensagem = 'Usuário não encontrado.';
  }

  if (msg === 'USER_INACTIVE') {
    codigo = 'USUARIO_INATIVO';
    mensagem = 'Usuário inativo no sistema.';
  }

  if (msg === 'EMAIL_NOT_IN_REQUEST') {
    codigo = 'SESSAO_INVALIDA';
    mensagem = 'Sessão inválida. Faça login novamente.';
  }

  if (msg === 'SESSION_TOKEN_REQUIRED') {
    codigo = 'SESSAO_INVALIDA';
    mensagem = 'Sessão ausente. Faça login novamente.';
  }

  if (msg === 'SESSION_TOKEN_INVALID') {
    codigo = 'SESSAO_INVALIDA';
    mensagem = 'Sessão inválida. Faça login novamente.';
  }

  if (msg === 'SESSION_TOKEN_EXPIRED') {
    codigo = 'SESSAO_EXPIRADA';
    mensagem = 'Sessão expirada. Faça login novamente.';
  }

  if (msg.indexOf('ORCAMENTO_') === 0) {
    codigo = 'ORCAMENTO_ERRO';
    mensagem = msg;
  }

  // Observabilidade determinística para rastrear falhas de produção
  Logger.log(
    '[API_AUTH_ERRO] requestId=' + requestId +
    ' action=' + String(action || '') +
    ' email=' + String(emailAutenticado || email || '') +
    ' codigo=' + codigo +
    ' msg=' + msg +
    (stack ? ' stack=' + stack : '')
  );

  // Log persistente e enxuto (apenas erro) na planilha para troubleshooting.
  try {
    registrarErroApiDoPost_({
      requestId: requestId,
      action: action,
      email: emailAutenticado || email,
      codigo: codigo,
      mensagem: msg,
      stack: stack,
      duracaoMs: Date.now() - startedAt
    });
  } catch (logErr) {
    Logger.log('[API_AUTH_ERRO_LOG_FALHA] requestId=' + requestId + ' erro=' + String(logErr));
  }

  // Para ações críticas, devolve a mensagem técnica para diagnóstico rápido no frontend.
  if (
    action === 'fecharComissaoVendedor' ||
    action === 'visualizarPreviewFechamento' ||
    action === 'reconciliarResumoFinanceiroEvento'
  ) {
    mensagem = msg || mensagem;
  }

  // Para orçamento integrado, também devolve erro técnico para diagnóstico rápido.
  if (action === 'gerarOrcamentoInterno') {
    mensagem = msg || mensagem;
  }

  // Para folha de custos integrada, também devolve erro técnico para diagnóstico rápido.
  if (action === 'folhaCustosProxy') {
    mensagem = msg || mensagem;
  }

  return json({
    sucesso: false,
    codigo,
    mensagem,
    requestId
  });
}
}

/**
 * Log persistente de erros da API (erro-only) com retenção automática leve.
 * Usa somente a aba LOGS para centralizar auditoria.
 */
function registrarErroApiDoPost_(ctx) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('LOGS');

  if (!sh) {
    sh = ss.insertSheet('LOGS');
    sh.getRange(1, 1, 1, 7).setValues([[
      'ID_LOG',
      'DATA_HORA',
      'USUARIO',
      'ACAO',
      'TABELA',
      'ID_REGISTRO',
      'DETALHES'
    ]]);
  }

  const idLog = 'ERR-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const userKey = mascararUsuarioLog_(ctx.email);
  const acao = String(ctx.action || 'doPost');
  const detalhes = JSON.stringify({
    tipo: 'API_ERRO',
    codigo: String(ctx.codigo || ''),
    mensagem: String(ctx.mensagem || ''),
    requestId: String(ctx.requestId || ''),
    duracaoMs: Number(ctx.duracaoMs || 0),
    stackTop: String(ctx.stack || '').split('\n').slice(0, 3).join(' | ')
  });

  sh.appendRow([
    idLog,
    new Date(),
    userKey,
    acao,
    'API_AUTH',
    String(ctx.requestId || ''),
    detalhes
  ]);

  // Retenção ocasional para evitar crescimento infinito (erro-only + limpeza probabilística).
  if (Math.random() < 0.05) {
    limparLogsAntigos_(sh, 45);
  }
}

function mascararUsuarioLog_(email) {
  const raw = String(email || '').trim().toLowerCase();
  if (!raw) return 'ANON';

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    raw
  );
  const hex = digest
    .map(b => ((b + 256) % 256).toString(16).padStart(2, '0'))
    .join('');
  return 'USR#' + hex.slice(0, 12);
}

function limparLogsAntigos_(sheet, dias) {
  const limite = new Date(Date.now() - (Number(dias || 45) * 24 * 60 * 60 * 1000));
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  // DATA_HORA é a coluna 2 na estrutura padrão da aba LOG/LOGS
  for (let i = data.length - 1; i >= 1; i--) {
    const dt = data[i][1];
    const d = dt instanceof Date ? dt : new Date(dt);
    if (!isNaN(d.getTime()) && d < limite) {
      sheet.deleteRow(i + 1);
    }
  }
}

function executarComIdempotenciaFinanceira_(ctx, executor) {
  const action = String((ctx && ctx.action) || '').trim();
  const email = String((ctx && ctx.email) || '').trim().toLowerCase();
  const params = (ctx && ctx.params) || {};
  const operationKey = String(params.operationKey || '').trim();

  // Backward compatible: se o frontend antigo não enviar operationKey, mantém fluxo atual.
  if (!acaoPermiteIdempotencia_(action) || !operationKey) {
    return executor();
  }

  const cache = CacheService.getScriptCache();
  const key = montarChaveIdempotencia_(action, email, operationKey);
  const fingerprint = gerarFingerprintIdempotencia_(params);
  const ttlSeconds = 6 * 60 * 60; // 6h

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw new Error('Sistema ocupado. Tente novamente em alguns segundos.');
  }

  try {
    const estadoExistente = lerEstadoIdempotencia_(cache, key);
    if (estadoExistente) {
      if (estadoExistente.fingerprint !== fingerprint) {
        throw new Error('Esta chave de operação foi reutilizada com dados diferentes.');
      }

      if (estadoExistente.status === 'DONE') {
        return estadoExistente.response || { sucesso: true };
      }

      if (estadoExistente.status === 'IN_PROGRESS') {
        throw new Error('Operação em processamento. Aguarde a conclusão antes de tentar novamente.');
      }
    }

    cache.put(
      key,
      JSON.stringify({
        status: 'IN_PROGRESS',
        fingerprint: fingerprint,
        ts: Date.now()
      }),
      ttlSeconds
    );
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }

  try {
    const response = executor();
    if (response && response.sucesso === false) {
      cache.remove(key);
      return response;
    }

    const doneLock = LockService.getScriptLock();
    if (doneLock.tryLock(5000)) {
      try {
        cache.put(
          key,
          JSON.stringify({
            status: 'DONE',
            fingerprint: fingerprint,
            ts: Date.now(),
            response: response
          }),
          ttlSeconds
        );
      } finally {
        try { doneLock.releaseLock(); } catch (_) {}
      }
    }
    return response;
  } catch (err) {
    // Em erro, remove marcador para permitir retry legítimo com a mesma operationKey.
    try {
      const clearLock = LockService.getScriptLock();
      if (clearLock.tryLock(3000)) {
        try {
          cache.remove(key);
        } finally {
          try { clearLock.releaseLock(); } catch (_) {}
        }
      }
    } catch (_) {}
    throw err;
  }
}

function acaoPermiteIdempotencia_(action) {
  const acao = String(action || '').trim();
  return (
    acao === 'apiRegistrarRecebimento' ||
    acao === 'apiRegistrarSaidaEvento' ||
    acao === 'apiEstornarRecebimento' ||
    acao === 'fecharComissaoVendedor' ||
    acao === 'aprovarPendenciaFolhaCusto'
  );
}

function montarChaveIdempotencia_(action, email, operationKey) {
  const material =
    String(action || '') + '|' +
    String(email || '') + '|' +
    String(operationKey || '');

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    material
  );
  const hash = digest
    .map(function (b) {
      return ((b + 256) % 256).toString(16).padStart(2, '0');
    })
    .join('')
    .slice(0, 40);

  return 'IDEMP:' + hash;
}

function lerEstadoIdempotencia_(cache, key) {
  const raw = cache.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function gerarFingerprintIdempotencia_(params) {
  const normalizado = normalizarParaFingerprint_(params || {});
  return JSON.stringify(normalizado);
}

function normalizarParaFingerprint_(valor) {
  if (valor === null || typeof valor === 'undefined') return null;

  if (Array.isArray(valor)) {
    return valor.map(function (item) {
      return normalizarParaFingerprint_(item);
    });
  }

  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return valor.toISOString();
  }

  if (typeof valor === 'object') {
    const out = {};
    Object.keys(valor)
      .filter(function (k) {
        return k !== 'operationKey' && k !== 'action' && k !== 'email';
      })
      .sort()
      .forEach(function (k) {
        out[k] = normalizarParaFingerprint_(valor[k]);
      });
    return out;
  }

  if (typeof valor === 'number') {
    if (isNaN(valor)) return 'NaN';
    return Number(valor.toFixed(6));
  }

  return String(valor);
}

/**
 * ======================================================
 * LOGIN / IDENTIDADE
 * ======================================================
 */
function verificarUsuario(params) {
  const idToken = String((params && params.idToken) || '').trim();
  const sessionToken = String((params && params.sessionToken) || '').trim();

  if (!idToken && !sessionToken) {
    return json({ ok: false, error: 'AUTH_REQUIRED' });
  }

  if (sessionToken && !idToken) {
    const sessao = validarSessionToken_(sessionToken);
    const userSessao = requireUserByEmail(sessao.e);
    return json({
      ok: true,
      user: {
        email: userSessao.EMAIL,
        nome: userSessao.NOME,
        perfil: userSessao.PERFIL,
        paginaInicial: normalizarPaginaInicialUsuario_(userSessao.PAGINA_INICIAL)
      }
    });
  }

  const identidade = validarIdTokenGoogle_(idToken);
  const user = requireUserByEmail(identidade.email);
  const novoSessionToken = criarSessionToken_({
    email: String(user.EMAIL || '').trim().toLowerCase(),
    nome: String(user.NOME || '').trim(),
    perfil: String(user.PERFIL || '').trim()
  });

  return json({
    ok: true,
    sessionToken: novoSessionToken,
    sessionExpiresIn: getSessionTtlSeconds_(),
    user: {
      email: user.EMAIL,
      nome: user.NOME,
      perfil: user.PERFIL,
      paginaInicial: normalizarPaginaInicialUsuario_(user.PAGINA_INICIAL)
    }
  });
}

function autenticarRequisicaoComSessao_(params) {
  const token = String((params && params.sessionToken) || '').trim();
  if (!token) {
    throw new Error('SESSION_TOKEN_REQUIRED');
  }

  const payload = validarSessionToken_(token);
  if (!payload || !payload.e) {
    throw new Error('SESSION_TOKEN_INVALID');
  }

  return String(payload.e).trim().toLowerCase();
}

function validarIdTokenGoogle_(idToken) {
  const url =
    'https://oauth2.googleapis.com/tokeninfo?id_token=' +
    encodeURIComponent(idToken);

  let response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true
    });
  } catch (_) {
    throw new Error('GOOGLE_TOKENINFO_UNAVAILABLE');
  }

  if (!response || response.getResponseCode() !== 200) {
    throw new Error('GOOGLE_ID_TOKEN_INVALID');
  }

  let data = {};
  try {
    data = JSON.parse(response.getContentText() || '{}');
  } catch (_) {
    throw new Error('GOOGLE_ID_TOKEN_INVALID');
  }

  if (String(data.aud || '').trim() !== AUTH_CONFIG.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_AUDIENCE_MISMATCH');
  }

  if (String(data.email_verified || '').toLowerCase() !== 'true') {
    throw new Error('GOOGLE_EMAIL_NOT_VERIFIED');
  }

  const expSeconds = Number(data.exp || 0);
  if (!expSeconds || (expSeconds * 1000) <= Date.now()) {
    throw new Error('GOOGLE_ID_TOKEN_EXPIRED');
  }

  const email = String(data.email || '').trim().toLowerCase();
  if (!email) {
    throw new Error('GOOGLE_EMAIL_MISSING');
  }

  return {
    email: email,
    sub: String(data.sub || '').trim()
  };
}

function criarSessionToken_(user) {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = getSessionTtlSeconds_();
  const payload = {
    e: String(user.email || '').trim().toLowerCase(),
    n: String(user.nome || ''),
    p: String(user.perfil || ''),
    iat: now,
    exp: now + ttlSeconds,
    jti: Utilities.getUuid().replace(/-/g, '')
  };

  const payloadB64 = base64UrlEncodeString_(JSON.stringify(payload));
  const assinatura = assinarTextoHex_(payloadB64);
  return payloadB64 + '.' + assinatura;
}

function validarSessionToken_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) {
    throw new Error('SESSION_TOKEN_INVALID');
  }

  const payloadB64 = parts[0];
  const assinaturaRecebida = parts[1];
  if (!payloadB64 || !assinaturaRecebida) {
    throw new Error('SESSION_TOKEN_INVALID');
  }

  const assinaturaEsperada = assinarTextoHex_(payloadB64);
  if (assinaturaEsperada !== assinaturaRecebida) {
    throw new Error('SESSION_TOKEN_INVALID');
  }

  let payload = null;
  try {
    payload = JSON.parse(base64UrlDecodeToString_(payloadB64));
  } catch (_) {
    throw new Error('SESSION_TOKEN_INVALID');
  }

  const exp = Number(payload && payload.exp);
  if (!exp || (exp * 1000) <= Date.now()) {
    throw new Error('SESSION_TOKEN_EXPIRED');
  }

  return payload;
}

function assinarTextoHex_(texto) {
  const secret = obterAuthSessionSecret_();
  const bytes = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_256,
    String(texto || ''),
    secret
  );
  return bytes
    .map(function (b) {
      return ((b + 256) % 256).toString(16).padStart(2, '0');
    })
    .join('');
}

function obterAuthSessionSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = String(props.getProperty('AUTH_SESSION_SECRET') || '').trim();
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('AUTH_SESSION_SECRET', secret);
  }
  return secret;
}

function base64UrlEncodeString_(str) {
  return Utilities.base64EncodeWebSafe(String(str || ''), Utilities.Charset.UTF_8)
    .replace(/=+$/g, '');
}

function base64UrlDecodeToString_(b64url) {
  let base = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = base.length % 4;
  if (padding) base += '===='.slice(padding);
  const bytes = Utilities.base64Decode(base);
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}

function getSessionTtlSeconds_() {
  let dias = Number(obterConfig('AUTH_SESSION_TTL_DIAS'));
  if (isNaN(dias) || dias <= 0) {
    dias = AUTH_CONFIG.SESSION_TTL_DIAS_PADRAO;
  }

  // Limites defensivos: mínimo 1 dia, máximo 365 dias.
  dias = Math.max(1, Math.min(365, Math.floor(dias)));
  return dias * 24 * 60 * 60;
}

/**
 * ======================================================
 * FONTE DA VERDADE — USUARIOS
 * ======================================================
 */
function requireUserByEmail(email) {
  const usuario = buscarUsuarioPorEmail(email);

  if (!usuario) {
    throw new Error('USER_NOT_FOUND');
  }

  if (String(usuario.STATUS).toLowerCase() !== 'ativo') {
    throw new Error('USER_INACTIVE');
  }

  return usuario;
}

/**
 * ======================================================
 * ACL — CONTROLE DE ACESSO
 * ======================================================
 */
const SOCIO_RULES = [
  'eventos:criar',
  'eventos:editar',
  'eventos:cancelar',
  'eventos:listar',
  'eventos:visualizarFinanceiro',
  'eventos:registrarSaidaBV',
  'agenda:gerarSemanal',
  'orcamento:gerar'
];

const ACL = {
  'Proprietário': ['*'],
  'Sócio': SOCIO_RULES,
  'Administrador': SOCIO_RULES,
  'Admin': SOCIO_RULES,
  'Músico': ['eventos:listar'],
  'Produção': ['eventos:listar'],
  'Producao': ['eventos:listar']
};

function requirePermission(user, action) {
  if (!user || !user.PERFIL) {
    throw new Error('INVALID_USER');
  }

  const rules = ACL[user.PERFIL];
  if (!rules) {
    throw new Error('NO_ACL_FOR_PROFILE');
  }

  if (rules.includes('*')) return true;

  if (!rules.includes(action)) {
    throw new Error('FORBIDDEN_ACTION: ' + action);
  }

  return true;
}

/**
 * ======================================================
 * CONTEXTO GLOBAL DE USUÁRIO
 * ======================================================
 */
function getUsuarioAtual() {
  if (!globalThis.REQUEST_EMAIL) {
    throw new Error('EMAIL_NOT_IN_REQUEST');
  }
  return requireUserByEmail(globalThis.REQUEST_EMAIL);
}

function exigirAcao(acao) {
  const usuario = getUsuarioAtual();
  requirePermission(usuario, acao);
  return usuario;
}

/**
 * ======================================================
 * BUSCA NA ABA USUARIOS
 * ======================================================
 */
function buscarUsuarioPorEmail(email) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('USUARIOS');
  if (!sheet) throw new Error('ABA_USUARIOS_NAO_ENCONTRADA');

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;

  const headers = data[0].map(h =>
    String(h)
      .toUpperCase()
      .replace(/\s+/g, '_')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  );

  const iEmail  = headers.indexOf('EMAIL');
  const iNome   = headers.indexOf('NOME');
  const iPerfil = headers.indexOf('PERFIL');
  const iStatus = headers.indexOf('STATUS');
  const iPaginaInicial = headers.indexOf('PAGINA_INICIAL');

  if (iEmail === -1 || iPerfil === -1 || iStatus === -1) {
    throw new Error('COLUNAS_USUARIOS_INVALIDAS');
  }

  const emailBusca = String(email).toLowerCase().trim();

  for (let i = 1; i < data.length; i++) {
    const emailLinha = String(data[i][iEmail]).toLowerCase().trim();
    if (emailLinha === emailBusca) {
      return {
        EMAIL: data[i][iEmail],
        NOME: data[i][iNome],
        PERFIL: data[i][iPerfil],
        STATUS: data[i][iStatus],
        PAGINA_INICIAL: iPaginaInicial >= 0 ? data[i][iPaginaInicial] : ''
      };
    }
  }

  return null;
}

function normalizarPaginaInicialUsuario_(valor) {
  const s = String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (s === 'agenda' || s === 'agendas' || s === 'direto_agenda' || s === 'direto_para_agenda') {
    return 'agenda';
  }

  return 'menu';
}

function atualizarPreferenciaPaginaInicial_(email, paginaInicial) {
  requireUserByEmail(email);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('USUARIOS');
  if (!sheet) throw new Error('ABA_USUARIOS_NAO_ENCONTRADA');

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) throw new Error('USER_NOT_FOUND');

  let headers = data[0].map(h =>
    String(h)
      .toUpperCase()
      .replace(/\s+/g, '_')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  );

  const iEmail = headers.indexOf('EMAIL');
  if (iEmail === -1) throw new Error('COLUNAS_USUARIOS_INVALIDAS');

  let iPaginaInicial = headers.indexOf('PAGINA_INICIAL');
  if (iPaginaInicial === -1) {
    iPaginaInicial = headers.length;
    sheet.getRange(1, iPaginaInicial + 1).setValue('PAGINA_INICIAL');
    headers = headers.concat(['PAGINA_INICIAL']);
  }

  const emailBusca = String(email || '').toLowerCase().trim();
  const preferencia = normalizarPaginaInicialUsuario_(paginaInicial);

  for (let i = 1; i < data.length; i++) {
    const emailLinha = String(data[i][iEmail]).toLowerCase().trim();
    if (emailLinha === emailBusca) {
      sheet.getRange(i + 1, iPaginaInicial + 1).setValue(preferencia);
      return { ok: true, paginaInicial: preferencia };
    }
  }

  throw new Error('USER_NOT_FOUND');
}

/**
 * ======================================================
 * JSON RESPONSE
 * ======================================================
 */
function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function exigirPerfilProprietario_() {
  const usuario = getUsuarioAtual();
  const perfil = normalizarPerfilAcl_(usuario && usuario.PERFIL);
  if (perfil !== 'proprietario') {
    throw new Error('FORBIDDEN_ACTION: owner-only');
  }
  return usuario;
}

function normalizarPerfilAcl_(perfil) {
  return String(perfil || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function listarAclReadOnly_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('USUARIOS');
  if (!sh) throw new Error('ABA_USUARIOS_NAO_ENCONTRADA');

  const data = sh.getDataRange().getValues();
  if (!data || data.length < 1) return { ok: true, usuarios: [], perfisAcl: ACL, acoesCatalogo: [] };

  const headers = data[0].map(function (h) {
    return String(h || '')
      .toUpperCase()
      .replace(/\s+/g, '_')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  });

  const iEmail = headers.indexOf('EMAIL');
  const iNome = headers.indexOf('NOME');
  const iPerfil = headers.indexOf('PERFIL');
  const iStatus = headers.indexOf('STATUS');
  if (iEmail < 0 || iPerfil < 0 || iStatus < 0) {
    throw new Error('COLUNAS_USUARIOS_INVALIDAS');
  }

  const usuarios = [];
  for (var i = 1; i < data.length; i++) {
    const row = data[i];
    const perfilRaw = String(row[iPerfil] || '').trim();
    const regras = ACL[perfilRaw] || [];
    usuarios.push({
      email: String(row[iEmail] || '').trim(),
      nome: String(row[iNome] || '').trim(),
      perfil: perfilRaw,
      status: String(row[iStatus] || '').trim(),
      regras: regras.slice(),
      acessoTotal: regras.indexOf('*') >= 0
    });
  }

  const catalogSet = {};
  Object.keys(ACL).forEach(function (perfil) {
    const regras = ACL[perfil] || [];
    regras.forEach(function (regra) {
      const acao = String(regra || '').trim();
      if (!acao || acao === '*') return;
      catalogSet[acao] = true;
    });
  });

  return {
    ok: true,
    usuarios: usuarios,
    perfisAcl: ACL,
    acoesCatalogo: Object.keys(catalogSet).sort()
  };
}

function listarConfigCatalogReadOnly_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('CONFIG');
  if (!sh) throw new Error('CONFIG_SHEET_NOT_FOUND');

  const data = sh.getDataRange().getValues();
  if (!data || data.length < 2) {
    return { ok: true, itens: [], resumo: { total: 0, categorias: {} } };
  }

  const headers = data[0].map(function (h) {
    return String(h || '')
      .toUpperCase()
      .replace(/\s+/g, '_')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  });

  const iChave = headers.indexOf('CHAVE');
  const iValor = headers.indexOf('VALOR');
  const iDesc = headers.indexOf('DESCRICAO');
  if (iChave < 0 || iValor < 0) {
    throw new Error('COLUNAS_CONFIG_INVALIDAS');
  }

  const itens = [];
  const categorias = {};
  for (var i = 1; i < data.length; i++) {
    const row = data[i];
    const chave = String(row[iChave] || '').trim();
    if (!chave) continue;

    const valor = row[iValor];
    const categoria = categorizarChaveConfig_(chave);
    categorias[categoria] = (categorias[categoria] || 0) + 1;

    itens.push({
      chave: chave,
      valor: valor,
      tipoValor: inferirTipoValorConfig_(valor),
      descricao: iDesc >= 0 ? String(row[iDesc] || '').trim() : '',
      categoria: categoria
    });
  }

  itens.sort(function (a, b) {
    if (a.categoria !== b.categoria) return a.categoria.localeCompare(b.categoria, 'pt-BR');
    return a.chave.localeCompare(b.chave, 'pt-BR');
  });

  return {
    ok: true,
    itens: itens,
    resumo: {
      total: itens.length,
      categorias: categorias
    }
  };
}

function categorizarChaveConfig_(chave) {
  const c = String(chave || '').trim().toUpperCase();
  if (!c) return 'GERAL';
  if (c.indexOf('AUTH_') === 0) return 'AUTENTICACAO';
  if (c.indexOf('AGENDA_') === 0) return 'AGENDA';
  if (c.indexOf('ASAAS_') === 0 || c.indexOf('PIX_') === 0 || c.indexOf('WOOVI_') === 0) return 'PAGAMENTOS';
  if (c.indexOf('ORCAMENTO_') === 0) return 'ORCAMENTO';
  if (c.indexOf('FOLHA_') === 0) return 'FOLHA_CUSTOS';
  if (c.indexOf('COMISSAO_') === 0 || c.indexOf('NF_') === 0 || c.indexOf('FINANCEIRO_') === 0) return 'FINANCEIRO';
  if (c.indexOf('PREFIXO_') === 0) return 'IDENTIFICADORES';
  return 'GERAL';
}

function inferirTipoValorConfig_(valor) {
  if (valor === null || typeof valor === 'undefined' || String(valor).trim() === '') return 'vazio';
  if (typeof valor === 'boolean') return 'booleano';
  if (Object.prototype.toString.call(valor) === '[object Date]') return 'data';
  if (typeof valor === 'number') return 'numero';
  const raw = String(valor).trim();
  const lower = raw.toLowerCase();
  if (lower === 'true' || lower === 'false') return 'booleano_texto';
  if (!isNaN(Number(raw))) return 'numero_texto';
  return 'texto';
}

function listarAtividadeSistemaReadOnly_(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('LOGS');
  if (!sh) throw new Error('LOGS_SHEET_NOT_FOUND');

  const maxRows = Math.min(Math.max(Number(params && params.maxRows) || 300, 50), 2000);
  const dias = Math.min(Math.max(Number(params && params.dias) || 30, 1), 365);
  const busca = String((params && params.busca) || '').trim().toLowerCase();
  const tipo = String((params && params.tipo) || 'TODOS').trim().toUpperCase();

  const data = sh.getDataRange().getValues();
  if (!data || data.length < 2) {
    return {
      ok: true,
      logs: [],
      resumo: { total: 0, porTipo: {}, porTabela: {}, porAcao: {} },
      cobertura: montarCoberturaAtividade_(0, {})
    };
  }

  const headers = data[0].map(function (h) {
    return String(h || '')
      .toUpperCase()
      .replace(/\s+/g, '_')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  });

  const iId = headers.indexOf('ID_LOG');
  const iData = headers.indexOf('DATA_HORA');
  const iUsuario = headers.indexOf('USUARIO');
  const iAcao = headers.indexOf('ACAO');
  const iTabela = headers.indexOf('TABELA');
  const iRegistro = headers.indexOf('ID_REGISTRO');
  const iDetalhes = headers.indexOf('DETALHES');

  if (iData < 0 || iAcao < 0) throw new Error('COLUNAS_LOGS_INVALIDAS');

  const limiteData = new Date(Date.now() - (dias * 24 * 60 * 60 * 1000));
  const logs = [];
  const resumo = {
    total: 0,
    porTipo: {},
    porTabela: {},
    porAcao: {}
  };

  for (var i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    const dtRaw = row[iData];
    const dataHora = dtRaw instanceof Date ? dtRaw : new Date(dtRaw);
    if (!(dataHora instanceof Date) || isNaN(dataHora.getTime()) || dataHora < limiteData) continue;

    const acao = String(row[iAcao] || '').trim();
    const tabela = iTabela >= 0 ? String(row[iTabela] || '').trim() : '';
    const usuario = iUsuario >= 0 ? String(row[iUsuario] || '').trim() : '';
    const detalhes = iDetalhes >= 0 ? String(row[iDetalhes] || '').trim() : '';
    const idRegistro = iRegistro >= 0 ? String(row[iRegistro] || '').trim() : '';
    const idLog = iId >= 0 ? String(row[iId] || '').trim() : '';

    const tipoLog = inferirTipoLogAtividade_(acao, tabela, detalhes);
    if (tipo !== 'TODOS' && tipoLog !== tipo) continue;

    if (busca) {
      const blob = [idLog, usuario, acao, tabela, idRegistro, detalhes, tipoLog]
        .join(' ')
        .toLowerCase();
      if (blob.indexOf(busca) < 0) continue;
    }

    logs.push({
      idLog: idLog,
      dataHora: dataHora,
      usuario: usuario,
      acao: acao,
      tabela: tabela,
      idRegistro: idRegistro,
      detalhes: detalhes,
      tipo: tipoLog
    });

    resumo.total++;
    resumo.porTipo[tipoLog] = (resumo.porTipo[tipoLog] || 0) + 1;
    const tabelaKey = tabela || 'SEM_TABELA';
    resumo.porTabela[tabelaKey] = (resumo.porTabela[tabelaKey] || 0) + 1;
    const acaoKey = acao || 'SEM_ACAO';
    resumo.porAcao[acaoKey] = (resumo.porAcao[acaoKey] || 0) + 1;

    if (logs.length >= maxRows) break;
  }

  return {
    ok: true,
    logs: logs,
    resumo: resumo,
    cobertura: montarCoberturaAtividade_(logs.length, resumo.porTipo)
  };
}

function inferirTipoLogAtividade_(acao, tabela, detalhes) {
  const txt = (String(acao || '') + ' ' + String(tabela || '') + ' ' + String(detalhes || '')).toUpperCase();
  if (/ERRO|FALHA|EXCEPTION|INVALID|NEGADO|FORBIDDEN/.test(txt)) return 'ERRO';
  if (/CRIAR|CADASTRAR|NOVO|ATUALIZAR|EDITAR|INATIVAR|REATIVAR|REGULARIZAR/.test(txt)) return 'CADASTRO';
  if (/FINANCEIRO|RECEBIMENTO|SAIDA|COMISSAO|NF|BV|PIX|ASAAS|WOOVI|ESTORNO|FECHAMENTO/.test(txt)) return 'FINANCEIRO';
  if (/AGENDA|EVENTO|RESERVA|REUNIAO|BLOQUEIO/.test(txt)) return 'AGENDA';
  if (/CONFIG|ACL|AUTH|LOGIN|USUARIO|SESSAO/.test(txt)) return 'SISTEMA';
  return 'OUTROS';
}

function montarCoberturaAtividade_(total, porTipo) {
  const tiposEsperados = ['CADASTRO', 'ERRO', 'FINANCEIRO', 'AGENDA', 'SISTEMA'];
  const faltantes = [];
  for (var i = 0; i < tiposEsperados.length; i++) {
    const t = tiposEsperados[i];
    if (!(porTipo && porTipo[t] > 0)) faltantes.push(t);
  }

  const nivel = total === 0
    ? 'BAIXA'
    : (faltantes.length >= 3 ? 'MEDIA' : 'ALTA');

  const observacoes = [];
  if (total === 0) {
    observacoes.push('Nenhum log encontrado no período consultado.');
  }
  if (faltantes.length) {
    observacoes.push('Sem ocorrências no período para: ' + faltantes.join(', ') + '.');
  } else {
    observacoes.push('Cobertura equilibrada entre operações de cadastro, financeiro, agenda e sistema.');
  }
  observacoes.push('Logs de erro da API são persistidos automaticamente na aba LOGS.');

  return {
    nivel: nivel,
    faltantes: faltantes,
    observacoes: observacoes
  };
}
