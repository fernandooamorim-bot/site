(() => {
  'use strict';

  const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const $ = (id) => document.getElementById(id);
  const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(num(value));
  const moneyExact = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num(value));
  const pct = (value, digits = 1) => value === null || value === undefined ? '—' : `${num(value).toFixed(digits).replace('.', ',')}%`;
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const text = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  let lastData = null;
  let lastContext = { month: 0 };

  function selectMonth(items) {
    const month = num(lastContext.month);
    return month ? (items || []).filter((item) => num(item.mes) === month) : (items || []);
  }
  function sum(items, field) { return (items || []).reduce((total, item) => total + num(item[field]), 0); }
  function scopedSummary(intel) {
    const month = num(lastContext.month);
    if (!month) return intel.resumo || {};
    const rows = selectMonth(intel.auditoria);
    const costs = sum(rows, 'custoTotalProjetado');
    const contract = sum(rows, 'contrato');
    return {
      eventos: rows.length, realizados: rows.filter((item) => !item.futuro).length, futuros: rows.filter((item) => item.futuro).length,
      contrato: contract, recebido: sum(rows, 'recebido'), aReceber: sum(rows, 'aReceber'),
      custosProcessados: sum(rows, 'custosProcessados'), custosRestantes: sum(rows, 'custosRestantes'), custoTotalProjetado: costs,
      caixaLiquidoAtual: sum(rows, 'caixaLiquidoAtual'), contratoLiquidoProjetado: sum(rows, 'contratoLiquidoProjetado'), saldoFuturoLiquido: sum(rows, 'saldoFuturoLiquido'),
      folhaEstimada: rows.reduce((total, item) => total + num(item.estimativaFolha?.valor), 0),
      folhaEstimadaFutura: rows.filter((item) => item.futuro).reduce((total, item) => total + num(item.estimativaFolha?.valor), 0),
      comissaoProcessada: rows.reduce((total, item) => total + num(item.composicaoProcessada?.comissao), 0),
      comissaoComprometida: rows.reduce((total, item) => total + num(item.composicao?.comissao), 0),
      margemProjetada: contract > 0 ? (sum(rows, 'contratoLiquidoProjetado') / contract) * 100 : null,
      recebimentoPct: contract > 0 ? (sum(rows, 'recebido') / contract) * 100 : null
    };
  }

  function activateTab(target) {
    document.querySelectorAll('[data-dashboard-tab]').forEach((tab) => {
      const active = tab.dataset.dashboardTab === target;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-dashboard-panel]').forEach((panel) => {
      const active = panel.dataset.dashboardPanel === target;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
  }

  function renderTabs() {
    document.querySelectorAll('[data-dashboard-tab]').forEach((button) => {
      if (button.dataset.bound === '1') return;
      button.dataset.bound = '1';
      button.addEventListener('click', () => {
        activateTab(button.dataset.dashboardTab);
      });
    });
    document.querySelectorAll('[data-open-workspace]').forEach((link) => {
      if (link.dataset.workspaceBound === '1') return;
      link.dataset.workspaceBound = '1';
      link.addEventListener('click', () => activateTab(link.dataset.openWorkspace));
    });
  }

  function renderOverview(intel, summary, data) {
    text('intelCashNow', money(summary.caixaLiquidoAtual));
    text('intelCashNowSub', `${money(summary.recebido)} recebido − ${money(summary.custosProcessados)} processado`);
    text('intelNetContract', money(summary.contratoLiquidoProjetado));
    text('intelNetMargin', `Margem econômica estimada: ${pct(summary.margemProjetada)}`);
    text('intelFutureNet', money(summary.saldoFuturoLiquido));
    text('intelFutureNetSub', `${money(summary.aReceber)} a receber − ${money(summary.custosRestantes)} em custos restantes`);
    text('intelExecution', `${num(summary.realizados)} / ${num(summary.eventos)}`);
    text('intelExecutionSub', `${num(summary.realizados)} realizados · ${num(summary.futuros)} ainda faltam`);
    const ticket = num(summary.eventos) ? num(summary.contrato) / num(summary.eventos) : 0;
    const goal = data?.analise?.meta || {};
    const goalPercent = num(goal.percentual) || (num(goal.alvo) > 0 ? num(goal.realizado) / num(goal.alvo) * 100 : 0);
    text('intelTicket', money(ticket));
    text('intelGoal', num(goal.alvo) > 0 ? pct(goalPercent) : 'Não definida');
    text('intelGoalSub', num(goal.alvo) > 0 ? `${money(goal.realizado)} de ${money(goal.alvo)}` : 'Meta anual indisponível');
    text('intelReceiptPulse', pct(summary.recebimentoPct));
    text('intelCostPulse', num(summary.contrato) > 0 ? pct(num(summary.custoTotalProjetado) / num(summary.contrato) * 100) : '—');

    const monthly = selectMonth(intel.mensalEconomico);
    const max = Math.max(1, ...(monthly || []).flatMap((item) => [num(item.contrato), num(item.recebido), num(item.custosProcessados) + num(item.custosRestantes)]));
    $('intelEconomicChart').innerHTML = monthly.length ? monthly.map((item) => {
      const totalCost = num(item.custosProcessados) + num(item.custosRestantes);
      return `<div class="intel-month"><div class="intel-bars"><i style="height:${num(item.contrato) / max * 100}%"></i><i class="received" style="height:${num(item.recebido) / max * 100}%"></i><i class="cost" style="height:${totalCost / max * 100}%"></i></div><small>${MONTHS[num(item.mes) - 1]}</small><div class="intel-month-tooltip"><strong>${MONTHS[num(item.mes) - 1]} · ${num(item.eventos)} eventos</strong><br>Contrato ${money(item.contrato)}<br>Recebido ${money(item.recebido)}<br>Custo total ${money(totalCost)}<br>Líquido projetado ${money(item.liquidoProjetado)}</div></div>`;
    }).join('') : '<div class="empty-intel">Sem eventos neste recorte.</div>';
    renderRanking('intelTypeExecution', intel.execucao?.porTipo || [], 'contrato', (item) => `${num(item.realizados)} realizados · ${num(item.futuros)} futuros`);
    renderRanking('intelProjectRanking', intel.rankings?.projetos || [], 'contrato', (item) => `${num(item.eventos)} eventos · margem ${pct(item.margemProjetada)}`, 10);
    renderRanking('intelCeremonialistRanking', (intel.rankings?.cerimonialistas || []).filter((item) => item.nome !== 'Sem cerimonialista'), 'contrato', (item) => `${num(item.eventos)} eventos · líquido ${money(item.liquidoProjetado)}`, 12);
    renderRanking('intelSellerPortfolio', (intel.rankings?.vendedores || []).filter((item) => item.nome !== 'Sem vendedor'), 'contrato', (item) => {
      const semComissao = num(item.eventosSemComissao);
      const comissao = semComissao ? `sem comissão em ${semComissao}` : `comissão ${money(item.comissaoComprometida)}`;
      return `${num(item.eventos)} eventos · ${comissao} · recebido ${money(item.recebido)}`;
    }, 10);
  }

  function renderRanking(id, items, field, metaFn, limit = 8) {
    const target = $(id);
    if (!target) return;
    const rows = items || [];
    const max = Math.max(1, ...rows.map((item) => num(item[field])));
    target.innerHTML = rows.length ? rows.slice(0, limit).map((item) => `<div class="intel-rank-row"><div class="intel-rank-copy"><strong title="${esc(item.nome)}">${esc(item.nome)}</strong><small>${esc(metaFn(item))}</small></div><div class="intel-rank-track"><i style="--width:${num(item[field]) / max * 100}%"></i></div><div class="intel-rank-value">${field === 'media' ? money(item[field]) : `${num(item.eventos)} · ${money(item[field])}`}</div></div>`).join('') : '<div class="empty-intel">Sem base suficiente neste recorte.</div>';
  }

  function renderReceipts(intel, summary) {
    text('intelReceiptsContract', money(summary.contrato));
    text('intelReceiptsEvents', `${num(summary.eventos)} eventos no recorte`);
    text('intelReceiptsPaid', money(summary.recebido));
    text('intelReceiptsRate', `${pct(summary.recebimentoPct)} do contratado`);
    text('intelReceiptsOpen', money(summary.aReceber));
    const movement = selectMonth(intel.recebimentos?.mensalMovimento || []);
    const movementNet = sum(movement, 'caixaLiquido');
    text('intelMovementNet', money(movementNet));
    const max = Math.max(1, ...movement.flatMap((item) => [num(item.entradasLiquidas), num(item.saidas)]));
    $('intelCashflowChart').innerHTML = movement.length ? movement.map((item) => `<div class="cashflow-row"><span>${MONTHS[num(item.mes) - 1]}</span><div class="cashflow-track"><i style="--width:${Math.max(0, num(item.entradasLiquidas)) / max * 100}%"></i><i class="out" style="--width:${num(item.saidas) / max * 100}%"></i></div><strong class="${num(item.caixaLiquido) < 0 ? 'neg' : ''}">${money(item.caixaLiquido)}</strong></div>`).join('') : '<div class="empty-intel">Sem movimentações neste recorte.</div>';
    const strongest = [...movement].sort((a, b) => num(b.entradasLiquidas) - num(a.entradasLiquidas))[0];
    const highestOut = [...movement].sort((a, b) => num(b.saidas) - num(a.saidas))[0];
    const negative = movement.filter((item) => num(item.caixaLiquido) < 0);
    const items = [
      strongest && { title: 'Maior entrada líquida', body: `${MONTHS[num(strongest.mes) - 1]} registrou ${money(strongest.entradasLiquidas)} em recebimentos líquidos.` },
      highestOut && { title: 'Maior concentração de saídas', body: `${MONTHS[num(highestOut.mes) - 1]} concentrou ${money(highestOut.saidas)} em custos processados.` },
      { title: 'Exposição a receber', body: `${money(summary.aReceber)} ainda dependem de recebimentos futuros (${pct(100 - num(summary.recebimentoPct))} do contrato).` },
      negative.length && { title: 'Meses com caixa negativo', body: `${negative.length} mês(es) tiveram mais saídas processadas que entradas pela data da movimentação.` }
    ].filter(Boolean);
    $('intelReceiptInsights').innerHTML = items.map((item) => `<div class="intel-insight"><span>↗</span><div><strong>${esc(item.title)}</strong><p>${esc(item.body)}</p></div></div>`).join('');
  }

  function renderCosts(intel, summary) {
    const scopedAudit = selectMonth(intel.auditoria || []);
    const definitions = [['COMISSAO', 'Comissões', 'comissao'], ['FOLHA', 'Folha de custos', 'folha'], ['BV', 'BV', 'bv'], ['NF', 'Notas fiscais', 'nf']];
    const rows = num(lastContext.month) ? definitions.map(([codigo, nome, field]) => {
      const processado = scopedAudit.reduce((total, item) => total + num(item.composicaoProcessada?.[field]), 0);
      const projetado = scopedAudit.reduce((total, item) => total + num(item.composicao?.[field]), 0);
      return { codigo, nome, processado, projetado, restante: Math.max(projetado - processado, 0), pctContrato: summary.contrato > 0 ? projetado / summary.contrato * 100 : null };
    }) : (intel.custos?.categorias || []);
    const max = Math.max(1, ...rows.map((item) => num(item.projetado)));
    $('intelCostComposition').innerHTML = rows.map((item) => {
      const processedWidth = num(item.processado) / max * 100;
      const remainingWidth = num(item.restante) / max * 100;
      return `<div class="cost-row"><div class="cost-row-name"><strong>${esc(item.nome)}</strong><small>${pct(item.pctContrato)} do contrato</small></div><div class="cost-stacked"><i style="--processed:${processedWidth}%"></i><b style="--remaining:${remainingWidth}%"></b></div><div class="cost-value"><small>Processado</small><strong>${money(item.processado)}</strong></div><div class="cost-value"><small>Restante</small><strong>${money(item.restante)}</strong></div></div>`;
    }).join('');
    text('intelFolhaAverage', money(intel.custos?.mediaFolhaGlobal));
    text('intelFolhaSample', `${num(intel.custos?.amostraFolhaGlobal)} folhas na base`);
    renderRanking('intelFolhaTypes', intel.custos?.porTipoFolha || [], 'media', (item) => `${num(item.amostra)} ocorrências`, 7);
    const monthly = selectMonth(intel.mensalEconomico);
    $('intelCostMonths').innerHTML = monthly.map((item) => `<div class="cost-month"><strong>${MONTHS[num(item.mes) - 1]}</strong><div><small>Processado</small><span>${money(item.custosProcessados)}</span></div><div><small>A reservar</small><span class="pending">${money(item.custosRestantes)}</span></div></div>`).join('');
    text('intelFutureFolha', money(summary.folhaEstimadaFutura));
  }

  function renderForecast(intel, summary) {
    text('intelFutureGross', money(summary.aReceber));
    text('intelFutureCosts', money(summary.custosRestantes));
    text('intelFutureLiquid', money(summary.saldoFuturoLiquido));
    text('intelFutureFolha', money(summary.folhaEstimadaFutura));
    text('intelFutureFolhaSub', `${num(intel.custos?.amostraFolhaGlobal)} folhas processadas sustentam a base geral`);
    const currentMonth = new Date().getMonth() + 1;
    $('intelAgendaForecast').innerHTML = (intel.formacaoAgenda?.meses || []).map((item) => {
      const noSample = !num(item.amostra);
      const open = num(item.eventosAtuais) === 0 && num(item.mes) >= currentMonth;
      return `<div class="agenda-cell${noSample ? ' no-sample' : ''}${open ? ' open-window' : ''}"><header><strong>${MONTHS[num(item.mes) - 1]}</strong><span>${num(item.eventosAtuais)}</span></header><p>${noSample ? 'Sem amostra histórica válida' : `Mediana ${item.medianaDias} dias · faixa ${item.p25Dias}–${item.p75Dias} dias · ${num(item.amostra)} casos`}<br>${item.fechadosCom180OuMaisPct === null ? '' : `${pct(item.fechadosCom180OuMaisPct)} fechados com 6+ meses`}</p></div>`;
    }).join('');
    const selectedYear = num($('yearFilter')?.value);
    $('intelYearComparison').innerHTML = `<table class="year-table"><thead><tr><th>Ano</th><th>Eventos</th><th>Contrato</th><th>Recebido</th><th>Ticket</th><th>Custos pagos</th><th>Líquido proj.</th><th>Margem</th></tr></thead><tbody>${(intel.comparativoAnual?.anos || []).map((item) => `<tr class="${num(item.ano) === selectedYear ? 'current' : ''}"><td>${num(item.ano)}</td><td>${num(item.eventos)}</td><td>${money(item.contrato)}</td><td>${money(item.recebido)}</td><td>${money(item.ticketMedio)}</td><td>${money(item.custosProcessados)}</td><td>${money(item.liquidoProjetado)}</td><td>${pct(item.margemProjetada)}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderCommissions(intel, summary) {
    const rows = selectMonth(intel.auditoria || []);
    const expected = summary.comissaoComprometida !== undefined
      ? num(summary.comissaoComprometida)
      : rows.reduce((total, item) => total + num(item.composicao?.comissao), 0);
    const paid = summary.comissaoProcessada !== undefined
      ? num(summary.comissaoProcessada)
      : rows.reduce((total, item) => total + num(item.composicaoProcessada?.comissao), 0);
    const open = Math.max(expected - paid, 0);
    text('intelCommissionExpected', money(expected));
    text('intelCommissionPaid', money(paid));
    text('intelCommissionOpen', money(open));
    text('intelCommissionPaidRate', expected > 0 ? `${pct(paid / expected * 100)} do compromisso processado` : 'Sem compromisso configurado');
    text('intelCommissionRate', summary.contrato > 0 ? pct(expected / summary.contrato * 100, 2) : '—');

    const months = [];
    for (let month = 1; month <= 12; month++) {
      const monthRows = (intel.auditoria || []).filter((item) => num(item.dataEvento) && new Date(num(item.dataEvento)).getMonth() + 1 === month);
      const committed = monthRows.reduce((total, item) => total + num(item.composicao?.comissao), 0);
      const processed = monthRows.reduce((total, item) => total + num(item.composicaoProcessada?.comissao), 0);
      months.push({ month, committed, processed, open: Math.max(committed - processed, 0) });
    }
    const shownMonths = num(lastContext.month) ? months.filter((item) => item.month === num(lastContext.month)) : months;
    $('intelCommissionMonths').innerHTML = shownMonths.map((item) => `<div class="commission-month"><strong>${MONTHS[item.month - 1]}</strong><div><small>Comprometida</small><span>${money(item.committed)}</span></div><div><small>Processada</small><span>${money(item.processed)}</span></div><div><small>A pagar</small><span class="open">${money(item.open)}</span></div></div>`).join('');

    const sellers = {};
    rows.forEach((item) => {
      const name = item.vendedor || 'Sem vendedor';
      const key = normalize(name) || 'sem vendedor';
      const seller = sellers[key] || { nome: name, variacoes: {}, eventos: 0, comprometida: 0, processada: 0, semComissao: 0 };
      seller.variacoes[name] = (seller.variacoes[name] || 0) + 1;
      seller.eventos++;
      seller.comprometida += num(item.composicao?.comissao);
      seller.processada += num(item.composicaoProcessada?.comissao);
      if (num(item.composicao?.comissao) <= 0) seller.semComissao++;
      sellers[key] = seller;
    });
    const ranking = Object.values(sellers).map((item) => {
      const nome = Object.keys(item.variacoes).sort((a, b) => item.variacoes[b] - item.variacoes[a] || a.localeCompare(b, 'pt-BR'))[0] || item.nome;
      return { ...item, nome, aberta: Math.max(item.comprometida - item.processada, 0) };
    }).sort((a, b) => b.comprometida - a.comprometida);
    const max = Math.max(1, ...ranking.map((item) => item.comprometida));
    $('intelCommissionSellers').innerHTML = ranking.length ? ranking.slice(0, 15).map((item) => `<div class="intel-rank-row"><div class="intel-rank-copy"><strong>${esc(item.nome)}</strong><small>${item.eventos} eventos · ${item.semComissao ? `sem comissão em ${item.semComissao} · ` : ''}pago ${money(item.processada)} · aberto ${money(item.aberta)}</small></div><div class="intel-rank-track"><i style="--width:${item.comprometida / max * 100}%"></i></div><div class="intel-rank-value">${money(item.comprometida)}</div></div>`).join('') : '<div class="empty-intel">Sem comissão no recorte.</div>';
  }

  function getAuditRows(intel) {
    const status = $('intelAuditStatus')?.value || 'TODOS';
    const query = normalize($('intelAuditSearch')?.value);
    const order = $('intelAuditOrder')?.value || 'DATA';
    const rows = selectMonth(intel.auditoria || []).filter((item) => {
      if (status === 'REALIZADOS' && item.futuro) return false;
      if (status === 'FUTUROS' && !item.futuro) return false;
      return !query || normalize(`${item.nomeEvento} ${item.tipoEvento} ${item.cerimonialista} ${item.projeto} ${item.vendedor}`).includes(query);
    });
    rows.sort((a, b) => {
      if (order === 'LIQUIDO_ASC') return num(a.contratoLiquidoProjetado) - num(b.contratoLiquidoProjetado);
      if (order === 'CUSTO_DESC') return num(b.custoTotalProjetado) - num(a.custoTotalProjetado);
      if (order === 'MARGEM_ASC') return num(a.margemProjetada) - num(b.margemProjetada);
      return num(a.dataEvento) - num(b.dataEvento);
    });
    return rows;
  }

  function renderAudit(intel) {
    const rows = getAuditRows(intel);
    $('intelAuditTable').innerHTML = rows.length ? `<table class="intel-audit-table"><thead><tr><th>Evento</th><th>Contrato</th><th>Recebido</th><th>A receber</th><th>Processado</th><th>Custo restante</th><th>Custo total</th><th>Caixa atual</th><th>Líquido proj.</th><th>Saldo futuro</th><th>Margem</th></tr></thead><tbody>${rows.map((item) => {
      const c = item.composicao || {};
      const detail = `Comissão ${moneyExact(c.comissao)} · Folha ${moneyExact(c.folha)} · BV ${moneyExact(c.bv)} · NF ${moneyExact(c.nf)} · Outros ${moneyExact(c.outros)}${num(item.estimativaFolha?.valor) > 0 ? ` · Folha estimada por ${item.estimativaFolha.origem} (${item.estimativaFolha.amostra} casos)` : ''}`;
      const date = new Intl.DateTimeFormat('pt-BR').format(new Date(num(item.dataEvento)));
      return `<tr><td><div class="event-name" title="${esc(item.nomeEvento)}"><strong>${esc(item.nomeEvento)}</strong><small>${date} · ${esc(item.tipoEvento)} · ${esc(item.cerimonialista)} · vendedor: ${esc(item.vendedor)}</small></div></td><td>${moneyExact(item.contrato)}</td><td>${moneyExact(item.recebido)}</td><td>${moneyExact(item.aReceber)}</td><td>${moneyExact(item.custosProcessados)}</td><td>${moneyExact(item.custosRestantes)}</td><td><details class="cost-detail"><summary>${moneyExact(item.custoTotalProjetado)}</summary><div>${esc(detail)}</div></details></td><td class="${num(item.caixaLiquidoAtual) < 0 ? 'negative' : 'positive'}">${moneyExact(item.caixaLiquidoAtual)}</td><td class="${num(item.contratoLiquidoProjetado) < 0 ? 'negative' : 'positive'}">${moneyExact(item.contratoLiquidoProjetado)}</td><td class="${num(item.saldoFuturoLiquido) < 0 ? 'negative' : 'positive'}">${moneyExact(item.saldoFuturoLiquido)}</td><td>${pct(item.margemProjetada)}</td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty-intel">Nenhum evento corresponde aos filtros da auditoria.</div>';
  }

  function renderReading(intel, summary) {
    const comparison = intel.comparativoAnual?.variacao || {};
    const biggestType = intel.rankings?.tipos?.[0];
    const biggestCeremonialist = (intel.rankings?.cerimonialistas || []).filter((item) => item.nome !== 'Sem cerimonialista')[0];
    const openMonths = (intel.formacaoAgenda?.meses || []).filter((item) => num(item.eventosAtuais) === 0 && num(item.amostra) >= 3);
    const costs = intel.custos?.categorias || [];
    const biggestCost = [...costs].sort((a, b) => num(b.projetado) - num(a.projetado))[0];
    const cards = [
      { type: 'CAIXA · REAL', title: 'Posição líquida já realizada', body: `O recorte tem ${money(summary.caixaLiquidoAtual)} em caixa líquido vinculado aos eventos: ${money(summary.recebido)} recebidos menos ${money(summary.custosProcessados)} em custos processados.` },
      { type: 'FUTURO · ESTIMATIVA', title: 'O que tende a sobrar do saldo futuro', body: `${money(summary.aReceber)} ainda devem entrar. Após ${money(summary.custosRestantes)} em custos restantes, a estimativa líquida é ${money(summary.saldoFuturoLiquido)}.` },
      { type: 'MARGEM · PROJEÇÃO', title: 'Resultado econômico da agenda', body: `O contrato líquido projetado é ${money(summary.contratoLiquidoProjetado)}, equivalente a ${pct(summary.margemProjetada)} do contratado.` },
      biggestCost && { type: 'CUSTOS', title: `${biggestCost.nome} é a maior categoria`, body: `Representa ${money(biggestCost.projetado)} projetados, sendo ${money(biggestCost.processado)} já processados e ${money(biggestCost.restante)} ainda necessários.` },
      biggestType && { type: 'PORTFÓLIO', title: `${biggestType.nome} lidera o mix`, body: `${biggestType.eventos} eventos somam ${money(biggestType.contrato)} contratados, com margem projetada de ${pct(biggestType.margemProjetada)}.` },
      biggestCeremonialist && { type: 'PARCERIAS', title: `${biggestCeremonialist.nome} lidera entre cerimonialistas`, body: `${biggestCeremonialist.eventos} eventos e ${money(biggestCeremonialist.contrato)} em contratos no recorte.` },
      comparison.contratoPct !== null && comparison.contratoPct !== undefined && { type: 'COMPARATIVO', title: `Contratado ${num(comparison.contratoPct) >= 0 ? 'cresceu' : 'recuou'} ${pct(Math.abs(num(comparison.contratoPct)))}`, body: `Comparação direta com o ano anterior usando o mesmo recorte de eventos ativos.` },
      openMonths.length && { type: 'AGENDA', title: `${openMonths.length} janela(s) sem evento`, body: `Há meses ainda abertos com histórico disponível. A ausência deve ser comparada à mediana de antecedência antes de ser tratada como risco comercial.` }
    ].filter(Boolean);
    $('intelReadingGrid').innerHTML = cards.map((item) => `<article class="reading-card"><header><strong>${esc(item.title)}</strong><span>${esc(item.type)}</span></header><p>${esc(item.body)}</p></article>`).join('');
    const premises = intel.premissas || {};
    $('intelPremises').className = 'premise-list';
    $('intelPremises').innerHTML = Object.entries(premises).map(([key, value]) => `<div><strong>${esc(key)}:</strong> ${esc(value)}</div>`).join('');
  }

  function bindAudit() {
    ['intelAuditStatus', 'intelAuditOrder'].forEach((id) => {
      const el = $(id);
      if (!el || el.dataset.bound === '1') return;
      el.dataset.bound = '1';
      el.addEventListener('change', () => lastData && renderAudit(lastData));
    });
    const search = $('intelAuditSearch');
    if (search && search.dataset.bound !== '1') {
      search.dataset.bound = '1';
      search.addEventListener('input', () => lastData && renderAudit(lastData));
    }
  }

  function render(data, context = {}) {
    renderTabs();
    bindAudit();
    const intel = data?.inteligencia;
    lastContext = context;
    if (!intel) return;
    lastData = intel;
    const summary = scopedSummary(intel);
    renderOverview(intel, summary, data);
    renderReceipts(intel, summary);
    renderCosts(intel, summary);
    renderCommissions(intel, summary);
    renderForecast(intel, summary);
    renderAudit(intel);
    renderReading(intel, summary);
  }

  window.DashboardV2Intelligence = { render };
})();
