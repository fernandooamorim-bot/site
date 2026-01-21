/**
 * ========================================
 * GERADOR DE RELATÓRIO PDF PROFISSIONAL
 * FECHAMENTO DE COMISSÃO - V2
 * ========================================
 * - Mantém layout/CSS profissional
 * - Lógica baseada EXCLUSIVAMENTE no ID_FECHAMENTO
 * - Não depende de período
 * - Compatível com FECHAMENTOS_COMISSAO + MOVIMENTACOES_FINANCEIRAS + EVENTOS
 */

/**
 * Função principal chamada pelo fechamento
 */
function gerarPdfFechamentoComissao(idFechamento) {
  const ss = SpreadsheetApp.getActive();

  const shFech = ss.getSheetByName('FECHAMENTOS_COMISSAO');
  const shMov  = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  const shEvt  = ss.getSheetByName('EVENTOS');

  if (!shFech || !shMov || !shEvt) {
    throw new Error('Abas obrigatórias não encontradas.');
  }

  /* ================= FECHAMENTO ================= */

  const fechData = shFech.getDataRange().getValues();
  const fechHead = fechData.shift();
  const f = c => fechHead.indexOf(c);

  const fechamento = fechData.find(r => r[f('ID_FECHAMENTO')] === idFechamento);
  if (!fechamento) throw new Error('Fechamento não encontrado.');

  const vendedor = {
    id: fechamento[f('ID_VENDEDOR')],
    nome: fechamento[f('NOME_VENDEDOR')]
  };

  const dataGeracao = fechamento[f('DATA_GERACAO')];
  const totalComissao = Number(fechamento[f('TOTAL_COMISSAO')]) || 0;
  const ajusteCredito = Number(fechamento[f('AJUSTE_CREDITO')]) || 0;
  const ajusteDebito  = Number(fechamento[f('AJUSTE_DEBITO')]) || 0;
  const valorFinal    = Number(fechamento[f('VALOR_FINAL')]) || 0;

  /* ================= COMISSÕES DO FECHAMENTO ================= */

  const movData = shMov.getDataRange().getValues();
  const movHead = movData.shift();
  const m = c => movHead.indexOf(c);

  const comissoes = movData
    .filter(r =>
      r[m('TIPO_MOVIMENTACAO')] === 'COMISSAO_GERADA' &&
      r[m('INCLUIDO_EM_FECHAMENTO')] === idFechamento
    )
    .map(r => ({
      idEvento: r[m('ID_EVENTO')],
      nomeEvento: r[m('NOME_EVENTO')],
      dataMovimentacao: r[m('DATA_MOVIMENTACAO')],
      valorComissao: Number(r[m('VALOR')]) || 0
    }));

  /* ================= EVENTOS ================= */

  const evtData = shEvt.getDataRange().getValues();
  const evtHead = evtData.shift();
  const e = c => evtHead.indexOf(c);

  const eventosMap = {};

  comissoes.forEach(c => {
    if (!eventosMap[c.idEvento]) {
      const evt = evtData.find(r => r[e('ID_EVENTO')] === c.idEvento);
      if (!evt) return;

      const dataEventoRaw = evt[e('DATA_EVENTO')];
      let dataEventoFmt = '';

      if (dataEventoRaw instanceof Date) {
        dataEventoFmt = Utilities.formatDate(
          dataEventoRaw,
          Session.getScriptTimeZone(),
          'dd/MM/yyyy'
        );
      } else if (typeof dataEventoRaw === 'string' && dataEventoRaw.includes('/')) {
        const [d, m, y] = dataEventoRaw.split('/');
        dataEventoFmt = `${d}/${m}/${y}`;
      }

      // ================= FALLBACK BASE DE COMISSÃO (APENAS PDF) =================

      // Valores base do evento
      const valorTotalContrato = Number(evt[e('VALOR_TOTAL')]) || 0;
      const valorBV = Number(evt[e('VALOR_BV')]) || 0;
      const valorNF = Number(evt[e('VALOR_NF')]) || 0;

      // Tipo de comissão
      const comissaoTipo = evt[e('COMISSAO_TIPO')];

      // Valores já gravados
      let valorComissaoTotalEvento = Number(evt[e('VALOR_COMISSAO_CALCULADO')]) || 0;
      const valorComissaoPagoEvento = Number(evt[e('VALOR_COMISSAO_PAGO')]) || 0;

      let descricaoBase = '';
      let percentualTotalPago = null;

      // Variáveis para nova informação de comissão
      let infoComissaoAplicada = '';
      let tipoComissaoLabel = '';

      // Comissão FIXA → sem percentual
      if (comissaoTipo === 'Fixo') {
        descricaoBase = 'Comissão fixa — não possui base percentual';
        percentualTotalPago = null;

        tipoComissaoLabel = 'Fixa';
        infoComissaoAplicada = `Valor fixo aplicado: ${formatarMoeda(valorComissaoTotalEvento || valorComissaoPagoEvento)}`;
      }

      // Comissão Padrão ou Percentual
      else {

        // Base financeira do evento (contrato - BV - NF)
        const baseContrato = Math.max(
          valorTotalContrato - valorBV - valorNF,
          0
        );

        // Se VALOR_COMISSAO_CALCULADO existir, usar
        if (valorComissaoTotalEvento > 0) {
          percentualTotalPago =
            (valorComissaoPagoEvento / valorComissaoTotalEvento) * 100;
        }

        // Fallback: calcular comissão total do evento
        else {

          let percentualComissao = null;

          // Percentual definido no evento
          if (evt[e('COMISSAO_TIPO')] === 'Percentual' && evt[e('COMISSAO_VALOR')]) {
            percentualComissao = Number(evt[e('COMISSAO_VALOR')]);
          }

          // Comissão padrão → buscar hierarquia (VENDEDOR → CONFIG)
          else if (evt[e('COMISSAO_TIPO')] === 'Padrão') {
            let origem = '';

            if (evt[e('COMISSAO_VALOR')]) {
              percentualComissao = Number(evt[e('COMISSAO_VALOR')]);
              origem = 'evento';
            } else {
              const percVend = buscarPercentualPadraoVendedor(evt[e('ID_VENDEDOR')]);
              if (percVend) {
                percentualComissao = Number(percVend);
                origem = 'vendedor';
              } else {
                const percGlobal = buscarPercentualPadraoGlobal();
                percentualComissao = Number(percGlobal);
                origem = 'global';
              }
            }

            if (percentualComissao && baseContrato > 0) {
              valorComissaoTotalEvento = baseContrato * (percentualComissao / 100);
              percentualTotalPago = (valorComissaoPagoEvento / valorComissaoTotalEvento) * 100;
            }
          }

          // Definir infoComissaoAplicada e tipoComissaoLabel para Percentual ou Padrão
          if (evt[e('COMISSAO_TIPO')] === 'Percentual') {
            tipoComissaoLabel = 'Percentual';
            infoComissaoAplicada = `Percentual aplicado: ${evt[e('COMISSAO_VALOR')]}%`;
          } else if (evt[e('COMISSAO_TIPO')] === 'Padrão') {
            tipoComissaoLabel = 'Padrão';
            infoComissaoAplicada = `Percentual aplicado: ${percentualComissao}%`;
          }
        }

        // Proteção contra NaN ou infinito
        if (!isFinite(percentualTotalPago)) {
          percentualTotalPago = null;
        }

        // Monta descrição profissional da base
        const partes = [];
        if (valorBV > 0) partes.push(`BV ${formatarMoeda(valorBV)}`);
        if (valorNF > 0) partes.push(`NF ${formatarMoeda(valorNF)}`);

        if (partes.length === 0) {
          descricaoBase = `Base de comissão: ${formatarMoeda(baseContrato)}`;
        } else {
          descricaoBase = `
            Base de comissão: ${formatarMoeda(baseContrato)}
            <span style="color:#666;font-size:12px">
              (Contrato ${formatarMoeda(valorTotalContrato)} − ${partes.join(' − ')})
            </span>
          `;
        }
      }

      // Fallback visual final
      if (!descricaoBase) {
        descricaoBase = 'Base de comissão não definida no cadastro do evento';
      }
      // ========================================================================

      eventosMap[c.idEvento] = {
        idEvento: c.idEvento,
        nomeEvento: evt[e('NOME_CONTRATANTE')],
        dataEvento: dataEventoFmt,
        recebimentos: [],
        totalComissaoEvento: 0,
        totalCalculado: Number(evt[e('VALOR_COMISSAO_CALCULADO')]) || 0,
        totalPago: valorComissaoPagoEvento,
        percentualTotalPago: percentualTotalPago,
        descricaoBase: descricaoBase,
        obs: [
          evt[e('VALOR_BV')] > 0 ? `BV: ${formatarMoeda(evt[e('VALOR_BV')])}` : null,
          evt[e('VALOR_NF')] > 0 ? `NF: ${formatarMoeda(evt[e('VALOR_NF')])}` : null
        ].filter(Boolean).join(' | '),
        tipoComissao: tipoComissaoLabel,
        infoComissaoAplicada: infoComissaoAplicada
      };
    }

    eventosMap[c.idEvento].recebimentos.push({
      data: Utilities.formatDate(new Date(c.dataMovimentacao), Session.getScriptTimeZone(), 'dd/MM/yyyy'),
      valorComissao: c.valorComissao
    });

    eventosMap[c.idEvento].totalComissaoEvento += c.valorComissao;
  });

  const eventosArray = Object.values(eventosMap);

  eventosArray.forEach(ev => {
    ev.totalPago = Number(ev.totalPago) || 0;
  });

  /* ================= HTML / CSS (MANTIDO) ================= */

  const html = gerarRelatorioComissaoHTML_V2(
    idFechamento,
    vendedor,
    dataGeracao,
    eventosArray,
    totalComissao,
    ajusteCredito,
    ajusteDebito,
    valorFinal
  );

  /* ================= PDF / DRIVE ================= */
  

  const dataNome = Utilities.formatDate(
    new Date(dataGeracao),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  const nomeArquivo = `FECHAMENTO-COMISSAO-${vendedor.nome
    .toUpperCase()
    .replace(/\s+/g, '_')}-${dataNome}-${idFechamento}.pdf`;

  const blob = Utilities
    .newBlob(html, 'text/html', 'relatorio.html')
    .getAs('application/pdf')
    .setName(nomeArquivo);

  const ano = new Date(dataGeracao).getFullYear();
  const root = DriveApp.getRootFolder();

  const pastaCentral = getOrCreateFolder_(root, 'Central Financeira');
  const pastaFech    = getOrCreateFolder_(pastaCentral, 'Fechamentos de Comissão');
  const pastaAno     = getOrCreateFolder_(pastaFech, String(ano));

  const file = pastaAno.createFile(blob);

  return file.getUrl();
}

/* ========================================================= */
/* ================= HTML PROFISSIONAL ===================== */
/* ========================================================= */

function gerarRelatorioComissaoHTML_V2(
  idFechamento,
  vendedor,
  dataGeracao,
  eventos,
  totalComissao,
  ajusteCredito,
  ajusteDebito,
  valorFinal
) {

  const dataFmt = Utilities.formatDate(new Date(dataGeracao), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');

  let html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  /* === CSS PROFISSIONAL MANTIDO === */
  body { font-family:'Helvetica Neue', Arial; color:#333; padding:40px; }
  h1 { font-size:24px; margin-bottom:20px; }
  .header { text-align:center; border-bottom:3px solid #667eea; padding-bottom:20px; }
  .logo { font-size:28px; font-weight:bold; color:#667eea; }
  .subtitle { color:#666; }
  .info-box { background:#f8f9fa; padding:20px; border-radius:8px; margin:30px 0; }
  .info-row { display:flex; justify-content:space-between; padding:6px 0; }
  .evento-card { border:1px solid #dee2e6; border-radius:8px; padding:15px; margin-bottom:15px; }
  .evento-header { font-weight:600; font-size:16px; margin-bottom:8px; }
  .recebimento-item { display:flex; justify-content:space-between; padding:6px 0; }
  .recebimento-comissao { color:#28a745; font-weight:600; }
  .evento-total { border-top:2px solid #dee2e6; margin-top:10px; padding-top:10px; text-align:right; font-weight:600; }
  .resumo-box { background:linear-gradient(135deg,#667eea,#764ba2); color:#fff; padding:25px; border-radius:12px; margin-top:30px; }
  .resumo-item { display:flex; justify-content:space-between; padding:8px 0; }
  .valor-final { margin-top:15px; font-size:20px; font-weight:bold; text-align:center; }
  .footer { margin-top:40px; font-size:12px; text-align:center; color:#666; }
</style>
</head>
<body>

<div class="header">
  <div class="logo">🎵 BANDA FERNANDO AMORIM</div>
  <div class="subtitle">Demonstrativo de Comissão</div>
</div>

<div class="info-box">
  <div class="info-row"><strong>Fechamento:</strong> ${idFechamento}</div>
  <div class="info-row"><strong>Vendedor:</strong> ${vendedor.nome}</div>
  <div class="info-row"><strong>Data:</strong> ${dataFmt}</div>
</div>

<h1>Detalhamento por Evento</h1>
`;

  eventos.forEach(ev => {
    html += `
<div class="evento-card">
  <div class="evento-header">
    ${ev.dataEvento} — ${ev.nomeEvento} (${ev.idEvento})
  </div>
  <div style="font-size:12px;color:#555;margin-bottom:6px">
    <strong>Tipo de comissão:</strong> ${ev.tipoComissao}<br>
    ${ev.infoComissaoAplicada}
  </div>

  <div class="info-row">
    <span>Comissão neste fechamento</span>
    <span class="recebimento-comissao">${formatarMoeda(ev.totalComissaoEvento)}</span>
  </div>

  <div class="info-row">
    <span>% total pago</span>
    <span>
      ${ev.percentualTotalPago !== null
  ? ev.percentualTotalPago.toFixed(1) + '%'
  : '—'}
    </span>
  </div>

  <div class="info-row">
    <span>Comissão total já paga</span>
    <span>${formatarMoeda(ev.totalPago)}</span>
  </div>

  <div style="margin-top:8px;font-size:12px;color:#666">
    ${ev.descricaoBase}
  </div>
</div>
`;
  });

  html += `
<div class="resumo-box">
  <div class="resumo-item"><span>Total Comissões</span><span>${formatarMoeda(totalComissao)}</span></div>
  <div class="resumo-item"><span>Ajuste Crédito</span><span>${formatarMoeda(ajusteCredito)}</span></div>
  <div class="resumo-item"><span>Ajuste Débito</span><span>${formatarMoeda(ajusteDebito)}</span></div>
  <div class="valor-final">VALOR FINAL: ${formatarMoeda(valorFinal)}</div>
</div>

<div class="footer">
  Documento gerado automaticamente pelo sistema<br>
  ${dataFmt}
</div>

</body>
</html>
`;

  return html;
}

/* ================= UTIL ================= */

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function formatarMoeda(valor) {
  return 'R$ ' + Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Busca percentual padrão do vendedor (SOMENTE LEITURA)
 * Usado apenas como fallback no PDF
 */
function buscarPercentualPadraoVendedor(idVendedor) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('VENDEDORES');
  if (!sh) return null;

  const data = sh.getDataRange().getValues();
  const head = data.shift();
  const c = col => head.indexOf(col);

  for (const r of data) {
    if (r[c('ID_VENDEDOR')] === idVendedor) {
      return Number(r[c('COMISSAO_PADRAO')]) || null;
    }
  }
  return null;
}

/**
 * Busca percentual padrão global (CONFIG)
 * Usado apenas como fallback no PDF
 */
function buscarPercentualPadraoGlobal() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('CONFIG');
  if (!sh) return null;

  const data = sh.getDataRange().getValues();
  const head = data.shift();
  const c = col => head.indexOf(col);

  for (const r of data) {
    if (r[c('CHAVE')] === 'COMISSAO_PADRAO_PERCENTUAL') {
      return Number(r[c('VALOR')]) || null;
    }
  }
  return null;
}