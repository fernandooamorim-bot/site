/**
 * ═══════════════════════════════════════════════════════════
 * PRECIFICADOR DE SHOW - INTEGRADO AO SISTEMA PRINCIPAL
 * ═══════════════════════════════════════════════════════════
 */

let configuracoes = null;
let ultimoResultado = null;
let faixaSelecionada = 'ideal';
let CURRENT_USER_EMAIL = '';
let manualCostCounter = 0;
let edicaoProducaoAtiva = false;

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

    showApp();
    await carregarConfiguracoes();
    showApp();
  } catch (error) {
    console.error('❌ Erro na inicialização:', error);
    if (error && (error.name === 'AuthSessionError' || error.message === 'NOT_AUTH' || error.message === 'AUTH_NOT_LOADED')) {
      alert('Sessão inválida. Faça login novamente.');
      window.location.href = 'index.html';
      return;
    }
    showApp();
    mostrarErro('Não foi possível carregar as configurações do precificador. Tente novamente em instantes.');
  }
});

function setupEventListeners() {
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', () => Auth.logout());

  const btnEditarProducao = document.getElementById('btn-editar-producao');
  if (btnEditarProducao) {
    btnEditarProducao.addEventListener('click', function (event) {
      event.preventDefault();
      toggleEdicaoProducao();
    });
  }

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
    const result = await Auth.apiCall(action, data || {});
    if (!result || result.sucesso === false || result.error) {
      throw new Error(result?.mensagem || result?.error || 'Falha no Precificador de Show');
    }
    return result;
  } catch (error) {
    console.error('❌ Erro na requisição:', error);
    throw error;
  }
}

async function carregarConfiguracoes() {
  console.log('📥 Carregando configurações do precificador...');

  try {
    const response = await apiPost('obterPrecificadorShowFormulario', {});
    if (!response || response.sucesso !== true) throw new Error(response?.error || 'Resposta inválida ao carregar configurações');
    aplicarConfiguracoes_(response);
  } catch (error) {
    console.error('❌ Erro ao carregar configurações:', error);
    mostrarErro('Erro ao carregar configurações: ' + String(error.message || error));
    throw error;
  }
}

function aplicarConfiguracoes_(cfg) {
  configuracoes = cfg || {};
  const musicos = Array.isArray(configuracoes.equipe) ? configuracoes.equipe : [];
  const terceirizados = Array.isArray(configuracoes.custosPadrao) ? configuracoes.custosPadrao : [];
  const parametros = configuracoes.padroesComerciais || {};

  renderizarMusicos(musicos);
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

function renderizarMusicos(musicos) {
  const container = document.getElementById('musicos-list');
  if (!container) return;
  container.innerHTML = '';

  const exibirValores = frontendConfig && frontendConfig['Exibir Valores dos Músicos'];

  musicos.forEach((musico, index) => {
    const item = document.createElement('div');
    item.className = 'checkbox-item';

    item.innerHTML = `
      <label class="checkbox-label">
        <input type="checkbox"
               id="musico-${index}"
               data-id="${escaparAttr_(musico.id)}"
               data-banda-completa="${musico.bandaCompleta}"
               data-banda-reduzida="${musico.bandaReduzida}"
               onchange="toggleCheckbox(this)">
        ${musico.nome}
      </label>
      <div class="production-value-wrap">
        <input type="number"
               class="production-value-input hidden"
               id="musico-valor-${index}"
               min="0"
               step="0.01"
               placeholder="Valor excepcional"
               aria-label="Valor excepcional de ${escaparAttr_(musico.nome)}"
               oninput="atualizarValorMusicoManual(this)">
        <input type="text"
               class="production-value-input hidden"
               id="musico-motivo-${index}"
               placeholder="Motivo do ajuste"
               aria-label="Motivo do ajuste de ${escaparAttr_(musico.nome)}">
      </div>
    `;
    container.appendChild(item);
  });

  aplicarEstadoEdicaoProducao_();

  const loading = document.getElementById('musicos-loading');
  if (loading) loading.classList.add('hidden');
}

function toggleEdicaoProducao() {
  edicaoProducaoAtiva = !edicaoProducaoAtiva;
  aplicarEstadoEdicaoProducao_();
}

function aplicarEstadoEdicaoProducao_() {
  const btn = document.getElementById('btn-editar-producao');
  const note = document.getElementById('production-edit-note');

  if (btn) {
    btn.classList.toggle('active', edicaoProducaoAtiva);
    btn.textContent = edicaoProducaoAtiva ? 'Ajustes ativos' : 'Ajustar cachês';
  }

  if (note) note.classList.toggle('hidden', !edicaoProducaoAtiva);

  document.querySelectorAll('.checkbox-item').forEach((item) => {
    item.classList.toggle('manual-editing', edicaoProducaoAtiva);
  });

  document.querySelectorAll('.production-value-input').forEach((input) => {
    input.classList.toggle('hidden', !edicaoProducaoAtiva);
  });

  if (window.lucide) window.lucide.createIcons();
}

function atualizarValorMusicoManual(input) {
  const item = input.closest('.checkbox-item');
  const valor = parseFloat(input.value) || 0;
  if (item) item.classList.toggle('manual-value-edited', edicaoProducaoAtiva && valor > 0);
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

function adicionarItemManual(preset = {}) {
  const lista = document.getElementById('manual-costs-list');
  if (!lista) return;

  const id = ++manualCostCounter;
  const row = document.createElement('div');
  row.className = 'manual-cost-row';
  row.dataset.manualCostId = String(id);
  row.innerHTML = `
    <div class="manual-cost-main">
      <input type="text"
             class="manual-cost-name"
             id="manual-cost-name-${id}"
             placeholder="Ex: Passagem aérea, diária extra..."
             value="${escaparAttr_(preset.nome || '')}"
             oninput="atualizarItemManual(this)">
      <select class="manual-cost-category"
              id="manual-cost-category-${id}"
              onchange="atualizarItemManual(this)">
        ${montarOpcoesCategoriaManual_(preset.categoria || '')}
      </select>
    </div>
    <div class="manual-cost-side">
      <input type="number"
             class="manual-cost-value"
             id="manual-cost-value-${id}"
             placeholder="R$ 0,00"
             min="0"
             step="0.01"
             value="${Number(preset.valor || 0) > 0 ? Number(preset.valor || 0) : ''}"
             oninput="atualizarItemManual(this)">
      <button type="button"
              class="manual-cost-remove"
              onclick="removerItemManual(${id})"
              title="Remover item">
        <i data-lucide="trash-2"></i>
      </button>
    </div>
  `;

  lista.appendChild(row);
  atualizarEstadoItensManuais_();
  if (window.lucide) window.lucide.createIcons();

  const nomeInput = document.getElementById(`manual-cost-name-${id}`);
  if (nomeInput && !preset.nome) nomeInput.focus();
}

function montarOpcoesCategoriaManual_(selecionada) {
  const categorias = [
    'Produção',
    'Diária',
    'Transporte',
    'Hospedagem',
    'Passagem aérea',
    'Alimentação',
    'Equipamento',
    'Outro'
  ];
  return categorias.map((categoria) => {
    const selected = categoria === selecionada ? ' selected' : '';
    return `<option value="${escaparAttr_(categoria)}"${selected}>${categoria}</option>`;
  }).join('');
}

function removerItemManual(id) {
  const row = document.querySelector(`.manual-cost-row[data-manual-cost-id="${id}"]`);
  if (row) row.remove();
  atualizarEstadoItensManuais_();
}

function atualizarItemManual(input) {
  const row = input.closest('.manual-cost-row');
  if (!row) return;

  const valorInput = row.querySelector('.manual-cost-value');
  const nomeInput = row.querySelector('.manual-cost-name');
  const valor = parseFloat(valorInput ? valorInput.value : 0) || 0;
  const nome = String(nomeInput ? nomeInput.value : '').trim();

  row.classList.toggle('has-value', valor > 0 || !!nome);
  atualizarEstadoItensManuais_();
}

function atualizarEstadoItensManuais_() {
  const lista = document.getElementById('manual-costs-list');
  const empty = document.getElementById('manual-costs-empty');
  const rows = lista ? Array.from(lista.querySelectorAll('.manual-cost-row')) : [];
  if (empty) empty.classList.toggle('hidden', rows.length > 0);
}

function coletarItensManuais_() {
  return Array.from(document.querySelectorAll('.manual-cost-row')).map((row) => {
    const id = row.dataset.manualCostId;
    const nome = String(document.getElementById(`manual-cost-name-${id}`)?.value || '').trim();
    const categoria = String(document.getElementById(`manual-cost-category-${id}`)?.value || 'Produção').trim();
    const valor = parseFloat(document.getElementById(`manual-cost-value-${id}`)?.value || 0) || 0;

    return {
      nome: nome || categoria || 'Item manual',
      categoria: categoria || 'Produção',
      valor,
      manual: true
    };
  }).filter((item) => item.valor > 0);
}

function carregarParametrosPadrao(parametros) {
  const bv = Number(parametros.bvPercentual);
  const nf = Number(parametros.nfPercentual);
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
  if (!configuracoes || !configuracoes.equipe) {
    mostrarErro('Configurações ainda não carregadas.');
    return;
  }

  document.getElementById('resultado').classList.remove('show');
  document.getElementById('erro').classList.remove('show');
  document.getElementById('loading').classList.add('show');
  document.getElementById('btn-calcular').disabled = true;

  const dadosEvento = coletarDadosEvento();

  try {
    const response = await apiPost('simularPrecificadorShow', { simulacaoJson: JSON.stringify(dadosEvento) });

    document.getElementById('loading').classList.remove('show');
    document.getElementById('btn-calcular').disabled = false;

    if (response.sucesso) {
      ultimoResultado = response;
      exibirResultado(response);
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
  const musicosCfg = Array.isArray(configuracoes.equipe) ? configuracoes.equipe : [];
  const terceCfg = Array.isArray(configuracoes.custosPadrao) ? configuracoes.custosPadrao : [];

  const dados = {
    equipe: [],
    custos: [],
    comercial: {
      comissaoVendedor: Number(configuracoes?.padroesComerciais?.comissaoVendedor || 0),
      bv: {
        ativo: document.getElementById('bv-ativo').checked,
        tipo: document.getElementById('bv-tipo').value,
        valor: parseFloat(document.getElementById('bv-valor').value) || 0
      },
      nf: {
        ativo: document.getElementById('nf-ativo').checked,
        valor: parseFloat(document.getElementById('nf-valor').value) || 0
      }
    }
  };

  musicosCfg.forEach((musico, index) => {
    const checkbox = document.getElementById(`musico-${index}`);
    const valorManualInput = document.getElementById(`musico-valor-${index}`);
    const motivoManual = String(document.getElementById(`musico-motivo-${index}`)?.value || '').trim();
    const valorManual = parseFloat(valorManualInput ? valorManualInput.value : '');
    if (!checkbox || !checkbox.checked) return;
    const item = { id: String(checkbox.dataset.id || '') };
    if (edicaoProducaoAtiva && !isNaN(valorManual)) {
      item.ajuste = { ativo: true, valor: valorManual, motivo: motivoManual };
    }
    dados.equipe.push(item);
  });

  terceCfg.forEach((item, index) => {
    const input = document.getElementById(`terceirizado-${index}`);
    const valor = parseFloat(input ? input.value : 0) || 0;
    if (valor <= 0) return;
    dados.custos.push({
      descricao: item.nome,
      categoria: item.categoria,
      valor: valor
    });
  });

  coletarItensManuais_().forEach((item) => {
    dados.custos.push({ descricao: item.nome, categoria: item.categoria, valor: item.valor });
  });

  return dados;
}

function exibirResultado(resultado) {
  const faixas = resultado.faixas || {};
  const minimo = faixas.minimo || {};
  const ideal = faixas.ideal || {};
  const excelente = faixas.excelente || {};
  const custos = resultado.custos || {};
  const alertas = Array.isArray(resultado.alertas) ? resultado.alertas : [];

  document.getElementById('valor-final').textContent = 'R$ ' + formatarMoeda(minimo.valor || 0);
  const avisoPrincipal = document.querySelector('.resultado-alerta');
  if (avisoPrincipal) {
    avisoPrincipal.textContent = alertas.length
      ? '⚠️ ' + alertas[0]
      : '⚠️ Não ofereça abaixo deste valor.';
  }
  document.getElementById('margem-valor-minimo').textContent = 'R$ ' + formatarMoeda(minimo.valor || 0);
  document.getElementById('margem-valor-bom').textContent = 'R$ ' + formatarMoeda(ideal.valor || 0);
  document.getElementById('margem-valor-otimo').textContent = 'R$ ' + formatarMoeda(excelente.valor || 0);
  document.getElementById('margem-percent-bom').textContent = '+' + Number(ideal.percentualAumento || 0).toFixed(0) + '%';
  document.getElementById('margem-percent-otimo').textContent = '+' + Number(excelente.percentualAumento || 0).toFixed(0) + '%';
  document.getElementById('breakdown-comissoes').classList.add('hidden');
  document.getElementById('bd-musicos').textContent = 'R$ ' + formatarMoeda(custos.totalEquipe || 0);
  document.getElementById('bd-terceirizados').textContent = 'R$ ' + formatarMoeda(custos.totalCustos || 0);

  const bvRow = document.getElementById('bd-bv-row');
  if ((ideal.valorBv || 0) > 0) {
    bvRow.style.display = 'flex';
    document.getElementById('bd-bv').textContent = 'R$ ' + formatarMoeda(ideal.valorBv || 0);
  } else {
    bvRow.style.display = 'none';
  }

  const nfRow = document.getElementById('bd-nf-row');
  if ((ideal.valorNf || 0) > 0) {
    nfRow.style.display = 'flex';
    document.getElementById('bd-nf').textContent =
      'R$ ' + formatarMoeda(ideal.valorNf || 0);
  } else {
    nfRow.style.display = 'none';
  }

  const destaqueFernando = document.getElementById('destaque-fernando');
  destaqueFernando.classList.remove('hidden');
  document.getElementById('destaque-label').textContent = '💰 Comissão do Vendedor';
  document.getElementById('margem-negociacao').classList.remove('hidden');
  selecionarFaixa('ideal');

  document.getElementById('resultado').classList.add('show');
  setTimeout(() => {
    document.getElementById('resultado').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

function selecionarFaixa(faixa) {
  if (!ultimoResultado || !ultimoResultado.faixas || !ultimoResultado.faixas[faixa]) return;
  faixaSelecionada = faixa;
  const dados = ultimoResultado.faixas[faixa];
  const label = faixa === 'excelente' && Number(dados.bonusVendedor || 0) > 0
    ? '💰 Comissão do Vendedor · inclui bônus'
    : '💰 Comissão do Vendedor';
  document.getElementById('destaque-label').textContent = label;
  document.getElementById('destaque-valor').textContent = 'R$ ' + formatarMoeda(dados.comissaoVendedor || 0);
  document.querySelectorAll('[data-faixa-resultado]').forEach((item) => {
    item.classList.toggle('selected', item.dataset.faixaResultado === faixa);
  });
}

async function salvarHistorico() {
  if (!ultimoResultado) {
    alert('Nenhum cálculo para salvar!');
    return;
  }

  const dadosEvento = coletarDadosEvento();

  try {
    const response = await apiPost('salvarPrecificadorShowSimulacao', {
      simulacaoJson: JSON.stringify(dadosEvento),
      faixaSelecionada: faixaSelecionada
    });

    if (response.sucesso) {
      alert('✅ ' + (response.mensagem || 'Simulação salva!'));
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

  edicaoProducaoAtiva = false;
  document.querySelectorAll('.production-value-input').forEach((input) => {
    input.value = '';
  });
  aplicarEstadoEdicaoProducao_();

  const manualList = document.getElementById('manual-costs-list');
  if (manualList) manualList.innerHTML = '';
  manualCostCounter = 0;
  atualizarEstadoItensManuais_();

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
window.selecionarFaixa = selecionarFaixa;
window.selecionarTodos = selecionarTodos;
window.selecionarBandaCompleta = selecionarBandaCompleta;
window.selecionarBandaReduzida = selecionarBandaReduzida;
window.limparSelecao = limparSelecao;
window.toggleCheckbox = toggleCheckbox;
window.toggleEdicaoProducao = toggleEdicaoProducao;
window.atualizarValorMusicoManual = atualizarValorMusicoManual;
window.atualizarInputTerceirizado = atualizarInputTerceirizado;
window.adicionarItemManual = adicionarItemManual;
window.removerItemManual = removerItemManual;
window.atualizarItemManual = atualizarItemManual;
window.salvarHistorico = salvarHistorico;
window.novaSimulacao = novaSimulacao;

function escaparAttr_(valor) {
  return String(valor || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
