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
  const dataGeracaoPorFechamento = {};
  fechData.forEach(r => {
    dataGeracaoPorFechamento[String(r[f('ID_FECHAMENTO')])] = new Date(r[f('DATA_GERACAO')]).getTime();
  });

  const fechamento = fechData.find(r => r[f('ID_FECHAMENTO')] === idFechamento);
  if (!fechamento) throw new Error('Fechamento não encontrado.');

  const vendedor = {
    id: fechamento[f('ID_VENDEDOR')],
    nome: fechamento[f('NOME_VENDEDOR')]
  };

  const dataGeracao = fechamento[f('DATA_GERACAO')];
  const tsFechamentoAtual = new Date(dataGeracao).getTime();
  const totalComissao = Number(fechamento[f('TOTAL_COMISSAO')]) || 0;
  const ajusteCredito = Number(fechamento[f('AJUSTE_CREDITO')]) || 0;
  const ajusteDebito  = Number(fechamento[f('AJUSTE_DEBITO')]) || 0;
  const valorFinal    = Number(fechamento[f('VALOR_FINAL')]) || 0;
  const snapshotRaw = f('SNAPSHOT_FECHAMENTO') >= 0 ? fechamento[f('SNAPSHOT_FECHAMENTO')] : '';
  let snapshot = null;
  try {
    snapshot = snapshotRaw ? JSON.parse(String(snapshotRaw)) : null;
  } catch (_) {
    snapshot = null;
  }

  const ajustePorEventoSnapshot = {};
  const ajusteObsPorEventoSnapshot = {};
  const ajustesDetalhadosSnapshot = (snapshot && Array.isArray(snapshot.ajustesDetalhados))
    ? snapshot.ajustesDetalhados
    : [];
  if (snapshot && Array.isArray(snapshot.comissoes)) {
    snapshot.comissoes.forEach(item => {
      const idEvento = String(item.idEvento || '');
      if (!idEvento) return;
      const valorAjuste = Number(item.ajusteComissao || 0);
      ajustePorEventoSnapshot[idEvento] = (ajustePorEventoSnapshot[idEvento] || 0) + valorAjuste;
    });
  }
  if (snapshot && Array.isArray(snapshot.ajustesEstorno)) {
    snapshot.ajustesEstorno.forEach(item => {
      const idEvento = String(item.idEvento || '');
      if (!idEvento) return;
      const obs = String(item.observacoes || '').trim();
      if (obs && !ajusteObsPorEventoSnapshot[idEvento]) {
        ajusteObsPorEventoSnapshot[idEvento] = obs;
      }
    });
  }

  /* ================= COMISSÕES DO FECHAMENTO ================= */

  const movData = shMov.getDataRange().getValues();
  const movHead = movData.shift();
  const m = c => movHead.indexOf(c);
  const idVendedorFechamento = String(vendedor.id);
  const colTimestamp = m('TIMESTAMP');
  const colDataMov = m('DATA_MOVIMENTACAO');

  function parseDataFlexivelParaTs_(valor) {
    if (!valor && valor !== 0) return null;
    if (Object.prototype.toString.call(valor) === '[object Date]') {
      const t = valor.getTime();
      return isNaN(t) ? null : t;
    }

    const txt = String(valor || '').trim();
    if (!txt) return null;

    // dd/MM/yyyy HH:mm:ss
    let mBr = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (mBr) {
      const d = Number(mBr[1]);
      const mo = Number(mBr[2]) - 1;
      const y = Number(mBr[3]);
      const hh = Number(mBr[4] || 0);
      const mi = Number(mBr[5] || 0);
      const ss = Number(mBr[6] || 0);
      const dt = new Date(y, mo, d, hh, mi, ss, 0);
      const ts = dt.getTime();
      return isNaN(ts) ? null : ts;
    }

    // yyyy-MM-dd HH:mm:ss / ISO
    const dtGen = new Date(txt);
    const tsGen = dtGen.getTime();
    return isNaN(tsGen) ? null : tsGen;
  }

  // Total já pago por evento (inclui fechamento atual + anteriores) para o vendedor
  const totalPagoPorEvento = {};
  movData.forEach(r => {
    const idFechMov = String(r[m('INCLUIDO_EM_FECHAMENTO')] || '');
    const tsFechMov = idFechMov ? dataGeracaoPorFechamento[idFechMov] : null;
    const tsTimestampMov = colTimestamp >= 0 ? parseDataFlexivelParaTs_(r[colTimestamp]) : null;
    const tsDataMov = colDataMov >= 0 ? parseDataFlexivelParaTs_(r[colDataMov]) : null;
    const tsReferencia =
      (typeof tsFechMov === 'number' && !isNaN(tsFechMov)) ? tsFechMov :
      (typeof tsTimestampMov === 'number' && !isNaN(tsTimestampMov)) ? tsTimestampMov :
      (typeof tsDataMov === 'number' && !isNaN(tsDataMov)) ? tsDataMov :
      null;
    if (
      r[m('TIPO_MOVIMENTACAO')] === 'COMISSAO_GERADA' &&
      r[m('STATUS')] === 'PROCESSADO' &&
      String(r[m('ID_CONTRAPARTE')]) === idVendedorFechamento &&
      tsReferencia &&
      tsReferencia <= tsFechamentoAtual
    ) {
      const idEvento = String(r[m('ID_EVENTO')]);
      const valor = Number(r[m('VALOR')]) || 0;
      totalPagoPorEvento[idEvento] = (totalPagoPorEvento[idEvento] || 0) + valor;
    }
  });

  // Total de comissão gerada até o fechamento (base contábil para percentual acumulado)
  const totalGeradoPorEvento = {};
  movData.forEach(r => {
    const idFechMov = String(r[m('INCLUIDO_EM_FECHAMENTO')] || '');
    const tsFechMov = idFechMov ? dataGeracaoPorFechamento[idFechMov] : null;
    const tsTimestampMov = colTimestamp >= 0 ? parseDataFlexivelParaTs_(r[colTimestamp]) : null;
    const tsDataMov = colDataMov >= 0 ? parseDataFlexivelParaTs_(r[colDataMov]) : null;
    const tsReferencia =
      (typeof tsFechMov === 'number' && !isNaN(tsFechMov)) ? tsFechMov :
      (typeof tsTimestampMov === 'number' && !isNaN(tsTimestampMov)) ? tsTimestampMov :
      (typeof tsDataMov === 'number' && !isNaN(tsDataMov)) ? tsDataMov :
      null;

    if (
      r[m('TIPO_MOVIMENTACAO')] === 'COMISSAO_GERADA' &&
      String(r[m('ID_CONTRAPARTE')]) === idVendedorFechamento &&
      String(r[m('STATUS')] || '').toUpperCase() !== 'CANCELADO' &&
      tsReferencia &&
      tsReferencia <= tsFechamentoAtual
    ) {
      const idEvento = String(r[m('ID_EVENTO')]);
      const valor = Number(r[m('VALOR')]) || 0;
      totalGeradoPorEvento[idEvento] = (totalGeradoPorEvento[idEvento] || 0) + valor;
    }
  });

  const comissoes = movData
    .filter(r =>
      r[m('TIPO_MOVIMENTACAO')] === 'COMISSAO_GERADA' &&
      String(r[m('INCLUIDO_EM_FECHAMENTO')]) === String(idFechamento)
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
      const evt = evtData.find(r => String(r[e('ID_EVENTO')]) === String(c.idEvento));
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
      const valorComissaoPagoEvento = Number(totalPagoPorEvento[String(c.idEvento)]) || 0;

      let descricaoBase = '';
      let percentualTotalPago = null;

      // Variáveis para nova informação de comissão
      let infoComissaoAplicada = '';
      let tipoComissaoLabel = '';

      const ehLegado = String(c.idEvento || '').indexOf('LG-') === 0;

      // Legado: percentual acumulado em cima de 10% do valor total do evento
      if (ehLegado) {
        const baseLegado = Math.max(valorTotalContrato - valorBV - valorNF, 0);
        valorComissaoTotalEvento = Number((baseLegado * 0.10).toFixed(2));
        percentualTotalPago =
          valorComissaoTotalEvento > 0
            ? (valorComissaoPagoEvento / valorComissaoTotalEvento) * 100
            : null;

        tipoComissaoLabel = 'Legado';
        infoComissaoAplicada = 'Percentual aplicado: 10% (legado)';
        const partesLegado = [];
        if (valorBV > 0) partesLegado.push(`BV ${formatarMoedaRelatorio_(valorBV)}`);
        if (valorNF > 0) partesLegado.push(`NF ${formatarMoedaRelatorio_(valorNF)}`);
        descricaoBase = partesLegado.length
          ? `Base legado: ${formatarMoedaRelatorio_(baseLegado)} <span style="color:#666;font-size:12px">(Contrato ${formatarMoedaRelatorio_(valorTotalContrato)} − ${partesLegado.join(' − ')})</span>`
          : `Base legado: ${formatarMoedaRelatorio_(baseLegado)} (10%)`;
      }
      // Comissão FIXA → sem percentual baseado em regra de cadastro
      else if (comissaoTipo === 'Fixo') {
        descricaoBase = 'Comissão fixa — não possui base percentual';
        percentualTotalPago =
          valorComissaoTotalEvento > 0
            ? (valorComissaoPagoEvento / valorComissaoTotalEvento) * 100
            : null;

        tipoComissaoLabel = 'Fixa';
        infoComissaoAplicada = `Valor fixo aplicado: ${formatarMoedaRelatorio_(valorComissaoTotalEvento || valorComissaoPagoEvento)}`;
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
        if (valorBV > 0) partes.push(`BV ${formatarMoedaRelatorio_(valorBV)}`);
        if (valorNF > 0) partes.push(`NF ${formatarMoedaRelatorio_(valorNF)}`);

        if (partes.length === 0) {
          descricaoBase = `Base de comissão: ${formatarMoedaRelatorio_(baseContrato)}`;
        } else {
          descricaoBase = `
            Base de comissão: ${formatarMoedaRelatorio_(baseContrato)}
            <span style="color:#666;font-size:12px">
              (Contrato ${formatarMoedaRelatorio_(valorTotalContrato)} − ${partes.join(' − ')})
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
        nomeEvento: obterNomeEventoExibicao_(evt),
        dataEvento: dataEventoFmt,
        recebimentos: [],
        totalComissaoEvento: 0,
        totalCalculado: Number(evt[e('VALOR_COMISSAO_CALCULADO')]) || 0,
        totalPago: valorComissaoPagoEvento,
        percentualTotalPago: percentualTotalPago,
        descricaoBase: descricaoBase,
        obs: [
          evt[e('VALOR_BV')] > 0 ? `BV: ${formatarMoedaRelatorio_(evt[e('VALOR_BV')])}` : null,
          evt[e('VALOR_NF')] > 0 ? `NF: ${formatarMoedaRelatorio_(evt[e('VALOR_NF')])}` : null
        ].filter(Boolean).join(' | '),
        tipoComissao: tipoComissaoLabel,
        infoComissaoAplicada: infoComissaoAplicada,
        ajusteEstornoFechamento: Number(ajustePorEventoSnapshot[String(c.idEvento)] || 0),
        ajusteEstornoObs: String(ajusteObsPorEventoSnapshot[String(c.idEvento)] || '')
      };
    }

    eventosMap[c.idEvento].recebimentos.push({
      data: Utilities.formatDate(new Date(c.dataMovimentacao), Session.getScriptTimeZone(), 'dd/MM/yyyy'),
      valorComissao: c.valorComissao
    });

      eventosMap[c.idEvento].totalComissaoEvento += c.valorComissao;
  });

  const eventosArray = Object.values(eventosMap).sort((a, b) => {
    const pa = String(a.dataEvento || '').split('/');
    const pb = String(b.dataEvento || '').split('/');
    const ta = pa.length === 3 ? new Date(Number(pa[2]), Number(pa[1]) - 1, Number(pa[0])).getTime() : 0;
    const tb = pb.length === 3 ? new Date(Number(pb[2]), Number(pb[1]) - 1, Number(pb[0])).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return String(a.idEvento || '').localeCompare(String(b.idEvento || ''));
  });

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
    valorFinal,
    ajustesDetalhadosSnapshot
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
  valorFinal,
  ajustesDetalhados
) {
  const logoUrl = (typeof obterConfig === 'function')
    ? String(obterConfig('LOGO_RELATORIO_PDF_URL') || '').trim()
    : '';
  const logoDataUri = montarLogoDataUriParaPdf_(logoUrl);
  const dataFmt = Utilities.formatDate(
    new Date(dataGeracao),
    Session.getScriptTimeZone(),
    'dd/MM/yyyy HH:mm'
  );

  let blocosEventos = '';
  eventos.forEach(ev => {
    const pctPago = ev.percentualTotalPago !== null && isFinite(ev.percentualTotalPago)
      ? ev.percentualTotalPago.toFixed(1) + '%'
      : '-';

    blocosEventos += `
      <article class="event">
        <div class="event-head">
          <p class="event-title">${ev.nomeEvento} (${ev.idEvento})</p>
          <div class="event-sub">
            Data: ${ev.dataEvento || '-'} | Tipo: ${ev.tipoComissao || '-'} | ${ev.infoComissaoAplicada || ''}
          </div>
        </div>

        <table class="event-grid">
          <tr>
            <td class="event-cell">
              <div class="label">Comissão neste fechamento</div>
              <div class="value ok">${formatarMoedaRelatorio_(ev.totalComissaoEvento)}</div>
            </td>

            <td class="event-cell">
              <div class="label">% total pago (acumulado)</div>
              <div class="value accent">${pctPago}</div>
            </td>

            <td class="event-cell">
              <div class="label">Comissão total já paga (acumulado)</div>
              <div class="value">${formatarMoedaRelatorio_(ev.totalPago)}</div>
            </td>
          </tr>
        </table>

        ${ev.ajusteEstornoFechamento < 0 ? `
          <div class="event-alert">
            Ajuste por estorno aplicado neste fechamento: ${formatarMoedaRelatorio_(ev.ajusteEstornoFechamento)}
            ${ev.ajusteEstornoObs ? ` | ${ev.ajusteEstornoObs}` : ''}
          </div>
        ` : ''}

        <div class="base-desc">${ev.descricaoBase || ''}</div>
      </article>
    `;
  });

  let blocoAjustesDetalhados = '';
  if (Array.isArray(ajustesDetalhados) && ajustesDetalhados.length) {
    const linhas = ajustesDetalhados.map(function (a) {
      const tipo = String(a.tipo || '').toUpperCase() === 'DEBITO' ? 'Débito' : 'Crédito';
      const valor = Number(a.valor || 0);
      const descricao = String(a.descricao || '').trim() || 'Sem descrição';
      return `<tr><td>${tipo}</td><td>${descricao}</td><td style="text-align:right">${formatarMoedaRelatorio_(valor)}</td></tr>`;
    }).join('');

    blocoAjustesDetalhados = `
      <div class="summary" style="margin-top:14px">
        <h2 class="summary-title">Ajustes Aplicados</h2>
        <table class="summary-grid">
          <tr><td><strong>Tipo</strong></td><td><strong>Descrição</strong></td><td style="text-align:right"><strong>Valor</strong></td></tr>
          ${linhas}
        </table>
      </div>
    `;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: A4; margin: 12mm; }
    html, body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    * {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f4f6fb !important;
      color: #0f172a;
      font: 13px/1.4 "Avenir Next", "Segoe UI", sans-serif;
      padding: 20px;
    }

    .page {
      background: #ffffff !important;
      border: 1px solid #d9e2f2;
      border-radius: 16px;
      overflow: hidden;
    }

    .hero {
      background-color: #0a4ea3 !important;
      color: #fff;
      padding: 16px 20px;
    }

    .hero-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .hero-left {
      width: 78%;
      vertical-align: top;
    }

    .hero-right {
      width: 22%;
      text-align: right;
      vertical-align: middle;
    }

    .hero-logo {
      max-width: 130px;
      max-height: 44px;
      height: auto;
      width: auto;
    }

    .hero h1 {
      margin: 0 0 4px;
      font-size: 22px;
      letter-spacing: .2px;
    }

    .hero p {
      margin: 0;
      opacity: .95;
      font-size: 12px;
    }

    .meta {
      width: 100%;
      border-collapse: separate;
      border-spacing: 10px;
      margin: 10px 12px 4px;
    }

    .card {
      background-color: #f8fbff !important;
      border: 1px solid #d7e6ff;
      border-radius: 10px;
      padding: 8px 10px;
      vertical-align: top;
      width: 33.33%;
    }

    .k {
      color: #475569;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: .4px;
    }

    .v {
      margin-top: 2px;
      font-weight: 700;
      font-size: 14px;
      color: #0f172a;
      word-break: break-word;
    }

    .content { padding: 6px 16px 18px; }
    h2 { margin: 6px 0 10px; font-size: 16px; color: #0b2447; }

    .event {
      border: 1px solid #d9e2f2;
      border-radius: 12px;
      margin-bottom: 10px;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .event-head {
      background-color: #f8fafc !important;
      padding: 9px 11px;
      border-bottom: 1px solid #d9e2f2;
    }

    .event-title {
      margin: 0;
      font-size: 13px;
      font-weight: 800;
      color: #0b2447;
    }

    .event-sub {
      margin-top: 3px;
      color: #475569;
      font-size: 11px;
    }

    .event-grid {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .event-cell {
      width: 33.33%;
      padding: 9px 11px;
      border-right: 1px solid #d9e2f2;
      vertical-align: top;
    }

    .event-cell:last-child { border-right: 0; }

    .label {
      color: #475569;
      font-size: 11px;
      margin-bottom: 4px;
    }

    .value {
      font-size: 15px;
      font-weight: 800;
      color: #0f172a;
    }

    .value.ok { color: #0f766e; }
    .value.accent { color: #7c3aed; }

    .event-alert {
      margin: 8px 10px 0;
      padding: 7px 10px;
      border-radius: 8px;
      background-color: #fff7ed !important;
      border: 1px solid #fed7aa;
      color: #9a3412;
      font-size: 11px;
      font-weight: 600;
    }

    .base-desc {
      border-top: 1px solid #d9e2f2;
      padding: 8px 11px;
      color: #475569;
      font-size: 11px;
    }

    .summary {
      margin-top: 12px;
      border-radius: 14px;
      padding: 12px 14px;
      color: #fff;
      background-color: #1e3a8a !important;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .summary-title {
      margin: 0 0 10px;
      color: #ffffff !important;
    }

    .summary-grid {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .summary-grid td {
      padding: 5px 0;
      border-bottom: 1px solid rgba(255,255,255,.20);
      font-size: 13px;
      color: #ffffff;
    }

    .summary-grid tr:last-child td {
      border-bottom: 0;
    }

    .summary-grid td:last-child {
      text-align: right;
      font-weight: 700;
    }

    .final {
      margin-top: 8px;
      text-align: center;
      font-size: 20px;
      font-weight: 900;
      letter-spacing: .2px;
    }

    .foot {
      margin-top: 10px;
      color: #dbeafe;
      text-align: center;
      font-size: 10px;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="hero">
      <table class="hero-table">
        <tr>
          <td class="hero-left">
            <h1>Fechamento de Comissão</h1>
            <p>Demonstrativo profissional de comissões - Banda Fernando Amorim</p>
          </td>
          <td class="hero-right">
            ${logoDataUri ? `<img class="hero-logo" src="${logoDataUri}" alt="Logo">` : ''}
          </td>
        </tr>
      </table>
    </div>

    <table class="meta">
      <tr>
        <td class="card">
          <div class="k">Fechamento</div>
          <div class="v">${idFechamento}</div>
        </td>
        <td class="card">
          <div class="k">Vendedor</div>
          <div class="v">${vendedor.nome}</div>
        </td>
        <td class="card">
          <div class="k">Data de geracao</div>
          <div class="v">${dataFmt}</div>
        </td>
      </tr>
    </table>

    <div class="content">
      <h2>Detalhamento por Evento</h2>
      ${blocosEventos || '<div>Nenhum evento encontrado para este fechamento.</div>'}
      ${blocoAjustesDetalhados}

      <div class="summary">
        <table class="summary-grid">
          <tr><td>Total Comissões</td><td>${formatarMoedaRelatorio_(totalComissao)}</td></tr>
          <tr><td>Ajuste Crédito</td><td>${formatarMoedaRelatorio_(ajusteCredito)}</td></tr>
          <tr><td>Ajuste Débito</td><td>${formatarMoedaRelatorio_(ajusteDebito)}</td></tr>
        </table>
        <div class="final">VALOR FINAL: ${formatarMoedaRelatorio_(valorFinal)}</div>
        <div class="foot">Documento gerado automaticamente pelo sistema | ${dataFmt}</div>
      </div>
    </div>
  </div>
</body>
</html>
`;
}

/* ================= UTIL ================= */

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function formatarMoedaRelatorio_(valor) {
  return 'R$ ' + Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Converte URL de logo em data URI para render consistente no PDF do Apps Script.
 * Se falhar, retorna string vazia e o template segue sem logo (sem quebrar layout).
 */
function montarLogoDataUriParaPdf_(logoUrl) {
  if (!logoUrl) return '';

  try {
    const ref = String(logoUrl || '').trim();

    // 1) Já é data URI
    if (ref.indexOf('data:image/') === 0) {
      return ref;
    }

    // 2) Google Drive (ID direto ou URL)
    const driveId = extrairDriveFileId_(ref);
    if (driveId) {
      try {
        const file = DriveApp.getFileById(driveId);
        return blobParaDataUriImagem_(file.getBlob(), ref);
      } catch (driveErr) {
        registrarFalhaLogoPdf_('DRIVE_FALHA', {
          ref: ref,
          detalhe: String(driveErr && driveErr.message ? driveErr.message : driveErr)
        });
        return '';
      }
    }

    // 3) URL externa (tentativa dupla para reduzir bloqueio por host)
    const tentativas = [
      {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (AppsScript PDF Renderer)' }
      },
      {
        muteHttpExceptions: true,
        followRedirects: true
      }
    ];

    for (let i = 0; i < tentativas.length; i++) {
      const resp = UrlFetchApp.fetch(ref, tentativas[i]);
      const code = resp.getResponseCode();
      if (code < 200 || code >= 300) continue;

      try {
        return blobParaDataUriImagem_(resp.getBlob(), ref);
      } catch (tipoErr) {
        registrarFalhaLogoPdf_('TIPO_INVALIDO', {
          ref: ref,
          detalhe: String(tipoErr && tipoErr.message ? tipoErr.message : tipoErr)
        });
        return '';
      }
    }

    registrarFalhaLogoPdf_('HTTP_FALHA', { ref: ref });
    return '';
  } catch (err) {
    registrarFalhaLogoPdf_('EXCECAO', {
      ref: String(logoUrl || ''),
      detalhe: String(err && err.message ? err.message : err)
    });
    return '';
  }
}

function extrairDriveFileId_(ref) {
  const raw = String(ref || '').trim();
  if (!raw) return '';

  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;

  const m = raw.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || raw.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : '';
}

function blobParaDataUriImagem_(blob, origem) {
  const ctRaw = String(blob.getContentType() || '').toLowerCase().trim();
  const ct = ctRaw === 'image/jpg' ? 'image/jpeg' : ctRaw;
  const permitidos = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

  if (!permitidos.includes(ct)) {
    throw new Error('Tipo não suportado para logo: ' + ct + ' origem=' + String(origem || ''));
  }

  const base64 = Utilities.base64Encode(blob.getBytes());
  return 'data:' + ct + ';base64,' + base64;
}

function registrarFalhaLogoPdf_(codigo, detalhesObj) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('LOGS');
    if (!sh) return;

    const idLog = 'LOGO-' + Date.now();
    const detalhes = JSON.stringify({
      tipo: 'PDF_LOGO',
      codigo: String(codigo || ''),
      ...detalhesObj
    });

    sh.appendRow([
      idLog,
      new Date(),
      'SISTEMA',
      'GERAR_PDF_COMISSAO',
      'RELATORIO_PDF',
      '',
      detalhes
    ]);
  } catch (_) {}
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
