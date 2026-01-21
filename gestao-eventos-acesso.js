function obterUsuarioLogado() {
  const email = Session.getActiveUser().getEmail();
  if (!email) return null;

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('USUARIOS');
  if (!sheet) return null;

  const dados = sheet.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    const [id, emailUsuario, nome, perfil, status] = dados[i];

    if (
      emailUsuario === email &&
      status === 'Ativo'
    ) {
      return {
        id,
        email: emailUsuario,
        nome,
        perfil,
        permissoes: obterPermissoesPorPerfil(perfil)
      };
    }
  }

  return null;
}

function obterPermissoesPorPerfil(perfil) {
  const regras = {
    'Proprietário': {
      podeCriarEvento: true,
      podeEditarEvento: true,
      podeExcluirEvento: true,

      podeVerValores: true,
      podeEditarValores: true,

      podeAlterarComissao: true,
      podeUsarComissaoCustomizada: true,

      podeEmitirNF: true,
      podeVerFinanceiro: true
    },

    'Sócio': {
      podeCriarEvento: true,
      podeEditarEvento: true,
      podeExcluirEvento: false,

      podeVerValores: true,
      podeEditarValores: false,

      podeAlterarComissao: false,
      podeUsarComissaoCustomizada: false,

      podeEmitirNF: false,
      podeVerFinanceiro: true
    },

    'Músico': {
      podeCriarEvento: false,
      podeEditarEvento: false,
      podeExcluirEvento: false,

      podeVerValores: false,
      podeEditarValores: false,

      podeAlterarComissao: false,
      podeUsarComissaoCustomizada: false,

      podeEmitirNF: false,
      podeVerFinanceiro: false
    }
  };

  return regras[perfil] || regras['Músico'];
}

function exigirPermissao(chavePermissao) {
  const usuario = obterUsuarioLogado();
  if (!usuario || !usuario.permissoes[chavePermissao]) {
    throw new Error('Acesso negado para esta ação.');
  }
  return true;
}

/**
 * =====================================================
 * OVERRIDE ADMINISTRATIVO — AJUSTE FINANCEIRO FORÇADO
 * SOMENTE PROPRIETÁRIO
 * =====================================================
 * Cria uma movimentação de AJUSTE_COMISSAO quando
 * o valor de comissão gerado já ultrapassa o novo valor correto.
 * NÃO apaga histórico, apenas compensa a diferença.
 */
function forcarAjusteFinanceiroEvento(idEvento, motivo) {
  exigirPermissao('podeEditarValores');

  if (!idEvento) {
    throw new Error('ID do evento é obrigatório');
  }

  const usuario = obterUsuarioLogado();
  if (!usuario || usuario.perfil !== 'Proprietário') {
    throw new Error('Apenas o proprietário pode forçar ajustes financeiros.');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetMov = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');

  const evento = buscarEvento(idEvento);
  if (!evento) {
    throw new Error('Evento não encontrado');
  }

  const stats = calcularEstatisticasComissaoEvento(idEvento);

  const comissaoCorreta = stats.comissaoTotalEsperada;
  const comissaoGerada = stats.totalComissaoGerada;

  const diferenca = Number((comissaoCorreta - comissaoGerada).toFixed(2));

  if (diferenca === 0) {
    return {
      sucesso: true,
      mensagem: 'Nenhum ajuste necessário. Comissão já está correta.'
    };
  }

  // Movimento de AJUSTE
  const idMov = gerarIDMovimentacao();
  const tipoMov = 'AJUSTE_COMISSAO';
  const direcao = diferenca > 0 ? 'ENTRADA' : 'SAÍDA';

  const movimento = [
    idMov,
    tipoMov,
    direcao,
    idEvento,
    buscarNomeEventoPorID(idEvento),
    new Date(),
    Math.abs(diferenca),
    '',
    evento.nomeVendedor || '',
    evento.idVendedor || '',
    '',
    motivo || 'Ajuste financeiro forçado pelo proprietário',
    usuario.email,
    new Date(),
    '',
    'PROCESSADO'
  ];

  sheetMov.appendRow(movimento);

  registrarLog(
    'AJUSTE_ADMIN',
    'EVENTOS',
    idEvento,
    `Ajuste financeiro forçado: diferença ${diferenca} | Motivo: ${motivo || 'não informado'}`
  );

  return {
    sucesso: true,
    mensagem: 'Ajuste financeiro registrado com sucesso.',
    diferenca: diferenca
  };
}