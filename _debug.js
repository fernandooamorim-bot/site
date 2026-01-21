// debug para previa de fechamento
function __debugVisualizarPreviewFechamento() {
  const idVendedor = '2'; // 🔒 DEBUG FIXO – VENDEDOR 2

  try {
    Logger.log('=== DEBUG PREVIEW INICIADO ===');
    Logger.log('ID VENDEDOR: ' + idVendedor);

    const comissoes = buscarComissoesPendentes(idVendedor);
    Logger.log('Comissões encontradas: ' + comissoes.length);

    if (!Array.isArray(comissoes)) {
      throw new Error('buscarComissoesPendentes NÃO retornou array');
    }

    if (comissoes.length === 0) {
      Logger.log('Nenhuma comissão pendente');
      return;
    }

    const vendedor = buscarVendedor(idVendedor);
    if (!vendedor) {
      throw new Error('Vendedor não encontrado');
    }

    const eventosMap = {};

    comissoes.forEach((c, idx) => {
      Logger.log(`-- Comissão ${idx + 1}`);
      Logger.log(JSON.stringify(c));

      if (!eventosMap[c.idEvento]) {
        eventosMap[c.idEvento] = {
          nomeEvento: c.nomeEvento || 'SEM NOME',
          recebimentos: [],
          totalComissaoEvento: 0
        };
      }

      let idRecebimento = null;

      if (typeof c.observacoes === 'string') {
        const m = c.observacoes.match(/MOV-\d{8}-\d{3}/);
        if (m) idRecebimento = m[0];
      }

      Logger.log('ID RECEBIMENTO EXTRAÍDO: ' + idRecebimento);

      let receb = null;
      if (idRecebimento) {
        receb = buscarRecebimentoPorId_(idRecebimento);
        Logger.log('Recebimento encontrado: ' + JSON.stringify(receb));
      } else {
        Logger.log('Nenhum recebimento associado');
      }

      eventosMap[c.idEvento].recebimentos.push({
        dataRecebimento: receb ? receb.data : null,
        valorRecebido: receb ? receb.valor : 0,
        valorComissao: c.valorComissao
      });

      eventosMap[c.idEvento].totalComissaoEvento += c.valorComissao;
    });

    const totalComissao = Object.values(eventosMap)
      .reduce((s, ev) => s + ev.totalComissaoEvento, 0);

    const retorno = {
      vendedor: vendedor.nome,
      totalEventos: Object.keys(eventosMap).length,
      totalComissao,
      eventos: Object.values(eventosMap)
    };

    Logger.log('=== RETORNO FINAL ===');
    Logger.log(JSON.stringify(retorno, null, 2));
    Logger.log('=== DEBUG PREVIEW FINALIZADO ===');

  } catch (e) {
    Logger.log('🔥 ERRO NO DEBUG PREVIEW');
    Logger.log(e.stack || e.message);
  }
}

//debug para teste de fechamento de comissao

function __debugExtracaoRecebimento() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  const data = sh.getDataRange().getValues();
  const head = data.shift();

  const c = n => head.indexOf(n);

  Logger.log('=== DEBUG EXTRAÇÃO RECEBIMENTO ===');

  data.forEach((row, i) => {
    if (row[c('TIPO_MOVIMENTACAO')] !== 'COMISSAO_GERADA') return;

    const obs = String(row[c('OBSERVACOES')] || '');
    const idComissao = row[c('ID_MOVIMENTACAO')];

    const matches = obs.match(/MOV-\d{8}-\d{3}/g);

    Logger.log('-----------------------------');
    Logger.log('COMISSAO: ' + idComissao);
    Logger.log('OBSERVACOES: ' + obs);
    Logger.log('IDS ENCONTRADOS: ' + JSON.stringify(matches));

    if (matches && matches.length) {
      matches.forEach(id => {
        const receb = buscarRecebimentoPorId_(id.trim());
        Logger.log('→ TESTANDO ' + id + ' => ' + JSON.stringify(receb));
      });
    } else {
      Logger.log('⚠️ NENHUM ID DE RECEBIMENTO ENCONTRADO');
    }
  });

  Logger.log('=== FIM DEBUG ===');
}