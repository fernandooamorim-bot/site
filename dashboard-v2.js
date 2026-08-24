(() => {
  'use strict';

  const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const CACHE_PREFIX = 'dashboard:v2beta:1';
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const state = { data: null, month: 0, eventLimit: 12, user: null, loading: false };

  const $ = (id) => document.getElementById(id);
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(number(value));
  const moneyExact = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(number(value));
  const pct = (value, digits = 0) => `${number(value).toFixed(digits).replace('.', ',')}%`;
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const dateValue = (value) => { const date = new Date(number(value)); return Number.isNaN(date.getTime()) ? null : date; };
  const dateText = (value) => { const date = dateValue(value); return date ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date).replace('.', '') : 'Sem data'; };
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

  function setText(id, value) { const element = $(id); if (element) element.textContent = value; }
  function setLoading(active) {
    state.loading = active;
    $('refreshButton').disabled = active;
    $('refreshButton').classList.toggle('is-loading', active);
    if (!state.data || !active) $('loadingOverlay').classList.toggle('hidden', !active);
  }
  function toast(message, error = false) {
    const element = $('toast');
    element.textContent = message;
    element.className = `toast show${error ? ' error' : ''}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { element.className = 'toast'; }, 3600);
  }

  function cacheKey(year) {
    const email = normalize(localStorage.getItem('auth_email')) || 'sem-email';
    const profile = normalize(localStorage.getItem('auth_perfil')) || 'sem-perfil';
    return `${CACHE_PREFIX}:${email}:${profile}:${year}`;
  }
  function readCache(year) {
    try {
      const payload = JSON.parse(localStorage.getItem(cacheKey(year)) || 'null');
      if (!payload || Date.now() - number(payload.savedAt) > CACHE_TTL_MS) return null;
      return payload.data || null;
    } catch (_) { return null; }
  }
  function saveCache(year, data) {
    try { localStorage.setItem(cacheKey(year), JSON.stringify({ savedAt: Date.now(), data })); } catch (_) {}
  }

  function profileAllowed(user) {
    const profile = normalize(user?.perfil || user?.PERFIL || localStorage.getItem('auth_perfil'));
    return !['musico', 'producao'].includes(profile);
  }
  function fillProfile(user) {
    const name = String(user?.nome || user?.NOME || localStorage.getItem('auth_nome') || 'Usuário').trim();
    const role = String(user?.perfil || user?.PERFIL || localStorage.getItem('auth_perfil') || 'Acesso executivo').trim();
    const initials = name.split(/\s+/).slice(0, 2).map((word) => word[0] || '').join('').toUpperCase();
    setText('profileName', name.split(' ')[0]);
    setText('profileRole', role);
    setText('profileAvatar', initials || 'FA');
  }

  function monthOptions() {
    $('monthFilter').insertAdjacentHTML('beforeend', MONTHS.map((month, index) => `<option value="${index + 1}">${month}</option>`).join(''));
  }
  function yearOptions(years = []) {
    const current = Number($('yearFilter').value) || new Date().getFullYear();
    const options = new Set([...years.map(Number), current, new Date().getFullYear()]);
    $('yearFilter').innerHTML = [...options].filter(Boolean).sort((a, b) => b - a).map((year) => `<option value="${year}"${year === current ? ' selected' : ''}>${year}</option>`).join('');
  }

  function sliceData() {
    const data = state.data || {};
    const month = state.month;
    const monthBucket = (data.mensal || []).find((item) => number(item.mes) === month);
    if (!month || !monthBucket) return { totals: data.totais || {}, events: data.eventos || [], risks: data.riscos || [], sellers: data.vendedores || [], monthly: data.mensal || [], isMonth: false };
    const events = (data.eventos || []).filter((event) => dateValue(event.dataEvento)?.getMonth() + 1 === month);
    const risks = (data.riscos || []).filter((risk) => dateValue(risk.dataEvento)?.getMonth() + 1 === month);
    const sellerMap = new Map();
    events.forEach((event) => {
      const key = event.nomeVendedor || 'Sem vendedor';
      const seller = sellerMap.get(key) || { nomeVendedor: key, eventos: 0, prevista: 0, paga: 0, aPagar: 0, futura: 0 };
      seller.eventos++;
      seller.prevista += number(event.comissaoPrevista);
      seller.paga += number(event.comissaoPaga);
      seller.aPagar += number(event.comissaoAPagar);
      if (event.futuro) seller.futura += number(event.comissaoAPagar);
      sellerMap.set(key, seller);
    });
    return {
      totals: {
        eventos: monthBucket.eventos,
        eventosFuturos: events.filter((event) => event.futuro).length,
        contratado: monthBucket.contratado,
        recebido: monthBucket.recebido,
        aReceber: monthBucket.aReceber,
        comissaoPrevista: monthBucket.comissaoPrevista,
        comissaoPaga: monthBucket.comissaoPaga,
        comissaoAPagar: monthBucket.comissaoAPagar,
        comissaoFutura: events.filter((event) => event.futuro).reduce((sum, event) => sum + number(event.comissaoAPagar), 0),
        comissaoProximos90Dias: events.filter((event) => {
          const eventDate = dateValue(event.dataEvento);
          return event.futuro && eventDate && eventDate.getTime() <= Date.now() + 90 * 86400000;
        }).reduce((sum, event) => sum + number(event.comissaoAPagar), 0),
        outrasSaidasPagas: monthBucket.outrasSaidasPagas,
        saidasPagas: monthBucket.saidasPagas,
        resultadoCaixa: monthBucket.resultadoCaixa,
        saldoProjetadoEventos: monthBucket.saldoProjetadoEvento
      },
      events, risks, sellers: [...sellerMap.values()].sort((a, b) => b.aPagar - a.aPagar), monthly: data.mensal || [], isMonth: true
    };
  }

  function renderMetrics(view) {
    const totals = view.totals;
    const receivedRate = totals.contratado > 0 ? totals.recebido / totals.contratado * 100 : 0;
    const commissionRate = totals.contratado > 0 ? totals.comissaoPrevista / totals.contratado * 100 : 0;
    const paidRate = totals.comissaoPrevista > 0 ? totals.comissaoPaga / totals.comissaoPrevista * 100 : 0;
    const variation = state.data?.comparativo?.variacoes?.contratadoPct;
    setText('metricContracted', money(totals.contratado));
    setText('metricContractedSub', `${number(totals.eventos)} eventos no ${view.isMonth ? 'mês' : 'período'}`);
    setText('metricContractedTrend', !view.isMonth && variation !== null && variation !== undefined ? `${variation >= 0 ? '↑' : '↓'} ${pct(Math.abs(variation), 1)} versus ano anterior` : 'Base: contratos dos eventos');
    setText('metricReceived', money(totals.recebido));
    setText('metricReceivedSub', `${pct(receivedRate, 1)} do vendido`);
    $('receivedProgress').style.width = `${Math.min(100, Math.max(0, receivedRate))}%`;
    setText('metricReceivable', money(totals.aReceber));
    setText('metricReceivableSub', `${pct(100 - Math.min(receivedRate, 100), 1)} ainda em aberto`);
    setText('metricFutureEvents', `${number(totals.eventosFuturos)} eventos futuros`);
    setText('metricCommission', money(totals.comissaoPrevista));
    setText('metricCommissionRate', `Taxa efetiva prevista: ${pct(commissionRate, 2)}`);
    setText('metricCommissionDue', money(totals.comissaoAPagar));
    setText('metricCommissionDueSub', `${pct(paidRate, 1)} da previsão já paga`);
    setText('metricCommission90', `${money(totals.comissaoProximos90Dias)} nos próximos 90 dias`);
    setText('metricResult', money(totals.resultadoCaixa));
    setText('metricResultSub', `${money(totals.saidasPagas)} em saídas processadas`);
    $('metricResult').style.color = number(totals.resultadoCaixa) < 0 ? 'var(--coral)' : '';

    const coverage = totals.comissaoAPagar > 0 ? totals.recebido / totals.comissaoAPagar : null;
    setText('insightCoverage', coverage === null ? 'Sem comissão em aberto' : `${coverage.toFixed(1).replace('.', ',')}×`);
    setText('insightCoverageText', coverage === null ? 'Nenhuma obrigação pendente neste recorte.' : 'Recebido disponível para cada R$ 1 de comissão pendente.');
    setText('insightProjected', money(totals.saldoProjetadoEventos));
    setText('insightRisks', `${view.risks.length} ${view.risks.length === 1 ? 'alerta' : 'alertas'}`);
    setText('insightRisksText', view.risks.some((risk) => risk.severidade === 'CRITICO') ? 'Há divergências críticas para conferência.' : 'Sem divergência crítica no recorte.');
  }

  function renderMonthly(view) {
    const monthly = view.monthly;
    const max = Math.max(1, ...monthly.flatMap((month) => [number(month.contratado), number(month.recebido), number(month.comissaoPrevista)]));
    $('monthlyChart').innerHTML = monthly.map((month) => {
      const label = MONTHS[number(month.mes) - 1];
      const heights = [month.contratado, month.recebido, month.comissaoPrevista].map((value) => Math.max(value > 0 ? 2 : 0, number(value) / max * 100));
      return `<div class="month-column" tabindex="0" data-month="${label}" data-month-value="${number(month.mes)}">
        <i class="month-bar" style="--height:${heights[0]}%"></i><i class="month-bar received" style="--height:${heights[1]}%"></i><i class="month-bar commission" style="--height:${heights[2]}%"></i>
        <div class="month-tooltip"><strong>${label} • ${number(month.eventos)} eventos</strong><span>Vendido <b>${money(month.contratado)}</b></span><span>Recebido <b>${money(month.recebido)}</b></span><span>Comissão <b>${money(month.comissaoPrevista)}</b></span></div>
      </div>`;
    }).join('');
    const strongest = [...monthly].sort((a, b) => number(b.contratado) - number(a.contratado))[0];
    setText('chartHighlight', strongest?.contratado > 0 ? `${MONTHS[strongest.mes - 1]} concentra o maior valor vendido: ${money(strongest.contratado)}` : 'Ainda não há valores para este período.');
    $('monthlyChart').querySelectorAll('.month-column').forEach((column) => column.addEventListener('click', () => {
      $('monthFilter').value = column.dataset.monthValue;
      state.month = number(column.dataset.monthValue);
      state.eventLimit = 12;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
  }

  function renderProjection(view) {
    const futureEvents = view.events.filter((event) => event.futuro);
    const futureTotal = futureEvents.reduce((sum, event) => sum + number(event.comissaoAPagar), 0);
    setText('futureCommission', money(futureTotal));
    setText('futureCommissionCount', `${futureEvents.length} eventos futuros com compromissos no recorte`);
    const monthMap = new Map();
    futureEvents.forEach((event) => {
      const month = dateValue(event.dataEvento)?.getMonth() + 1;
      if (!month) return;
      const item = monthMap.get(month) || { mes: month, value: 0, events: 0 };
      item.value += number(event.comissaoAPagar);
      item.events++;
      monthMap.set(month, item);
    });
    const futureMonths = [...monthMap.values()].filter((month) => month.value > 0).sort((a, b) => a.mes - b.mes).slice(0, 6);
    const max = Math.max(1, ...futureMonths.map((month) => month.value));
    $('projectionList').innerHTML = futureMonths.length ? futureMonths.map((month) => `<div class="projection-row"><span>${MONTHS[month.mes - 1]}</span><div class="projection-track"><i style="--width:${month.value / max * 100}%"></i></div><strong>${money(month.value)}</strong></div>`).join('') : '<div class="empty-state">Nenhum compromisso de comissão no recorte.</div>';
  }

  function renderCommission(view) {
    const totals = view.totals;
    const paidPct = totals.comissaoPrevista > 0 ? Math.min(100, totals.comissaoPaga / totals.comissaoPrevista * 100) : 0;
    $('commissionDonut').style.setProperty('--paid', `${paidPct * 3.6}deg`);
    setText('commissionDonutPct', pct(paidPct));
    setText('commissionExpected', money(totals.comissaoPrevista));
    setText('commissionPaid', money(totals.comissaoPaga));
    setText('commissionPending', money(totals.comissaoAPagar));
    setText('commissionHealth', totals.comissaoAPagar > 0 ? `${pct(paidPct, 1)} do compromisso já foi processado. Permanecem ${money(totals.comissaoAPagar)} previstos para fechamento.` : 'Todos os compromissos previstos no recorte estão processados ou não há comissão configurada.');
    setText('sellerCount', `${view.sellers.length} vendedores`);
    const max = Math.max(1, ...view.sellers.map((seller) => number(seller.prevista)));
    $('sellerList').innerHTML = view.sellers.length ? view.sellers.slice(0, 8).map((seller) => `<div class="seller-row">
      <div class="seller-name"><strong>${esc(seller.nomeVendedor)}</strong><small>${number(seller.eventos)} eventos</small></div>
      <div class="seller-bar"><i style="--width:${number(seller.prevista) / max * 100}%"></i></div>
      <div class="seller-value"><small>Previsto</small><strong>${money(seller.prevista)}</strong></div>
      <div class="seller-value"><small>A pagar</small><strong>${money(seller.aPagar)}</strong></div>
    </div>`).join('') : '<div class="empty-state">Nenhuma comissão por vendedor no recorte.</div>';
  }

  function riskLabel(type) {
    return ({
      COMISSAO_SEM_CONFIGURACAO: 'Comissão sem configuração',
      COMISSAO_PAGA_ACIMA_DA_PREVISAO: 'Comissão paga acima da previsão',
      COMISSAO_GERADA_ACIMA_DA_PREVISAO: 'Comissão gerada acima da previsão',
      EVENTO_PROXIMO_COM_SALDO_A_RECEBER: 'Evento próximo com saldo a receber'
    })[type] || 'Conferência financeira necessária';
  }
  function renderRisks(view) {
    setText('riskCount', view.risks.length);
    $('riskList').innerHTML = view.risks.length ? view.risks.slice(0, 7).map((risk) => `<div class="risk-row ${risk.severidade === 'CRITICO' ? 'critical' : ''}"><span class="risk-marker"></span><div class="risk-copy"><strong>${esc(riskLabel(risk.tipo))}</strong><p>${esc(risk.nomeEvento)} • ${dateText(risk.dataEvento)}</p></div><span class="risk-value">${money(risk.valor)}</span></div>`).join('') : '<div class="empty-state">Nenhum risco priorizado neste recorte.</div>';

    const q = state.data?.qualidade || {};
    const structural = number(q.eventosSemConfiguracaoComissao) + number(q.eventosComComissaoPagaAcimaPrevista) + number(q.eventosComComissaoGeradaAcimaPrevista);
    const total = Math.max(1, number(state.data?.totais?.eventos));
    const score = Math.max(0, (1 - structural / total) * 100);
    setText('qualityScore', pct(score));
    $('qualityList').innerHTML = [
      ['Sem configuração de comissão', q.eventosSemConfiguracaoComissao],
      ['Pago acima do previsto', q.eventosComComissaoPagaAcimaPrevista],
      ['Gerado acima do previsto', q.eventosComComissaoGeradaAcimaPrevista],
      ['Recebimento por espelho legado', q.eventosComFallbackRecebido]
    ].map(([label, value]) => `<div class="quality-row"><span>${esc(label)}</span><strong>${number(value)}</strong></div>`).join('');
    const premises = state.data?.premissas || {};
    $('premisesBox').innerHTML = Object.values(premises).map((text) => `<div>• ${esc(text)}</div>`).join('');
  }

  function filteredEvents(view) {
    const query = normalize($('eventSearch').value);
    return view.events.filter((event) => !query || normalize(`${event.nomeEvento} ${event.nomeVendedor}`).includes(query));
  }
  function renderEvents(view) {
    const events = filteredEvents(view);
    const visible = events.slice(0, state.eventLimit);
    $('eventsTableBody').innerHTML = visible.length ? visible.map((event) => `<tr>
      <td><div class="event-cell"><strong>${esc(event.nomeEvento)}</strong><small>${dateText(event.dataEvento)} • ${event.futuro ? 'Futuro' : 'Realizado'}</small></div></td>
      <td>${esc(event.nomeVendedor)}</td><td class="number">${moneyExact(event.valorTotal)}</td><td class="number">${moneyExact(event.aReceber)}</td><td class="number">${moneyExact(event.comissaoPrevista)}</td><td class="number ${number(event.comissaoAPagar) > 0 ? 'money-due' : ''}">${moneyExact(event.comissaoAPagar)}</td>
    </tr>`).join('') : '<tr><td colspan="6"><div class="empty-state">Nenhum evento encontrado.</div></td></tr>';
    setText('eventsCount', `${Math.min(visible.length, events.length)} de ${events.length} eventos`);
    $('showMoreEvents').hidden = visible.length >= events.length;
  }

  function render() {
    if (!state.data) return;
    const view = sliceData();
    renderMetrics(view);
    renderMonthly(view);
    renderProjection(view);
    renderCommission(view);
    renderRisks(view);
    renderEvents(view);
  }

  async function loadDashboard(force = false) {
    if (state.loading) return;
    const year = Number($('yearFilter').value) || new Date().getFullYear();
    setLoading(true);
    setText('dataStatus', force ? 'Atualizando dados financeiros…' : 'Carregando visão executiva…');
    try {
      let data = !force ? readCache(year) : null;
      let source = 'cache local';
      if (!data) {
        data = await Auth.apiCall('obterDashboardGestaoV2', { ano: year, incluirCancelados: false, forceRefresh: force });
        if (!data?.sucesso) throw new Error(data?.mensagem || 'Resposta inválida do dashboard');
        saveCache(year, data);
        source = 'dados atualizados';
      }
      state.data = data;
      yearOptions(data.anosDisponiveis || []);
      $('yearFilter').value = String(data.ano || year);
      render();
      setText('dataStatus', `Visão de ${data.ano} • ${source}`);
      setText('dataTimestamp', `Gerado ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(number(data.geradoEm) || Date.now()))}`);
      if (force) toast('Dashboard atualizado com sucesso.');
    } catch (error) {
      console.error('[DashboardV2]', error);
      setText('dataStatus', 'Não foi possível carregar a visão executiva.');
      toast('Falha ao carregar o Dashboard 2.0. Tente atualizar novamente.', true);
      if (!state.data) $('loadingOverlay').innerHTML = '<strong>Não foi possível carregar</strong><p>Confira sua conexão e tente novamente.</p><button class="refresh-button" type="button" onclick="location.reload()">Tentar novamente</button>';
    } finally { setLoading(false); }
  }

  function bindEvents() {
    $('refreshButton').addEventListener('click', () => loadDashboard(true));
    $('yearFilter').addEventListener('change', () => { state.month = 0; $('monthFilter').value = '0'; state.eventLimit = 12; loadDashboard(false); });
    $('monthFilter').addEventListener('change', (event) => { state.month = number(event.target.value); state.eventLimit = 12; render(); });
    $('eventSearch').addEventListener('input', () => { state.eventLimit = 12; renderEvents(sliceData()); });
    $('showMoreEvents').addEventListener('click', () => { state.eventLimit += 12; renderEvents(sliceData()); });
    $('togglePremises').addEventListener('click', () => { const box = $('premisesBox'); box.hidden = !box.hidden; $('togglePremises').firstChild.textContent = box.hidden ? 'Ver premissas dos cálculos ' : 'Ocultar premissas '; });
    $('logoutButton').addEventListener('click', () => Auth.logout());
    document.querySelectorAll('.mobile-nav a').forEach((link) => link.addEventListener('click', () => { document.querySelectorAll('.mobile-nav a').forEach((item) => item.classList.remove('active')); link.classList.add('active'); }));
  }

  async function init() {
    monthOptions();
    yearOptions([new Date().getFullYear()]);
    bindEvents();
    try {
      const auth = await Auth.apiCall('verificarUsuario');
      if (!auth?.ok || !profileAllowed(auth.user)) throw new Error('FORBIDDEN_DASHBOARD');
      state.user = auth.user;
      fillProfile(auth.user);
      await loadDashboard(false);
    } catch (error) {
      console.error('[DashboardV2Auth]', error);
      Auth.clearAuthStorage?.();
      location.href = 'index.html?menu=1';
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();
