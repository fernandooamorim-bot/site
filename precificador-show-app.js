/**
 * ═══════════════════════════════════════════════════════════
 * PRECIFICADOR DE SHOW - INTEGRADO AO SISTEMA PRINCIPAL
 * ═══════════════════════════════════════════════════════════
 */

let configuracoes = null;
let ultimoResultado = null;
let CURRENT_USER_EMAIL = '';

let loadingMessageTimer = null;
let loadingMessageIndex = 0;

const PRECIFICADOR_CACHE_KEY = 'precificadorShow:dataCache:v1';
const PRECIFICADOR_CACHE_TTL_MS = 5 * 60 * 1000;
const LOADING_MESSAGES = [
  'Verificando sessão...',
  'Validando acesso...',
  'Carregando precificador...',
  'Sincronizando parâmetros...',
  'Preparando ambiente...'
];

function normalizarPerfil(perfil) {
  return String(perfil || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function perfilPermitido(perfil) {
  const p = normalizarPerfil(perfil);
  return p === 'proprietario' || p === 'administrador' || p === 'admin' || p === 'socio';
}

document.addEventListener('DOMContentLoaded', async function () {
  showLoading();
  setupEventListeners();
  if (window.lucide) window.lucide.createIcons();

  try {
    if (!window.Auth) throw new Error('AUTH_NOT_LOADED');

    const auth = await Auth.apiCall('verificarUsuario');
    if (!auth || !auth.ok || !auth.user) throw new Error('NOT_AUTH');

    if (!perfilPermitido(auth.user.perfil)) {
      alert('Área disponível apenas para Proprietário e Administrador.');
      window.location.href = 'index.html';
      return;
    }

    CURRENT_USER_EMAIL = String(auth.user.email || localStorage.getItem('auth_email') || '').trim();
    if (auth.user.nome) localStorage.setItem('auth_nome', String(auth.user.nome));

    const cache = lerCachePrecificador_();
    const cacheValido = cachePrecificadorValido_(cache);

    if (cacheValido) {
      stopLoadingMessageRotation_();
      updateLoadingMessage('Abrindo versão em cache...');
      aplicarConfiguracoes_(cache.configuracoes);
      hideLoading();
      showApp();
      carregarConfiguracoes(true).catch((err) => {
        console.warn('Falha na sincronização em background:', err);
      });
    } else {
      await carregarConfiguracoes(false);
      hideLoading();
      showApp();
    }
  } catch (error) {
    console.error('❌ Erro na inicialização:', error);
    alert('Sessão inválida. Faça login novamente.');
    window.location.href = 'index.html';
  }
});

function setupEventListeners() {
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', () => Auth.logout());

  const bvTipo = document.getElementById('bv-tipo');
  if (bvTipo) {
    bvTipo.addEventListener('change', function () {
      const unidade = document.getElementById('bv-unidade');
      const input = document.getElementById('bv-valor');

      if (this.value === 'percentual') {
        unidade.textContent = '%';
        input.max = '100';
        input.step = '0.5';
        if (!input.value) input.value = '10';
      } else {
        unidade.textContent = 'R$';
        input.removeAttribute('max');
        input.step = '0.01';
        if (!input.value) input.value = '0';
      }
    });
  }

  const bvAtivo = document.getElementById('bv-ativo');
  if (bvAtivo) {
    bvAtivo.addEventListener('change', function () {
      const el = document.getElementById('bv-row');
      if (el) el.classList.toggle('active', this.checked);
    });
  }

  const nfAtivo = document.getElementById('nf-ativo');
  if (nfAtivo) {
    nfAtivo.addEventListener('change', function () {
      const el = document.getElementById('nf-row');
      if (el) el.classList.toggle('active', this.checked);
    });
  }
}

function showLoading(message) {
  const screen = document.getElementById('loading-screen');
  if (screen) {
    screen.classList.remove('hide');
    screen.classList.remove('hidden');
  }

  if (typeof message === 'string' && message.trim()) {
    stopLoadingMessageRotation_();
    updateLoadingMessage(message);
  } else {
    startLoadingMessageRotation_();
  }
}

function hideLoading() {
  stopLoadingMessageRotation_();
  const screen = document.getElementById('loading-screen');
  if (screen) screen.classList.add('hide');
}

function updateLoadingMessage(message) {
  const loadingMessage = document.getElementById('loading-message');
  if (loadingMessage) loadingMessage.textContent = message;
}

function startLoadingMessageRotation_() {
  stopLoadingMessageRotation_();
  loadingMessageIndex = 0;
  updateLoadingMessage(LOADING_MESSAGES[loadingMessageIndex]);
  loadingMessageTimer = setInterval(function () {
    loadingMessageIndex = (loadingMessageIndex + 1) % LOADING_MESSAGES.length;
    updateLoadingMessage(LOADING_MESSAGES[loadingMessageIndex]);
  }, 1400);
}

function stopLoadingMessageRotation_() {
  if (loadingMessageTimer) {
    clearInterval(loadingMessageTimer);
    loadingMessageTimer = null;
  }
}

function showApp() {
  const app = document.getElementById('app-screen');
  if (app) app.classList.remove('hidden');

  const nomeAtual = String(localStorage.getItem('auth_nome') || '').trim();
  const emailAtual = CURRENT_USER_EMAIL || localStorage.getItem('auth_email') || '';

  const emailElem = document.getElementById('user-email');
  if (emailElem) emailElem.textContent = emailAtual;

  const ghName = document.getElementById('ghName');
  if (ghName) ghName.textContent = nomeAtual ? nomeAtual.split(' ')[0] : 'Usuário';

  const ghAvatar = document.getElementById('ghAvatar');
  if (ghAvatar) {
    if (!nomeAtual) {
      ghAvatar.textContent = 'US';
    } else {
      const partes = nomeAtual.split(' ').filter(Boolean);
      ghAvatar.textContent = partes.length >= 2
        ? (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
        : nomeAtual.slice(0, 2).toUpperCase();
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

async function apiPost(action, data = {}) {
  try {
    console.log(`📡 API POST: ${action}`);

    const payload = Object.assign({}, data || {});
    const resp = await Auth.apiCall(
      'precificadorShowProxy',
      Object.assign(
        {
          externalAction: action,
          payloadJson: JSON.stringify(payload)
        },
        payload
      )
    );

    if (!resp || resp.sucesso !== true) {
      throw new Error(resp?.mensagem || resp?.error || 'Falha na integração com Precificador de Show');
    }

    if (resp.debug && resp.debug.endpointUtilizado) {
      console.log('[PrecificadorShowProxy] endpoint:', resp.debug.endpointUtilizado);
    }

    const result = resp.data || {};
    if (result.error) throw new Error(String(result.error));

    if (resp.debug && resp.debug.endpointUtilizado) {
      result.__debugEndpoint = resp.debug.endpointUtilizado;
    }

    return result;
  } catch (error) {
    console.error('❌ Erro na requisição:', error);
    throw error;
  }
}

async function carregarConfiguracoes(background = false) {
  console.log('📥 Carregando configurações do precificador...');

  if (!background) showLoading('Carregando precificador...');

  const cache = lerCachePrecificador_();
  const cacheValido = cachePrecificadorValido_(cache);
  const cacheExpirado = cachePrecificadorExpirado_(cache);

  try {
    const response = await apiPost('getConfiguracoes', {});

    if (!response || response.success !== true || !response.data) {
      throw new Error(response?.error || 'Resposta inválida ao carregar configurações');
    }

    const assinaturaAtual = assinaturaDados_(response.data);
    const assinaturaCache = cacheValido ? String(cache.configHash || '') : '';

    if (cacheValido && !cacheExpirado && assinaturaAtual === assinaturaCache) {
      console.log('✅ Cache do Precificador válido e configurações inalteradas.');
      if (!background) {
        aplicarConfiguracoes_(cache.configuracoes);
      }
      return;
    }

    if (background) {
      stopLoadingMessageRotation_();
      updateLoadingMessage('Atualizando parâmetros da planilha...');
    }

    aplicarConfiguracoes_(response.data);
    salvarCachePrecificador_(response.data, assinaturaAtual);
  } catch (error) {
    if (!cacheValido) {
      console.error('❌ Erro ao carregar configurações:', error);
      mostrarErro('Erro ao carregar configurações: ' + String(error.message || error));
      throw error;
    }
    console.warn('⚠️ Falha ao atualizar configurações; mantendo cache:', error);
  }
}

function aplicarConfiguracoes_(cfg) {
  configuracoes = cfg || {};
  const musicos = Array.isArray(configuracoes.musicos) ? configuracoes.musicos : [];
  const terceirizados = Array.isArray(configuracoes.terceirizados) ? configuracoes.terceirizados : [];
  const frontend = configuracoes.frontend || {};
  const parametros = configuracoes.parametros || {};

  renderizarMusicos(musicos, frontend);
  renderizarTerceirizados(terceirizados);
  carregarParametrosPadrao(parametros);
}

function lerCachePrecificador_() {
  try {
    const raw = localStorage.getItem(PRECIFICADOR_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function salvarCachePrecificador_(cfg, hash) {
  try {
    localStorage.setItem(PRECIFICADOR_CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      configHash: String(hash || ''),
      configuracoes: cfg || {}
    }));
  } catch (e) {
    console.warn('Falha ao salvar cache do precificador:', e);
  }
}

function cachePrecificadorValido_(cache) {
  return !!(cache && cache.ts && cache.configuracoes && cache.configHash);
}

function cachePrecificadorExpirado_(cache) {
  if (!cache || !cache.ts) return true;
  return (Date.now() - Number(cache.ts)) > PRECIFICADOR_CACHE_TTL_MS;
}

function assinaturaDados_(dados) {
  try {
    return JSON.stringify(normalizarObjetoParaHash_(dados || {}));
  } catch (_) {
    return '';
  }
}

function normalizarObjetoParaHash_(value) {
  if (Array.isArray(value)) return value.map(normalizarObjetoParaHash_);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).sort().forEach((k) => { out[k] = normalizarObjetoParaHash_(value[k]); });
    return out;
  }
  return value;
}

function renderizarMusicos(musicos, frontendConfig) {
  const container = document.getElementById('musicos-list');
  if (!container) return;
  container.innerHTML = '';

  const exibirValores = frontendConfig && frontendConfig['Exibir Valores dos Músicos'];

  musicos.forEach((musico, index) => {
    const item = document.createElement('div');
    item.className = 'checkbox-item';

    const valorHtml = exibirValores
      ? `<span class="checkbox-value">R$ ${formatarMoeda(musico.valorFixo)}</span>`
      : `<span class="checkbox-value hidden">R$ ${formatarMoeda(musico.valorFixo)}</span>`;

    item.innerHTML = `
      <label class="checkbox-label">
        <input type="checkbox"
               id="musico-${index}"
               data-valor="${musico.valorFixo}"
               data-banda-completa="${musico.bandaCompleta}"
               data-banda-reduzida="${musico.bandaReduzida}"
               onchange="toggleCheckbox(this)">
        ${musico.funcao}
      </label>
      ${valorHtml}
    `;
    container.appendChild(item);
  });

  const loading = document.getElementById('musicos-loading');
  if (loading) loading.classList.add('hidden');
}

function renderizarTerceirizados(itens) {
  const container = document.getElementById('terceirizados-list');
  if (!container) return;
  container.innerHTML = '';

  itens.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'input-item';
    div.innerHTML = `
      <label class="input-label" for="terceirizado-${index}">
        ${item.nome}
        <span class="categoria-badge">${item.categoria}</span>
      </label>
      <input type="number"
             class="input-valor"
             id="terceirizado-${index}"
             placeholder="R$ 0,00"
             min="0"
             step="0.01"
             oninput="atualizarInputTerceirizado(this)">
    `;
    container.appendChild(div);
  });
}

function carregarParametrosPadrao(parametros) {
  const bv = Number(parametros['BV Padrão (%)']);
  const nf = Number(parametros['NF Simples Nacional (%)']);
  if (!isNaN(bv)) document.getElementById('bv-valor').value = bv;
  if (!isNaN(nf)) document.getElementById('nf-valor').value = nf;
}

function selecionarTodos() {
  document.querySelectorAll('input[type="checkbox"][id^="musico-"]').forEach((cb) => {
    cb.checked = true;
    cb.closest('.checkbox-item').classList.add('active');
  });
}

function selecionarBandaCompleta() {
  document.querySelectorAll('input[type="checkbox"][id^="musico-"]').forEach((cb) => {
    const bandaCompleta = cb.dataset.bandaCompleta === 'true';
    cb.checked = bandaCompleta;
    cb.closest('.checkbox-item').classList.toggle('active', bandaCompleta);
  });
}

function selecionarBandaReduzida() {
  document.querySelectorAll('input[type="checkbox"][id^="musico-"]').forEach((cb) => {
    const bandaReduzida = cb.dataset.bandaReduzida === 'true';
    cb.checked = bandaReduzida;
    cb.closest('.checkbox-item').classList.toggle('active', bandaReduzida);
  });
}

function limparSelecao() {
  document.querySelectorAll('input[type="checkbox"][id^="musico-"]').forEach((cb) => {
    cb.checked = false;
    cb.closest('.checkbox-item').classList.remove('active');
  });
}

function toggleCheckbox(checkbox) {
  const item = checkbox.closest('.checkbox-item');
  if (item) item.classList.toggle('active', checkbox.checked);
}

function atualizarInputTerceirizado(input) {
  const item = input.closest('.input-item');
  const valor = parseFloat(input.value) || 0;
  if (item) item.classList.toggle('has-value', valor > 0);
}

async function calcular() {
  if (!configuracoes || !configuracoes.musicos) {
    mostrarErro('Configurações ainda não carregadas.');
    return;
  }

  document.getElementById('resultado').classList.remove('show');
  document.getElementById('erro').classList.remove('show');
  document.getElementById('loading').classList.add('show');
  document.getElementById('btn-calcular').disabled = true;

  const dadosEvento = coletarDadosEvento();

  try {
    const response = await apiPost('calcular', { dados: dadosEvento });

    document.getElementById('loading').classList.remove('show');
    document.getElementById('btn-calcular').disabled = false;

    if (response.success) {
      ultimoResultado = response.data;
      exibirResultado(response.data);
    } else {
      mostrarErro(response.error || 'Erro desconhecido no cálculo');
    }
  } catch (error) {
    document.getElementById('loading').classList.remove('show');
    document.getElementById('btn-calcular').disabled = false;
    mostrarErro('Erro ao calcular: ' + String(error.message || error));
  }
}

function coletarDadosEvento() {
  const params = configuracoes && configuracoes.parametros ? configuracoes.parametros : {};
  const musicosCfg = Array.isArray(configuracoes.musicos) ? configuracoes.musicos : [];
  const terceCfg = Array.isArray(configuracoes.terceirizados) ? configuracoes.terceirizados : [];

  const dados = {
    musicos: [],
    terceirizados: [],
    comissao_fernando: params['Comissão Fernando (%)'] !== undefined ? params['Comissão Fernando (%)'] : 70,
    comissao_socio: params['Comissão Sócio (%)'] !== undefined ? params['Comissão Sócio (%)'] : 10,
    caixa_banda: params['Caixa da Banda (%)'] !== undefined ? params['Caixa da Banda (%)'] : 5,
    margem_sugestao: params['Margem Sugestão (%)'] !== undefined ? params['Margem Sugestão (%)'] : 15,
    bv: {
      ativo: document.getElementById('bv-ativo').checked,
      tipo: document.getElementById('bv-tipo').value,
      valor: parseFloat(document.getElementById('bv-valor').value) || 0
    },
    nf: {
      ativo: document.getElementById('nf-ativo').checked,
      valor: parseFloat(document.getElementById('nf-valor').value) || 0
    }
  };

  musicosCfg.forEach((musico, index) => {
    const checkbox = document.getElementById(`musico-${index}`);
    dados.musicos.push({
      funcao: musico.funcao,
      valorFixo: musico.valorFixo,
      selecionado: checkbox ? checkbox.checked : false
    });
  });

  terceCfg.forEach((item, index) => {
    const input = document.getElementById(`terceirizado-${index}`);
    const valor = parseFloat(input ? input.value : 0) || 0;
    dados.terceirizados.push({
      nome: item.nome,
      categoria: item.categoria,
      valor: valor
    });
  });

  return dados;
}

function exibirResultado(resultado) {
  const bd = resultado.breakdown || {};
  const frontendConfig = configuracoes.frontend || {};

  document.getElementById('valor-final').textContent = 'R$ ' + formatarMoeda(resultado.valor_final || 0);

  const breakdownComissoes = document.getElementById('breakdown-comissoes');
  if (frontendConfig['Exibir Breakdown Comissões']) {
    breakdownComissoes.classList.remove('hidden');
    document.getElementById('bd-comissao-fernando').textContent =
      'R$ ' + formatarMoeda(bd.comissao_fernando || 0) + ' (' + Number(bd.percentual_fernando || 0).toFixed(0) + '%)';
    document.getElementById('bd-comissao-socio').textContent =
      'R$ ' + formatarMoeda(bd.comissao_socio || 0) + ' (' + Number(bd.percentual_socio || 0).toFixed(0) + '%)';
    document.getElementById('bd-caixa-banda').textContent =
      'R$ ' + formatarMoeda(bd.comissao_caixa_banda || 0) + ' (' + Number(bd.percentual_caixa_banda || 0).toFixed(0) + '%)';
  } else {
    breakdownComissoes.classList.add('hidden');
  }

  document.getElementById('bd-musicos').textContent = 'R$ ' + formatarMoeda(bd.custos_musicos || 0);
  document.getElementById('bd-terceirizados').textContent = 'R$ ' + formatarMoeda(bd.custos_terceirizados || 0);

  const bvRow = document.getElementById('bd-bv-row');
  if ((bd.valor_bv || 0) > 0) {
    bvRow.style.display = 'flex';
    let bvTexto = 'R$ ' + formatarMoeda(bd.valor_bv || 0);
    if (bd.tipo_bv === 'percentual') bvTexto += ' (' + Number(bd.percentual_bv || 0).toFixed(1) + '%)';
    document.getElementById('bd-bv').textContent = bvTexto;
  } else {
    bvRow.style.display = 'none';
  }

  const nfRow = document.getElementById('bd-nf-row');
  if ((bd.valor_nf || 0) > 0) {
    nfRow.style.display = 'flex';
    document.getElementById('bd-nf').textContent =
      'R$ ' + formatarMoeda(bd.valor_nf || 0) + ' (' + Number(bd.percentual_nf || 0).toFixed(1) + '%)';
  } else {
    nfRow.style.display = 'none';
  }

  const destaqueFernando = document.getElementById('destaque-fernando');
  if (frontendConfig['Exibir Destaque Fernando']) {
    destaqueFernando.classList.remove('hidden');
    const tipoExibicao = frontendConfig['Tipo Exibição Destaque'] || 'Comissão Fernando';
    const destaqueLabel = document.getElementById('destaque-label');
    const destaqueValor = document.getElementById('destaque-valor');

    if (tipoExibicao === 'Comissão Total') {
      destaqueLabel.textContent = '✨ Comissão Total (Lucro)';
      destaqueValor.textContent = 'R$ ' + formatarMoeda(bd.total_comissoes || 0);
    } else if (tipoExibicao === 'Sugestão de Valor') {
      destaqueLabel.textContent = '💡 Valor Mínimo Sugerido (+' + Number(resultado.margem_sugestao_percentual || 0).toFixed(0) + '%)';
      destaqueValor.textContent = 'R$ ' + formatarMoeda(resultado.valor_sugestao || 0);
    } else if (tipoExibicao === 'Comissão do Vendedor') {
      destaqueLabel.textContent = '💰 Comissão do Vendedor';
      destaqueValor.textContent = 'R$ ' + formatarMoeda(bd.comissao_socio || 0);
    } else {
      destaqueLabel.textContent = '✨ Comissão Fernando';
      destaqueValor.textContent = 'R$ ' + formatarMoeda(bd.comissao_fernando || 0);
    }
  } else {
    destaqueFernando.classList.add('hidden');
  }

  const margemNegociacao = document.getElementById('margem-negociacao');
  if (frontendConfig['Exibir Margem Negociação']) {
    margemNegociacao.classList.remove('hidden');

    const valorMinimo = Number(resultado.valor_final || 0);
    const percentualBom = parseFloat(frontendConfig['Margem Bom (%)']) || 15;
    const percentualOtimo = parseFloat(frontendConfig['Margem Ótimo (%)']) || 30;

    const valorBom = valorMinimo * (1 + percentualBom / 100);
    const valorOtimo = valorMinimo * (1 + percentualOtimo / 100);

    document.getElementById('margem-valor-minimo').textContent = 'R$ ' + formatarMoeda(valorMinimo);
    document.getElementById('margem-valor-bom').textContent = 'R$ ' + formatarMoeda(valorBom);
    document.getElementById('margem-valor-otimo').textContent = 'R$ ' + formatarMoeda(valorOtimo);
    document.getElementById('margem-percent-bom').textContent = '+' + percentualBom.toFixed(0) + '%';
    document.getElementById('margem-percent-otimo').textContent = '+' + percentualOtimo.toFixed(0) + '%';
  } else {
    margemNegociacao.classList.add('hidden');
  }

  document.getElementById('resultado').classList.add('show');
  setTimeout(() => {
    document.getElementById('resultado').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

async function salvarHistorico() {
  if (!ultimoResultado) {
    alert('Nenhum cálculo para salvar!');
    return;
  }

  const nomeDefault = String(localStorage.getItem('auth_nome') || CURRENT_USER_EMAIL || '');
  const vendedor = prompt('Seu nome (vendedor):') || nomeDefault;

  const dadosEvento = coletarDadosEvento();
  dadosEvento.vendedor = vendedor;

  try {
    const response = await apiPost('salvarHistorico', {
      dados: dadosEvento,
      resultado: ultimoResultado,
      email: CURRENT_USER_EMAIL
    });

    if (response.success) {
      alert('✅ ' + (response.message || 'Salvo no histórico!'));
    } else {
      alert('❌ Erro ao salvar: ' + (response.error || 'Erro desconhecido'));
    }
  } catch (error) {
    alert('❌ Erro ao salvar: ' + String(error.message || error));
  }
}

function novaSimulacao() {
  document.querySelectorAll('input[type="checkbox"][id^="musico-"]').forEach((cb) => {
    cb.checked = false;
  });

  document.querySelectorAll('input[type="number"][id^="terceirizado-"]').forEach((input) => {
    input.value = '';
  });

  document.getElementById('bv-ativo').checked = false;
  document.getElementById('nf-ativo').checked = false;

  document.querySelectorAll('.checkbox-item, .input-item, .option-row').forEach((item) => {
    item.classList.remove('active', 'has-value');
  });

  document.getElementById('resultado').classList.remove('show');
  document.getElementById('erro').classList.remove('show');

  window.scrollTo({ top: 0, behavior: 'smooth' });
  ultimoResultado = null;
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function mostrarErro(mensagem) {
  const target = document.getElementById('erro-mensagem');
  if (target) target.textContent = mensagem;
  document.getElementById('erro').classList.add('show');
  setTimeout(() => {
    document.getElementById('erro').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

window.calcular = calcular;
window.selecionarTodos = selecionarTodos;
window.selecionarBandaCompleta = selecionarBandaCompleta;
window.selecionarBandaReduzida = selecionarBandaReduzida;
window.limparSelecao = limparSelecao;
window.toggleCheckbox = toggleCheckbox;
window.atualizarInputTerceirizado = atualizarInputTerceirizado;
window.salvarHistorico = salvarHistorico;
window.novaSimulacao = novaSimulacao;
