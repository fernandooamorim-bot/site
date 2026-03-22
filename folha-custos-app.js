/**
 * ═══════════════════════════════════════════════════════════
 * APLICAÇÃO PRINCIPAL - FOLHA DE CUSTOS (CORRIGIDO PARA CORS)
 * Banda Fernando Amorim
 * ═══════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════
// VARIÁVEIS GLOBAIS
// ═══════════════════════════════════════════════════════════

let configuracoes = null;
let musicos = [];
let pacotes = [];
let servicosTerceirizados = [];
let musicosSelecionados = new Map();
let terceirizadosAtivos = [];
let musicoEmAjuste = null;
let relatorioAtual = null; // Armazena relatório gerado
// Passagem de Som
let passagemDeSomAtiva = false;
let valorPassagemDeSom = 50;
let passagemDeSomPorMusico = {};

// Serviços Globalizados
let servicosDisponiveis = [];
let categoriasServicos = [];
let CURRENT_USER_EMAIL = '';
let loadingMessageTimer = null;
let loadingMessageIndex = 0;
const FOLHA_CACHE_KEY = 'folhaCustos:dataCache:v1';
const FOLHA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
let eventosAgendaFolhaCache = [];
let eventosAgendaFolhaCarregando = false;
const resumoFolhaEventoCache = new Map();
let eventosComPropostaFolhaCache = new Set();
let propostasPendentesPorEvento = new Map();
let eventosComPropostaFolhaCacheTs = 0;
let propostaPendenteAtual = null;
let eventoSelecionadoTemFolhaAtiva = false;
let reconciliandoPendenciasCache = false;

function setAgendaRecomendadosLoading_(ativo, texto) {
  const box = document.getElementById('agenda-evento-recomendados');
  if (!box) return;
  if (ativo) {
    box.innerHTML = `<span class="mini-loader"><span class="mini-loader-dot"></span>${String(texto || 'Carregando sugestões...')}</span>`;
  }
}

const LOADING_MESSAGES = [
  'Verificando sessão...',
  'Validando acesso...',
  'Carregando folha de custos...',
  'Sincronizando dados...',
  'Preparando ambiente...'
];

// ═══════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async function() {
  console.log('🚀 Iniciando sistema...');
  
  showLoading();

  setupEventListeners();
  if (window.lucide) window.lucide.createIcons();
  
  try {
    if (!window.Auth) throw new Error('AUTH_NOT_LOADED');
    const auth = await Auth.apiCall('verificarUsuario');
    if (!auth || !auth.ok || !auth.user) throw new Error('NOT_AUTH');

    const perfil = String(auth.user.perfil || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
    const permitido = (perfil === 'proprietario' || perfil === 'producao');
    if (!permitido) {
      alert('Área disponível apenas para Proprietário e Produção.');
      window.location.href = 'index.html';
      return;
    }

    CURRENT_USER_EMAIL = String(auth.user.email || localStorage.getItem('auth_email') || '').trim();
    if (auth.user.nome) localStorage.setItem('auth_nome', String(auth.user.nome));
    setAgendaRecomendadosLoading_(true, 'Carregando sugestões...');
    carregarEventosAgendaFolha_().catch(() => {
      setAgendaRecomendadosLoading_(false);
    });

    const cacheBoot = lerCacheFolhaCustos_();
    const podeInstantBoot = cacheFolhaValido_(cacheBoot);

    if (podeInstantBoot) {
      stopLoadingMessageRotation_();
      updateLoadingMessage('Abrindo versão em cache...');
      aplicarDadosBaseFolha_(
        cacheBoot.configuracoes,
        cacheBoot.musicos,
        cacheBoot.pacotes,
        cacheBoot.servicosTerceirizados
      );
      hideLoading();
      showApp();

      carregarDados().catch((syncError) => {
        console.warn('Falha ao sincronizar dados em background:', syncError);
      });
    } else {
      await carregarDados();
      hideLoading();
      showApp();
    }
  } catch (error) {
    console.error('❌ Erro na inicialização:', error);
    alert('Sessão inválida. Faça login novamente.');
    window.location.href = 'index.html';
  }
});

// ═══════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════

function setupEventListeners() {
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => Auth.logout());
  }
  
  const eventoForaCidade = document.getElementById('evento-fora-cidade');
  if (eventoForaCidade) {
    eventoForaCidade.addEventListener('change', function() {
      const badge = document.getElementById('adicional-info');
      if (this.checked) {
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }

      // 🔄 Força re-render dos cards para remover "Extra Fora da Cidade"
      renderMusicos();
      recalcular();
    });

    // Event listener para passagem de som
    const passagemCheckbox = document.getElementById('passagem-de-som-checkbox');
    if (passagemCheckbox) {
      passagemCheckbox.addEventListener('change', function() {
        passagemDeSomAtiva = this.checked;
        if (this.checked) {
          musicosSelecionados.forEach((_, musicoId) => {
            if (!(musicoId in passagemDeSomPorMusico)) {
              passagemDeSomPorMusico[musicoId] = true;
            }
          });
        } else {
          passagemDeSomPorMusico = {};
        }
        const badge = document.getElementById('passagem-info');
        if (this.checked) {
          badge.classList.remove('hidden');
          adicionarCheckboxesPassagemNosCards();
        } else {
          badge.classList.add('hidden');
          removerCheckboxesPassagemDosCards();
        }
        recalcular();
      });
    }
  }
  
  const tiposPdf = document.querySelectorAll('input[name="tipo-pdf"]');
  tiposPdf.forEach(radio => {
    radio.addEventListener('change', function() {
      const eventoUnico = document.getElementById('pdf-evento-unico');
      const periodo = document.getElementById('pdf-periodo');
      
      if (this.value === 'evento') {
        eventoUnico.classList.remove('hidden');
        periodo.classList.add('hidden');
      } else {
        eventoUnico.classList.add('hidden');
        periodo.classList.remove('hidden');
      }
    });
  });
  
  const adicionalExtra = document.getElementById('modal-adicional-extra');
  if (adicionalExtra) {
    adicionalExtra.addEventListener('input', atualizarTotalModal);
  }

  // 🔁 NOVO: atualizar resumo ao digitar nome e data do evento
  const nomeEventoInput = document.getElementById('evento-nome');
  const dataEventoInput = document.getElementById('evento-data');

  if (nomeEventoInput) {
    nomeEventoInput.addEventListener('input', recalcular);
  }

  if (dataEventoInput) {
    dataEventoInput.addEventListener('change', recalcular);
  }

  const agendaEventoBusca = document.getElementById('agenda-evento-busca');
  if (agendaEventoBusca) {
    agendaEventoBusca.addEventListener('input', function() {
      const inpId = document.getElementById('agenda-evento-id');
      const badge = document.getElementById('agenda-evento-vinculo-status');
      const eventoData = document.getElementById('evento-data');
      const eventoNome = document.getElementById('evento-nome');
      if (inpId) inpId.value = '';
      if (badge) badge.classList.add('hidden');
      if (eventoData) eventoData.value = '';
      if (eventoNome) eventoNome.value = '';
      propostaPendenteAtual = null;
      eventoSelecionadoTemFolhaAtiva = false;
      atualizarBotaoAcaoFolha_();
      buscarEventoAgendaFolha_(this.value);
    });
  }

  atualizarBotaoAcaoFolha_();
}

// ═══════════════════════════════════════════════════════════
// GERENCIAMENTO DE TELAS
// ═══════════════════════════════════════════════════════════

function showLoading(message) {
  const screen = document.getElementById('loading-screen');
  if (screen) {
    screen.classList.remove('hidden');
    if (typeof message === 'string' && message.trim()) {
      stopLoadingMessageRotation_();
      updateLoadingMessage(message);
    } else {
      startLoadingMessageRotation_();
    }
  }
}

function hideLoading() {
  stopLoadingMessageRotation_();
  const screen = document.getElementById('loading-screen');
  if (screen) {
    screen.classList.add('hidden');
  }
}

function updateLoadingMessage(message) {
  const elem = document.getElementById('loading-message');
  if (elem) {
    elem.textContent = message;
  }
}

function startLoadingMessageRotation_() {
  stopLoadingMessageRotation_();
  loadingMessageIndex = 0;
  updateLoadingMessage(LOADING_MESSAGES[loadingMessageIndex]);
  loadingMessageTimer = setInterval(() => {
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
  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  
  const emailAtual = CURRENT_USER_EMAIL || localStorage.getItem('auth_email') || '';
  const nomeAtual = String(localStorage.getItem('auth_nome') || '').trim();
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

// ═══════════════════════════════════════════════════════════
// CARREGAMENTO DE DADOS
// ═══════════════════════════════════════════════════════════


async function carregarDados() {
  try {
    console.log('📥 Carregando dados do sistema...');
    console.time('⏱️ Tempo total de carregamento');

    const cache = lerCacheFolhaCustos_();
    const cacheValido = cacheFolhaValido_(cache);
    const cacheExpirado = cacheExpirado_(cache);

    if (cacheValido) {
      aplicarDadosBaseFolha_(cache.configuracoes, cache.musicos, cache.pacotes, cache.servicosTerceirizados);
      stopLoadingMessageRotation_();
      updateLoadingMessage('Validando atualizações...');
    }

    const [configAtual, musicosData, pacotesData, servicosData] = await Promise.all([
      apiPost('getConfiguracoes', {}),
      apiPost('getMusicos', {}),
      apiPost('getPacotes', {}),
      apiPost('getServicos', {})
    ]);

    const assinaturaAtualConfig = assinaturaConfig_(configAtual);
    const assinaturaAtualMusicos = assinaturaConfig_(musicosData);
    const assinaturaAtualPacotes = assinaturaConfig_(pacotesData);
    const assinaturaAtualServicos = assinaturaConfig_(servicosData);

    const assinaturaCacheConfig = cacheValido ? String(cache.configHash || '') : '';
    const assinaturaCacheMusicos = cacheValido ? String(cache.musicosHash || '') : '';
    const assinaturaCachePacotes = cacheValido ? String(cache.pacotesHash || '') : '';
    const assinaturaCacheServicos = cacheValido ? String(cache.servicosHash || '') : '';

    const dadosBaseMudaram = (
      !cacheValido ||
      assinaturaAtualConfig !== assinaturaCacheConfig ||
      assinaturaAtualMusicos !== assinaturaCacheMusicos ||
      assinaturaAtualPacotes !== assinaturaCachePacotes ||
      assinaturaAtualServicos !== assinaturaCacheServicos
    );

    if (!dadosBaseMudaram && !cacheExpirado) {
      console.log('✅ Cache da Folha válido e dados base inalterados.');
      console.timeEnd('⏱️ Tempo total de carregamento');
      return;
    }

    stopLoadingMessageRotation_();
    updateLoadingMessage(
      dadosBaseMudaram
        ? 'Dados atualizados na planilha. Sincronizando...'
        : 'Sincronizando dados...'
    );

    aplicarDadosBaseFolha_(configAtual, musicosData, pacotesData, servicosData);
    salvarCacheFolhaCustos_(
      configAtual,
      musicosData,
      pacotesData,
      servicosData,
      assinaturaAtualConfig,
      assinaturaAtualMusicos,
      assinaturaAtualPacotes,
      assinaturaAtualServicos
    );

    console.timeEnd('⏱️ Tempo total de carregamento');
    
  } catch (error) {
    console.error('❌ Erro ao carregar dados:', error);
    throw error;
  }
}

function aplicarDadosBaseFolha_(configData, musicosData, pacotesData, servicosData) {
  configuracoes = configData || {};
  musicos = Array.isArray(musicosData) ? musicosData : [];
  pacotes = Array.isArray(pacotesData) ? pacotesData : [];
  servicosTerceirizados = Array.isArray(servicosData) ? servicosData : [];

  console.log('✅ Configurações carregadas:', configuracoes);
  console.log('✅ Músicos carregados:', musicos.length);
  console.log('✅ Pacotes carregados:', pacotes.length);
  console.log('✅ Serviços carregados:', servicosTerceirizados.length);

  if (configuracoes && configuracoes.valorPassagemDeSom) {
    valorPassagemDeSom = configuracoes.valorPassagemDeSom;
  }

  if (configuracoes && configuracoes.adicionalForaCidade) {
    const badgeAdicional = document.getElementById('adicional-valor');
    if (badgeAdicional) badgeAdicional.textContent = configuracoes.adicionalForaCidade.toFixed(0);
  }

  if (configuracoes && configuracoes.valorPassagemDeSom) {
    const badgePassagem = document.getElementById('passagem-valor');
    if (badgePassagem) badgePassagem.textContent = configuracoes.valorPassagemDeSom.toFixed(0);
  }

  if (servicosTerceirizados && servicosTerceirizados.length > 0) {
    servicosDisponiveis = servicosTerceirizados;
    renderizarServicosCompletos();
  }

  renderPacotes();
  renderMusicos();
}

function lerCacheFolhaCustos_() {
  try {
    const raw = localStorage.getItem(FOLHA_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function cacheFolhaValido_(cache) {
  return !!(
    cache &&
    cache.ts &&
    cache.configuracoes &&
    Array.isArray(cache.musicos) &&
    Array.isArray(cache.pacotes) &&
    Array.isArray(cache.servicosTerceirizados)
  );
}

function cacheExpirado_(cache) {
  if (!cache || !cache.ts) return true;
  return (Date.now() - Number(cache.ts)) > FOLHA_CACHE_TTL_MS;
}

function salvarCacheFolhaCustos_(
  configData,
  musicosData,
  pacotesData,
  servicosData,
  configHash,
  musicosHash,
  pacotesHash,
  servicosHash
) {
  try {
    localStorage.setItem(FOLHA_CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      configHash: String(configHash || ''),
      musicosHash: String(musicosHash || ''),
      pacotesHash: String(pacotesHash || ''),
      servicosHash: String(servicosHash || ''),
      configuracoes: configData || {},
      musicos: Array.isArray(musicosData) ? musicosData : [],
      pacotes: Array.isArray(pacotesData) ? pacotesData : [],
      servicosTerceirizados: Array.isArray(servicosData) ? servicosData : []
    }));
  } catch (e) {
    console.warn('Falha ao salvar cache da Folha:', e);
  }
}

function assinaturaConfig_(cfg) {
  try {
    return JSON.stringify(normalizarObjetoParaHash_(cfg || {}));
  } catch (_) {
    return '';
  }
}

function normalizarObjetoParaHash_(value) {
  if (Array.isArray(value)) {
    return value.map(normalizarObjetoParaHash_);
  }
  if (value && typeof value === 'object') {
    const sorted = {};
    Object.keys(value).sort().forEach((k) => {
      sorted[k] = normalizarObjetoParaHash_(value[k]);
    });
    return sorted;
  }
  return value;
}

// ═══════════════════════════════════════════════════════════
// FORMATAÇÃO DE DATA
// ═══════════════════════════════════════════════════════════

function formatarDataCompleta(dataString) {
  const data = new Date(dataString);
  
  const dias = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const diaSemana = dias[data.getDay()];
  
  const dia = String(data.getDate()).padStart(2, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const ano = data.getFullYear();
  
  return `${dia}/${mes}/${ano} (${diaSemana})`;
}

function formatarDataSimples(dataString) {
  const txt = String(dataString || '').trim();
  let data = null;

  // YYYY-MM-DD deve ser tratado como data local (sem deslocar por fuso)
  if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) {
    const p = txt.split('-');
    data = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  } else {
    data = new Date(txt);
  }
  if (isNaN(data.getTime())) return txt;
  
  const dia = String(data.getDate()).padStart(2, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const ano = data.getFullYear();
  
  return `${dia}/${mes}/${ano}`;
}

function limparDados() {
  configuracoes = null;
  musicos = [];
  pacotes = [];
  servicosTerceirizados = [];
  musicosSelecionados.clear();
  terceirizadosAtivos = [];
}

// ═══════════════════════════════════════════════════════════
// REQUISIÇÕES À API - USANDO POST PARA TUDO (CORS FIX)
// ═══════════════════════════════════════════════════════════

async function apiPost(action, data = {}) {
  try {
    console.log(`📡 API POST: ${action}`);

    // Compatibilidade com chamadas antigas do frontend legado.
    let externalAction = action;
    let payload = Object.assign({}, data || {});

    if (action === 'gerarPDF') {
      externalAction = 'gerarPDFRelatorio';
      const dataEvento = String((data && data.data && data.data.data) || '').trim();
      payload = {
        dataInicio: dataEvento,
        dataFim: dataEvento,
        tipo: 'detalhado'
      };
    } else if (action === 'gerarPDFPeriodo') {
      externalAction = 'gerarPDFRelatorio';
      payload = {
        dataInicio: String((data && data.data && data.data.dataInicio) || '').trim(),
        dataFim: String((data && data.data && data.data.dataFim) || '').trim(),
        tipo: 'detalhado'
      };
    }

    const resp = await Auth.apiCall(
      'folhaCustosProxy',
      Object.assign(
        {
          externalAction: externalAction,
          payloadJson: JSON.stringify(payload || {})
        },
        payload || {}
      )
    );

    if (!resp || resp.sucesso !== true) {
      throw new Error(resp?.mensagem || resp?.error || 'Falha na integração com Folha de Custos');
    }
    if (resp.debug && resp.debug.endpointUtilizado) {
      console.log('[FolhaCustosProxy] endpoint:', resp.debug.endpointUtilizado);
    }

    const result = resp.data || {};
    if (resp.debug && resp.debug.endpointUtilizado) {
      result.__debugEndpoint = resp.debug.endpointUtilizado;
    }
    if (result.error) {
      let mensagem = String(result.error || '');
      if (
        action === 'gerarPreviewPDF' &&
        mensagem.indexOf("Cannot read properties of undefined (reading 'toString')") !== -1
      ) {
        mensagem = 'RELATORIO_DADOS_INVALIDOS';
      }
      throw new Error(mensagem);
    }

    // Compatibilidade de resposta com fluxo legado (espera result.url).
    if (result.success && !result.url && result.downloadUrl) {
      result.url = result.downloadUrl;
    }

    return result;
  } catch (error) {
    console.error('❌ Erro na requisição:', error);
    throw error;
  }
}

function dataFolhaValida_(valor) {
  if (valor === null || typeof valor === 'undefined') return false;
  const txt = String(valor).trim();
  if (!txt || txt.toLowerCase() === 'undefined' || txt.toLowerCase() === 'null') return false;
  const dt = new Date(valor);
  if (!isNaN(dt.getTime())) return true;
  return /^\d{2}\/\d{2}\/\d{4}$/.test(txt) || /^\d{4}-\d{2}-\d{2}$/.test(txt);
}

async function diagnosticarFolhasInvalidas_() {
  try {
    const folhas = await apiPost('getFolhasCusto', {});
    const lista = Array.isArray(folhas) ? folhas : [];
    return lista
      .filter(f => !dataFolhaValida_(f && f.data))
      .slice(0, 10)
      .map(f => ({
        id: String((f && f.id) || '-'),
        nomeEvento: String((f && f.nomeEvento) || 'Sem nome'),
        data: String((f && f.data) || '')
      }));
  } catch (e) {
    console.warn('Falha no diagnóstico de folhas inválidas:', e);
    return [];
  }
}

function parseDataFolhaLocal_(valor) {
  if (valor === null || typeof valor === 'undefined') return null;
  const txt = String(valor).trim();
  if (!txt) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(txt)) {
    const p = txt.split('/');
    const d = new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(txt);
  return isNaN(d.getTime()) ? null : d;
}

async function carregarEventosAgendaFolha_(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const mostrarLoadingBusca = options.mostrarLoadingBusca === true;
  if (eventosAgendaFolhaCarregando) return;
  eventosAgendaFolhaCarregando = true;
  setAgendaRecomendadosLoading_(true, 'Carregando sugestões...');
  if (mostrarLoadingBusca) {
    setAgendaEventoBuscaLoading_(true, 'Carregando eventos da Agenda...');
  }
  try {
    const resp = await Auth.apiCall('listarEventosBootstrap', { incluirCancelados: false });
    const lista = Array.isArray(resp?.eventos) ? resp.eventos : [];
    eventosAgendaFolhaCache = lista
      .filter(ev => String(ev?.tipo || '').trim() === 'Evento')
      .sort((a, b) => {
        const aFolha = eventoAgendaTemFolhaAtiva_(a) ? 1 : 0;
        const bFolha = eventoAgendaTemFolhaAtiva_(b) ? 1 : 0;
        if (aFolha !== bFolha) return aFolha - bFolha; // sem folha primeiro
        return String(a?.data || '').localeCompare(String(b?.data || ''));
      });
    renderEventosAgendaRecomendados_();
  } catch (e) {
    console.warn('Falha ao carregar eventos da Agenda para vínculo da Folha:', e);
    eventosAgendaFolhaCache = [];
    renderEventosAgendaRecomendados_();
  } finally {
    eventosAgendaFolhaCarregando = false;
    if (mostrarLoadingBusca) {
      setAgendaEventoBuscaLoading_(false);
    }
  }
}

function eventoAgendaTemFolhaAtiva_(ev) {
  const valorDireto = Number(ev?.folhaCustoValor || 0);
  const valorCustos = Number(ev?.custos?.folha?.valor || ev?.folha?.valor || 0);
  return valorDireto > 0 || valorCustos > 0;
}

function statusFolhaLocalEvento_(ev) {
  if (!ev || typeof ev !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(ev, 'folhaCustoValor')) {
    return Number(ev.folhaCustoValor || 0) > 0;
  }
  if (ev?.custos?.folha && Object.prototype.hasOwnProperty.call(ev.custos.folha, 'valor')) {
    return Number(ev.custos.folha.valor || 0) > 0;
  }
  if (ev?.folha && Object.prototype.hasOwnProperty.call(ev.folha, 'valor')) {
    return Number(ev.folha.valor || 0) > 0;
  }
  return null;
}

async function eventoAgendaTemFolhaAtivaPorResumo_(idEvento) {
  const id = String(idEvento || '').trim();
  if (!id) return false;
  if (resumoFolhaEventoCache.has(id)) return resumoFolhaEventoCache.get(id) === true;
  try {
    const resumo = await Auth.apiCall('buscarResumoFinanceiroEvento', { idEvento: id });
    const temFolha = Number(resumo?.folhaCustoValor || 0) > 0;
    resumoFolhaEventoCache.set(id, temFolha);
    return temFolha;
  } catch (e) {
    console.warn('Falha ao verificar folha no resumo financeiro do evento:', id, e);
    // Em caso de falha, não assume "sem folha" para evitar falso positivo.
    resumoFolhaEventoCache.set(id, true);
    return true;
  }
}

function extrairMetaAgendaDaFolhaLocal_(folha) {
  if (!folha || typeof folha !== 'object') return { idEvento: '', status: '' };
  let meta = folha.Folhas_Custo || folha.folhas_custo || folha.folhasCusto || null;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch (_) { meta = null; }
  }
  const agenda = (meta && typeof meta === 'object' && meta.agenda && typeof meta.agenda === 'object')
    ? meta.agenda
    : {};
  return {
    idEvento: String(
      agenda.idEvento ||
      agenda.idEventoAgenda ||
      folha.idEvento ||
      folha.idEventoAgenda ||
      ''
    ).trim(),
    status: String(
      agenda.statusAprovacao ||
      folha.statusAprovacao ||
      ''
    ).trim().toUpperCase()
  };
}

async function carregarEventosComPropostaFolha_() {
  const force = arguments.length > 0 ? arguments[0] === true : false;
  const agora = Date.now();
  if (!force && (agora - eventosComPropostaFolhaCacheTs) < 60000 && eventosComPropostaFolhaCache.size >= 0) {
    return;
  }
  try {
    const lista = await apiPost('getFolhasCusto', {});
    const arr = Array.isArray(lista) ? lista : [];
    const pendentes = new Set();
    const mapaPendentes = new Map();
    arr.forEach((f) => {
      const meta = extrairMetaAgendaDaFolhaLocal_(f);
      if (!meta.idEvento) return;
      if (meta.status === 'PENDENTE_APROVACAO' || meta.status === 'PENDENTE' || meta.status === 'SOLICITADO') {
        pendentes.add(meta.idEvento);
        const atual = mapaPendentes.get(meta.idEvento);
        const tsNovo = new Date(String(f?.criadoEm || '')).getTime() || 0;
        const tsAtual = atual ? (new Date(String(atual?.criadoEm || '')).getTime() || 0) : 0;
        if (!atual || tsNovo >= tsAtual) {
          mapaPendentes.set(meta.idEvento, {
            id: String(f?.id || '').trim(),
            criadoEm: String(f?.criadoEm || '').trim(),
            nomeEvento: String(f?.nomeEvento || '').trim()
          });
        }
      }
    });
    eventosComPropostaFolhaCache = pendentes;
    propostasPendentesPorEvento = mapaPendentes;
    eventosComPropostaFolhaCacheTs = agora;
    reconciliarPendenciasComFinanceiro_().catch(() => {});
  } catch (e) {
    console.warn('Falha ao carregar propostas pendentes da Folha:', e);
  }
}

async function reconciliarPendenciasComFinanceiro_() {
  if (reconciliandoPendenciasCache) return;
  reconciliandoPendenciasCache = true;
  try {
    const ids = Array.from(eventosComPropostaFolhaCache || []).slice(0, 25);
    for (let i = 0; i < ids.length; i++) {
      const idEvento = String(ids[i] || '').trim();
      if (!idEvento) continue;
      const temFolhaAtiva = await eventoAgendaTemFolhaAtivaPorResumo_(idEvento);
      if (temFolhaAtiva) {
        eventosComPropostaFolhaCache.delete(idEvento);
        propostasPendentesPorEvento.delete(idEvento);
      }
    }
  } catch (e) {
    console.warn('Falha ao reconciliar pendências com financeiro:', e);
  } finally {
    reconciliandoPendenciasCache = false;
  }
}

function classificarStatusEventoAutocompleteRapido_(ev) {
  const idEvento = String(ev?.id || '').trim();
  if (!idEvento) return 'sem_folha';
  const statusLocal = statusFolhaLocalEvento_(ev);
  if (statusLocal === true) return 'folha_ativa';
  if (resumoFolhaEventoCache.has(idEvento)) {
    return resumoFolhaEventoCache.get(idEvento) === true ? 'folha_ativa' : 'sem_folha';
  }
  if (eventosComPropostaFolhaCache.has(idEvento)) return 'pendente';
  return 'sem_folha';
}

function atualizarBotaoAcaoFolha_() {
  const btn = document.getElementById('btn-enviar-aprovacao');
  if (!btn) return;
  if (propostaPendenteAtual && propostaPendenteAtual.id) {
    btn.textContent = '♻️ Atualizar Proposta Pendente';
    return;
  }
  if (eventoSelecionadoTemFolhaAtiva) {
    btn.textContent = '📝 Enviar Revisão para Aprovação';
    return;
  }
  btn.textContent = '✅ Registrar Folha e Enviar para Aprovação';
}

function parseArrayMaybeJson_(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function parseObjectMaybeJson_(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      return (p && typeof p === 'object' && !Array.isArray(p)) ? p : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

async function obterDetalheFolhaPorIdComFallback_(id, idEventoAtual) {
  const idFolha = String(id || '').trim();
  const idEvt = String(idEventoAtual || '').trim();
  let detalhe = null;

  if (idFolha) {
    try {
      const detalheResp = await apiPost('getFolhaCusto', { id: idFolha });
      detalhe = (detalheResp && typeof detalheResp === 'object')
        ? (detalheResp.folha || detalheResp.data || detalheResp)
        : null;
    } catch (_) {
      detalhe = null;
    }
  }

  if (!detalhe || !detalhe.id) {
    const listaResp = await apiPost('getFolhasCusto', {});
    const lista = Array.isArray(listaResp) ? listaResp : [];
    if (idFolha) detalhe = lista.find((f) => String(f?.id || '').trim() === idFolha) || null;

    if ((!detalhe || !detalhe.id) && idEvt) {
      const pendentesEvento = lista.filter((f) => {
        const meta = extrairMetaAgendaDaFolhaLocal_(f);
        const idEvento = String(meta.idEvento || '').trim();
        const status = String(meta.status || '').trim().toUpperCase();
        return idEvento === idEvt && (
          status === 'PENDENTE_APROVACAO' || status === 'PENDENTE' || status === 'SOLICITADO'
        );
      });
      pendentesEvento.sort((a, b) => {
        const ta = new Date(String(a?.criadoEm || '')).getTime() || 0;
        const tb = new Date(String(b?.criadoEm || '')).getTime() || 0;
        return tb - ta;
      });
      detalhe = pendentesEvento[0] || null;
    }
  }

  return (detalhe && detalhe.id) ? detalhe : null;
}

function preencherFormularioComFolha_(detalhe, modo) {
  if (!detalhe || !detalhe.id) return false;
  const metaFolha = parseObjectMaybeJson_(detalhe.Folhas_Custo || detalhe.folhas_custo || detalhe.folhasCusto);
  const idEventoDetalhe = String(
    detalhe.idEvento ||
    detalhe.idEventoAgenda ||
    metaFolha?.agenda?.idEvento ||
    metaFolha?.agenda?.idEventoAgenda ||
    ''
  ).trim();

  if (modo === 'pendente') {
    propostaPendenteAtual = {
      id: String(detalhe.id || '').trim(),
      idEvento: idEventoDetalhe
    };
  } else {
    propostaPendenteAtual = null;
  }

  const eventoForaCidade = document.getElementById('evento-fora-cidade');
  if (eventoForaCidade) {
    const fora = detalhe.foraCidade;
    const foraNorm = (fora === true) || String(fora || '').trim().toLowerCase() === 'sim' || String(fora || '').trim().toLowerCase() === 'true';
    eventoForaCidade.checked = foraNorm;
  }

  const mSelecionados = new Map();
  const listaMusicos = parseArrayMaybeJson_(detalhe.musicos);
  listaMusicos.forEach((m) => {
    const base = (musicos || []).find(mm => String(mm.id || '') === String(m.id || '')) || {
      id: String(m.id || ''),
      nome: String(m.nome || ''),
      funcao: String(m.funcao || ''),
      valorBase: Number(m.valorBase || 0)
    };
    mSelecionados.set(base.id, {
      musico: base,
      ajuste: {
        adicionalExtra: Number(m.adicionalExtra || 0),
        justificativa: String(m.justificativa || '')
      }
    });
  });
  musicosSelecionados = mSelecionados;

  const listaTerceirizados = parseArrayMaybeJson_(detalhe.terceirizados);
  terceirizadosAtivos = listaTerceirizados.map(t => ({
    nome: String(t.nome || ''),
    categoria: String(t.categoria || ''),
    valor: Number(t.valor || 0)
  }));

  const p = parseObjectMaybeJson_(detalhe.passagemDeSom) || parseObjectMaybeJson_(metaFolha?.passagemDeSom);
  passagemDeSomAtiva = !!(p && p.ativa);
  passagemDeSomPorMusico = {};
  if (passagemDeSomAtiva) {
    const idsSelecionados = Array.from(mSelecionados.keys()).map((id) => String(id || '').trim()).filter(Boolean);
    const participantes = Array.isArray(p?.participantes)
      ? p.participantes.map((id) => String(id || '').trim()).filter(Boolean)
      : [];

    if (participantes.length > 0) {
      // Nova regra (mais precisa): define explicitamente quem NÃO participa.
      const participantesSet = new Set(participantes);
      idsSelecionados.forEach((idMusico) => {
        passagemDeSomPorMusico[idMusico] = participantesSet.has(idMusico);
      });
    } else {
      // Compatibilidade com legado: derive pelos adicionais por músico quando não há participantes.
      const possuiMarcacaoLegado = listaMusicos.some((m) => Object.prototype.hasOwnProperty.call(m || {}, 'adicionalPassagem'));
      if (possuiMarcacaoLegado) {
        listaMusicos.forEach((m) => {
          const idMusico = String(m?.id || '').trim();
          if (!idMusico) return;
          passagemDeSomPorMusico[idMusico] = Number(m?.adicionalPassagem || 0) > 0;
        });
      }
    }
  }
  const passagemCheckbox = document.getElementById('passagem-de-som-checkbox');
  if (passagemCheckbox) passagemCheckbox.checked = passagemDeSomAtiva;
  const passagemBadge = document.getElementById('passagem-info');
  if (passagemBadge) passagemBadge.classList.toggle('hidden', !passagemDeSomAtiva);

  renderMusicos();
  renderTerceirizados();
  recalcular();
  atualizarBotaoAcaoFolha_();
  return true;
}

async function carregarPropostaPendenteParaEdicao_(idFolha) {
  const id = String(idFolha || '').trim();
  const idEventoAtual = String(document.getElementById('agenda-evento-id')?.value || '').trim();
  if (!id && !idEventoAtual) return false;
  try {
    const detalhe = await obterDetalheFolhaPorIdComFallback_(id, idEventoAtual);
    if (!detalhe) return false;
    return preencherFormularioComFolha_(detalhe, 'pendente');
  } catch (e) {
    console.warn('Falha ao carregar proposta pendente para edição:', e);
    return false;
  }
}

async function carregarUltimaFolhaAprovadaParaRevisao_(idEvento) {
  const idEvt = String(idEvento || '').trim();
  if (!idEvt) return false;
  try {
    const listaResp = await apiPost('getFolhasCusto', {});
    const lista = Array.isArray(listaResp) ? listaResp : [];
    const doEvento = lista.filter((f) => {
      const meta = extrairMetaAgendaDaFolhaLocal_(f);
      const idEventoFolha = String(meta.idEvento || '').trim();
      return idEventoFolha === idEvt;
    });
    if (!doEvento.length) return false;

    const ordenadas = doEvento.slice().sort((a, b) => {
      const metaA = extrairMetaAgendaDaFolhaLocal_(a);
      const metaB = extrairMetaAgendaDaFolhaLocal_(b);
      const statusA = String(metaA.status || '').trim().toUpperCase();
      const statusB = String(metaB.status || '').trim().toUpperCase();
      const syncA = (a?.agendaSincronizado === true) ||
        String(a?.agendaSincronizado || '').trim().toLowerCase() === 'true' ||
        (parseObjectMaybeJson_(a?.Folhas_Custo)?.agenda?.agendaSincronizado === true);
      const syncB = (b?.agendaSincronizado === true) ||
        String(b?.agendaSincronizado || '').trim().toLowerCase() === 'true' ||
        (parseObjectMaybeJson_(b?.Folhas_Custo)?.agenda?.agendaSincronizado === true);
      const prioridadeA = (statusA === 'APROVADO' || syncA) ? 1 : 0;
      const prioridadeB = (statusB === 'APROVADO' || syncB) ? 1 : 0;
      if (prioridadeA !== prioridadeB) return prioridadeB - prioridadeA;

      const tb = new Date(String(b?.aprovadoEm || b?.ultimaAtualizacao || b?.criadoEm || '')).getTime() || 0;
      const ta = new Date(String(a?.aprovadoEm || a?.ultimaAtualizacao || a?.criadoEm || '')).getTime() || 0;
      return tb - ta;
    });

    const base = ordenadas[0];
    const detalhe = await obterDetalheFolhaPorIdComFallback_(String(base.id || '').trim(), idEvt);
    if (!detalhe) return false;
    return preencherFormularioComFolha_(detalhe, 'revisao');
  } catch (e) {
    console.warn('Falha ao carregar última folha aprovada para revisão:', e);
    return false;
  }
}

function parseDataEventoAgenda_(valor) {
  const raw = String(valor || '').trim();
  if (!raw) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const p = raw.split('/');
    const d = new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function normalizarDataAgendaParaIso_(valor) {
  const raw = String(valor || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const p = raw.split('/');
    return `${p[2]}-${p[1]}-${p[0]}`;
  }
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function setAgendaEventoBuscaLoading_(ativo, texto) {
  const el = document.getElementById('agenda-evento-loading');
  if (!el) return;
  if (ativo) {
    el.textContent = texto || 'Carregando...';
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

async function buscarEventoAgendaFolha_(q) {
  const termo = String(q || '').trim().toLowerCase();
  const box = document.getElementById('agenda-evento-sugestoes');
  if (!box) return;

  if (!termo || termo.length < 2) {
    box.innerHTML = '';
    return;
  }

  if (!eventosAgendaFolhaCache.length) {
    setAgendaEventoBuscaLoading_(true, 'Buscando eventos...');
    await carregarEventosAgendaFolha_({ mostrarLoadingBusca: true });
    setAgendaEventoBuscaLoading_(false);
  }
  await carregarEventosComPropostaFolha_(false);

  const list = (eventosAgendaFolhaCache || [])
    .filter(ev => {
      const dt = parseDataEventoAgenda_(ev.dataIso || ev.data);
      if (!dt || dt.getFullYear() < 2026) return false;
      const hay = [
        String(ev.id || ''),
        String(ev.contratante || ''),
        String(ev.tipoEvento || ''),
        String(ev.data || '')
      ].join(' ').toLowerCase();
      return hay.includes(termo);
    })
    .slice(0, 12);

  if (!list.length) {
    box.innerHTML = '<div class="muted" style="padding:8px 10px">Nenhum evento encontrado.</div>';
    return;
  }

  const statusList = list.map(ev => classificarStatusEventoAutocompleteRapido_(ev));

  box.innerHTML = list.map((ev, idx) => {
    const status = statusList[idx];
    const ehPendente = status === 'pendente';
    const ehFolhaAtiva = status === 'folha_ativa';
    const badgeBg = ehPendente ? '#fff7ed' : (ehFolhaAtiva ? '#fef3c7' : '#dcfce7');
    const badgeColor = ehPendente ? '#9a3412' : (ehFolhaAtiva ? '#92400e' : '#166534');
    const badgeTxt = ehPendente ? 'Proposta pendente' : (ehFolhaAtiva ? 'Com folha ativa' : 'Sem folha');
    return `
    <div style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #eef2f7" onclick="selecionarEventoAgendaFolha_('${String(ev.id || '').replace(/'/g, "\\'")}')">
      <div>
        <strong>${String(ev.id || '')}</strong> • ${String(ev.contratante || 'Sem contratante')}
        <span style="margin-left:6px;font-size:11px;padding:2px 6px;border-radius:999px;background:${badgeBg};color:${badgeColor}">
          ${badgeTxt}
        </span>
      </div>
      <div class="muted" style="font-size:12px">${String(ev.tipoEvento || 'Evento')} • ${String(ev.data || '')}</div>
    </div>
  `;
  }).join('');
}

async function renderEventosAgendaRecomendados_() {
  const box = document.getElementById('agenda-evento-recomendados');
  if (!box) return;

  if (eventosAgendaFolhaCarregando && !(eventosAgendaFolhaCache || []).length) {
    box.innerHTML = '<span class="mini-loader"><span class="mini-loader-dot"></span>Carregando sugestões...</span>';
    return;
  }

  const hoje = new Date();
  hoje.setHours(23, 59, 59, 999);
  box.innerHTML = '<span class="mini-loader"><span class="mini-loader-dot"></span>Atualizando sugestões...</span>';
  await carregarEventosComPropostaFolha_();

  const candidatos = (eventosAgendaFolhaCache || [])
    .map(ev => ({ ev: ev, dataObj: parseDataEventoAgenda_(ev.dataIso || ev.data) }))
    .filter(item => item.dataObj && item.dataObj.getFullYear() >= 2026 && item.dataObj.getTime() <= hoje.getTime())
    .sort((a, b) => b.dataObj.getTime() - a.dataObj.getTime())
    .map(item => item.ev);

  const recomendados = [];
  for (let i = 0; i < candidatos.length && recomendados.length < 6 && i < 200; i++) {
    const ev = candidatos[i];
    const idEvento = String(ev?.id || '').trim();
    if (idEvento && eventosComPropostaFolhaCache.has(idEvento)) {
      continue;
    }
    const statusLocal = statusFolhaLocalEvento_(ev);
    const temFolha = statusLocal === null
      ? await eventoAgendaTemFolhaAtivaPorResumo_(ev.id)
      : statusLocal;
    if (!temFolha) recomendados.push(ev);
  }

  if (!recomendados.length) {
    box.innerHTML = '<span class="muted">Nenhum evento pendente sem folha no momento.</span>';
    return;
  }

  box.innerHTML = recomendados.map(ev => `
    <button type="button"
      style="margin:0 8px 8px 0;padding:8px 12px;border:1px solid #bfdbfe;border-radius:12px;background:linear-gradient(180deg,#eff6ff 0%,#dbeafe 100%);color:#1e3a8a;cursor:pointer;font-weight:600;box-shadow:0 1px 2px rgba(30,58,138,.12)"
      onclick="selecionarEventoAgendaFolha_('${String(ev.id || '').replace(/'/g, "\\'")}')">
      ${String(ev.id || '')} • ${String(ev.contratante || 'Sem contratante')} • ${String(ev.data || '')}
    </button>
  `).join('');
}

async function selecionarEventoAgendaFolha_(idEvento) {
  const id = String(idEvento || '').trim();
  const ev = (eventosAgendaFolhaCache || []).find(e => String(e.id || '').trim() === id);
  if (!ev) return;
  await carregarEventosComPropostaFolha_();

  const inpBusca = document.getElementById('agenda-evento-busca');
  const inpId = document.getElementById('agenda-evento-id');
  const box = document.getElementById('agenda-evento-sugestoes');
  const badge = document.getElementById('agenda-evento-vinculo-status');
  const badgeTxt = document.getElementById('agenda-evento-vinculo-texto');
  const eventoData = document.getElementById('evento-data');
  const eventoNome = document.getElementById('evento-nome');
  const idNormalizado = String(ev.id || '').trim();
  const pendente = idNormalizado ? propostasPendentesPorEvento.get(idNormalizado) : null;
  propostaPendenteAtual = null;
  eventoSelecionadoTemFolhaAtiva = false;

  const statusLocal = statusFolhaLocalEvento_(ev);
  eventoSelecionadoTemFolhaAtiva = statusLocal === true;
  if (statusLocal === null) {
    try {
      eventoSelecionadoTemFolhaAtiva = await eventoAgendaTemFolhaAtivaPorResumo_(idNormalizado);
    } catch (_) {}
  }

  if (eventoSelecionadoTemFolhaAtiva && !pendente) {
    const okRevisao = confirm('Este evento já possui folha ativa. Deseja carregar a última folha para revisão?');
    if (!okRevisao) {
      if (inpBusca) inpBusca.value = '';
      if (inpId) inpId.value = '';
      if (badge) badge.classList.add('hidden');
      atualizarBotaoAcaoFolha_();
      return;
    }
  }

  if (inpBusca) inpBusca.value = `${ev.id} — ${ev.contratante || ''}`;
  if (inpId) inpId.value = id;
  if (eventoData) eventoData.value = normalizarDataAgendaParaIso_(ev.dataIso || ev.data);
  if (eventoNome) {
    const nomePadrao = [String(ev.tipoEvento || '').trim(), String(ev.contratante || '').trim()].filter(Boolean).join(' ');
    eventoNome.value = nomePadrao || String(ev.nome || ev.id || '').trim();
  }
  if (box) box.innerHTML = '';
  if (badge && badgeTxt) {
    const sufixo = pendente ? ' • Proposta pendente carregável' : '';
    badgeTxt.textContent = `${ev.id} • ${ev.tipoEvento || 'Evento'} • ${ev.data || ''}${sufixo}`;
    badge.classList.remove('hidden');
  }
  atualizarBotaoAcaoFolha_();
  if (pendente && pendente.id) {
    showLoading('Carregando proposta pendente...');
    try {
      const carregou = await carregarPropostaPendenteParaEdicao_(pendente.id);
      if (!carregou) {
        alert('Não foi possível carregar a proposta pendente. Você pode recalcular e enviar uma atualização manualmente.');
      }
    } finally {
      hideLoading();
    }
  } else if (eventoSelecionadoTemFolhaAtiva) {
    showLoading('Carregando última folha aprovada...');
    try {
      const carregouRevisao = await carregarUltimaFolhaAprovadaParaRevisao_(idNormalizado);
      if (!carregouRevisao) {
        console.info('Sem registro anterior no utilitário para este evento. Revisão seguirá em branco.');
      }
    } finally {
      hideLoading();
    }
  }
  recalcular();
}

async function diagnosticarPeriodoSemEventos_(dataInicio, dataFim) {
  try {
    const folhas = await apiPost('getFolhasCusto', {});
    const lista = Array.isArray(folhas) ? folhas : [];
    const inicio = parseDataFolhaLocal_(dataInicio);
    const fim = parseDataFolhaLocal_(dataFim);
    if (!inicio || !fim) {
      return { totalFolhas: lista.length, noPeriodo: 0 };
    }
    inicio.setHours(0, 0, 0, 0);
    fim.setHours(23, 59, 59, 999);
    let noPeriodo = 0;
    lista.forEach((f) => {
      const d = parseDataFolhaLocal_(f && f.data);
      if (!d) return;
      if (d >= inicio && d <= fim) noPeriodo += 1;
    });
    return { totalFolhas: lista.length, noPeriodo: noPeriodo };
  } catch (_) {
    return { totalFolhas: 0, noPeriodo: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// RENDERIZAÇÃO DE MÚSICOS
// ═══════════════════════════════════════════════════════════

function renderMusicos() {
  const container = document.getElementById('musicos-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (!musicos || musicos.length === 0) {
    container.innerHTML = '<p class="info-text">Nenhum músico cadastrado</p>';
    return;
  }
  
  musicos.forEach(musico => {
    const card = createMusicoCard(musico);
    container.appendChild(card);
  });
}

function createMusicoCard(musico) {
  const div = document.createElement('div');
  div.className = 'musico-card';
  div.dataset.musicoId = musico.id;
  
  const selecionado = musicosSelecionados.has(musico.id);
  const dados = selecionado ? musicosSelecionados.get(musico.id) : null;
  
  if (selecionado) {
    div.classList.add('selected');
  }
  
  if (dados && dados.ajuste) {
    div.classList.add('has-adjustment');
  }
  
  const valorBase = musico.valorBase || 0;
  const adicionalAuto = calcularAdicionalAutomatico();
  const adicionalExtra = (dados && dados.ajuste) ? (dados.ajuste.adicionalExtra || 0) : 0;
  const passagem = musicoTemPassagem(musico.id) ? valorPassagemDeSom : 0;  // ← NOVO
  const total = valorBase + adicionalAuto + adicionalExtra + passagem;  // ← ATUALIZADO
  
  div.innerHTML = `
    <div class="musico-header">
      <div class="musico-info">
        <div class="musico-nome">${musico.nome}</div>
        <div class="musico-funcao">${musico.funcao}</div>
      </div>
      <input type="checkbox" 
             class="musico-checkbox" 
             ${selecionado ? 'checked' : ''}
             onchange="toggleMusico('${musico.id}')">
    </div>
    
    ${selecionado ? `
      <div class="musico-valores">
        <div class="valor-row">
          <span class="valor-label">Valor Base</span>
          <span class="valor-amount">R$ ${valorBase.toFixed(2)}</span>
        </div>
        ${adicionalAuto > 0 ? `
          <div class="valor-row">
            <span class="valor-label">Extra Fora da Cidade</span>
            <span class="valor-amount">R$ ${adicionalAuto.toFixed(2)}</span>
          </div>
        ` : ''}
        ${passagem > 0 ? `
          <div class="valor-row">
            <span class="valor-label">Passagem de Som</span>
            <span class="valor-amount">R$ ${passagem.toFixed(2)}</span>
          </div>
        ` : ''}
        ${adicionalExtra > 0 ? `
          <div class="valor-row">
            <span class="valor-label">Adicional Extra</span>
            <span class="valor-amount">R$ ${adicionalExtra.toFixed(2)}</span>
          </div>
        ` : ''}
        <div class="valor-row valor-total-row">
          <span class="valor-label">Total</span>
          <span class="valor-amount">R$ ${total.toFixed(2)}</span>
        </div>
      </div>
      
      <!-- ✅ PASSAGEM DE SOM: Inline no card -->
      ${passagemDeSomAtiva ? `
        <div class="passagem-som-checkbox">
          <label>
            <input 
              type="checkbox" 
              id="passagem-${musico.id}" 
              ${passagemDeSomPorMusico[musico.id] !== false ? 'checked' : ''}
              onchange="togglePassagemMusico('${musico.id}')"
            >
            <span class="passagem-som-label">🎵 Passagem de Som</span>
            <span class="passagem-som-valor">+R$ ${valorPassagemDeSom.toFixed(2)}</span>
          </label>
        </div>
      ` : ''}
      
      
      <div class="musico-actions">
        <button class="btn-adjust" onclick="abrirAjusteMusico('${musico.id}')">
          ⚙ Ajustar Valores
        </button>
      </div>
      
      ${dados && dados.ajuste && dados.ajuste.justificativa ? `
        <div class="adjustment-badge" title="${dados.ajuste.justificativa}">⚠️</div>
      ` : ''}
    ` : ''}
  `;
  
  return div;
}

// ═══════════════════════════════════════════════════════════
// GERENCIAMENTO DE MÚSICOS
// ═══════════════════════════════════════════════════════════

function toggleMusico(musicoId) {
  if (musicosSelecionados.has(musicoId)) {
    musicosSelecionados.delete(musicoId);
  } else {
    const musico = musicos.find(m => m.id === musicoId);
    if (musico) {
      musicosSelecionados.set(musicoId, {
        musico: musico,
        ajuste: null
      });
    }
  }
  
  renderMusicos();
  recalcular();
  
  // ✅ NOVO: Se passagem de som está ativa, adicionar checkbox no novo músico
  if (passagemDeSomAtiva && !musicosSelecionados.has(musicoId)) {
    // Pequeno delay para garantir que o card foi renderizado
    setTimeout(() => {
      adicionarCheckboxesPassagemNosCards();
    }, 100);
  }
}

function aplicarPacote(tipoPacote) {
  const pacote = pacotes.find(p => p.tipo === tipoPacote);
  
  if (!pacote) {
    alert(`Pacote "${tipoPacote}" não encontrado`);
    return;
  }
  
  musicosSelecionados.clear();
  
  pacote.musicos.forEach(musicoId => {
    const musico = musicos.find(m => m.id === musicoId);
    if (musico) {
      musicosSelecionados.set(musicoId, {
        musico: musico,
        ajuste: null
      });
    }
  });
  
  renderMusicos();
  recalcular();
}

function limparMusicos() {
  musicosSelecionados.clear();
  renderMusicos();
  recalcular();
}

// ═══════════════════════════════════════════════════════════
// MODAL DE AJUSTE DE MÚSICO
// ═══════════════════════════════════════════════════════════

function abrirAjusteMusico(musicoId) {
  const dados = musicosSelecionados.get(musicoId);
  if (!dados) return;
  
  musicoEmAjuste = musicoId;
  const musico = dados.musico;
  const ajuste = dados.ajuste || {};
  
  document.getElementById('modal-musico-nome').textContent = musico.nome;
  document.getElementById('modal-musico-funcao').textContent = musico.funcao;
  
  const valorBase = musico.valorBase || 0;
  const adicionalAuto = calcularAdicionalAutomatico();
  
  document.getElementById('modal-valor-base').textContent = `R$ ${valorBase.toFixed(2)}`;
  document.getElementById('modal-adicional-auto').textContent = adicionalAuto > 0 
    ? `R$ ${adicionalAuto.toFixed(2)}` 
    : '-';
  
  document.getElementById('modal-adicional-extra').value = ajuste.adicionalExtra || '';
  document.getElementById('modal-justificativa').value = ajuste.justificativa || '';
  
  atualizarTotalModal();
  
  abrirModal('modal-ajustar');
}

function atualizarTotalModal() {
  if (!musicoEmAjuste) return;
  
  const dados = musicosSelecionados.get(musicoEmAjuste);
  if (!dados) return;
  
  const valorBase = dados.musico.valorBase || 0;
  const adicionalAuto = calcularAdicionalAutomatico();
  const adicionalExtra = parseFloat(document.getElementById('modal-adicional-extra').value) || 0;
  
  const total = valorBase + adicionalAuto + adicionalExtra;
  
  document.getElementById('modal-total-final').textContent = `R$ ${total.toFixed(2)}`;
}

function salvarAjusteMusico() {
  if (!musicoEmAjuste) return;
  
  const adicionalExtra = parseFloat(document.getElementById('modal-adicional-extra').value) || 0;
  const justificativa = document.getElementById('modal-justificativa').value.trim();
  
  if (adicionalExtra > 0 && !justificativa) {
    alert('Por favor, informe a justificativa para o adicional extra');
    return;
  }
  
  const dados = musicosSelecionados.get(musicoEmAjuste);
  if (!dados) return;
  
  if (adicionalExtra > 0 || justificativa) {
    dados.ajuste = {
      adicionalExtra: adicionalExtra,
      justificativa: justificativa
    };
  } else {
    dados.ajuste = null;
  }
  
  musicosSelecionados.set(musicoEmAjuste, dados);
  
  fecharModal('modal-ajustar');
  musicoEmAjuste = null;
  renderMusicos();
  recalcular();
}

// ═══════════════════════════════════════════════════════════
// CUSTOS TERCEIRIZADOS
// ═══════════════════════════════════════════════════════════

function adicionarTerceirizado() {
  const id = Date.now().toString();
  terceirizadosAtivos.push({
    id: id,
    nome: '',
    categoria: '',
    valor: 0
  });
  renderTerceirizados();
}

function removerTerceirizado(id) {
  terceirizadosAtivos = terceirizadosAtivos.filter(t => t.id !== id);
  renderTerceirizados();
  recalcular();
}

function renderTerceirizados() {
  const container = document.getElementById('terceirizados-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  terceirizadosAtivos.forEach(item => {
    const div = document.createElement('div');
    div.className = 'terceirizado-item';
    div.innerHTML = `
      <div class="form-group">
        <label>Serviço</label>
        <input type="text" 
               value="${item.nome}" 
               oninput="atualizarTerceirizado('${item.id}', 'nome', this.value)"
               placeholder="Ex: Transporte">
      </div>
      
      <div class="form-group">
        <label>Categoria</label>
        <select onchange="atualizarTerceirizado('${item.id}', 'categoria', this.value)">
          <option value="">Selecione...</option>
          <option value="Som" ${item.categoria === 'Som' ? 'selected' : ''}>Som</option>
          <option value="Luz" ${item.categoria === 'Luz' ? 'selected' : ''}>Luz</option>
          <option value="Transporte" ${item.categoria === 'Transporte' ? 'selected' : ''}>Transporte</option>
          <option value="Alimentação" ${item.categoria === 'Alimentação' ? 'selected' : ''}>Alimentação</option>
          <option value="Hospedagem" ${item.categoria === 'Hospedagem' ? 'selected' : ''}>Hospedagem</option>
          <option value="Outros" ${item.categoria === 'Outros' ? 'selected' : ''}>Outros</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>Valor (R$)</label>
        <input type="number" 
               value="${item.valor}" 
               oninput="atualizarTerceirizado('${item.id}', 'valor', parseFloat(this.value) || 0)"
               placeholder="0.00"
               step="0.01"
               min="0">
      </div>
      
      <button class="btn-remove" onclick="removerTerceirizado('${item.id}')">✖</button>
    `;
    container.appendChild(div);
  });
}

function atualizarTerceirizado(id, campo, valor) {
  const item = terceirizadosAtivos.find(t => t.id === id);
  if (item) {
    item[campo] = valor;
    recalcular();
  }
}

// Continuação do app.js corrigido

// ═══════════════════════════════════════════════════════════
// CÁLCULOS
// ═══════════════════════════════════════════════════════════

function calcularAdicionalAutomatico() {
  const eventoForaCidade = document.getElementById('evento-fora-cidade');
  if (!eventoForaCidade || !eventoForaCidade.checked) {
    return 0;
  }
  
  return configuracoes ? (configuracoes.adicionalForaCidade || 0) : 0;
}

// ═══════════════════════════════════════════════════════════
// PASSAGEM DE SOM
// ═══════════════════════════════════════════════════════════

function adicionarCheckboxesPassagemNosCards() {
  // ✅ SIMPLIFICADO: Apenas re-renderizar os cards
  // Os checkboxes já aparecem inline no HTML do card
  if (musicosSelecionados.size > 0) {
    renderMusicos();
  }
}

function removerCheckboxesPassagemDosCards() {
  // ✅ SIMPLIFICADO: Apenas re-renderizar os cards
  renderMusicos();
}

function removerCheckboxesPassagemDosCards() {
  // ✅ SIMPLIFICADO: Apenas re-renderizar os cards
  renderMusicos();
}

function togglePassagemMusico(musicoId) {
  const checkbox = document.getElementById(`passagem-${musicoId}`);
  if (!checkbox) return;

  passagemDeSomPorMusico[musicoId] = checkbox.checked;

  // 🔄 força atualizar visual do card
  renderMusicos();
  recalcular();
}

function musicoTemPassagem(musicoId) {
  if (!passagemDeSomAtiva) return false;
  if (passagemDeSomPorMusico[musicoId] === false) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════
// SERVIÇOS GLOBALIZADOS
// ═══════════════════════════════════════════════════════════

function renderizarServicosCompletos() {
  // ✅ NOVO: Renderizar TODOS os serviços direto (sem categoria)
  const selectNome = document.getElementById('select-nome-servico');
  if (!selectNome) return;
  
  selectNome.innerHTML = '<option value="">Selecione o serviço...</option>';
  
  // Listar TODOS os serviços
  servicosDisponiveis.forEach(servico => {
    const option = document.createElement('option');
    option.value = servico.nome;
    option.textContent = `${servico.nome} (${servico.categoria})`;
    selectNome.appendChild(option);
  });
  
  // Adicionar opção "Novo"
  const optionNovo = document.createElement('option');
  optionNovo.value = '__NOVO__';
  optionNovo.textContent = '+ Adicionar Novo Serviço';
  selectNome.appendChild(optionNovo);
  
  selectNome.disabled = false;
  
  selectNome.onchange = function() {
    if (this.value === '__NOVO__') {
      const nomeNovo = prompt('Nome do novo serviço:');
      if (nomeNovo && nomeNovo.trim()) {
        const categoria = prompt('Categoria do serviço:', 'Outros');
        if (categoria) {
          salvarNovoServico(categoria, nomeNovo.trim());
        }
      } else {
        this.value = '';
      }
    }
  };
}
function onCategoriaSelecionada() {
  const selectCategoria = document.getElementById('select-categoria-servico');
  const selectNome = document.getElementById('select-nome-servico');
  
  if (!selectCategoria || !selectNome) return;
  
  const categoria = selectCategoria.value;
  
  if (!categoria) {
    selectNome.innerHTML = '<option value="">Selecione categoria primeiro...</option>';
    selectNome.disabled = true;
    return;
  }
  
  const servicosFiltrados = servicosDisponiveis.filter(s => s.categoria === categoria);
  
  selectNome.innerHTML = '<option value="">Selecione o serviço...</option>';
  
  servicosFiltrados.forEach(servico => {
    const option = document.createElement('option');
    option.value = servico.nome;
    option.textContent = servico.nome;
    selectNome.appendChild(option);
  });
  
  const optionNovo = document.createElement('option');
  optionNovo.value = '__NOVO__';
  optionNovo.textContent = '+ Adicionar Novo Serviço';
  selectNome.appendChild(optionNovo);
  
  selectNome.disabled = false;
  
  selectNome.onchange = function() {
    if (this.value === '__NOVO__') {
      const nomeNovo = prompt('Nome do novo serviço:');
      if (nomeNovo && nomeNovo.trim()) {
        salvarNovoServico(categoria, nomeNovo.trim());
      } else {
        this.value = '';
      }
    }
  };
}

async function salvarNovoServico(categoria, nome) {
  try {
    showLoading('Salvando novo serviço...');
    
    const resultado = await apiPost('salvarNovoServico', {
      categoria: categoria,
      nome: nome
    });
    
    hideLoading();
    
    if (resultado.success) {
      alert(`✅ Serviço "${nome}" adicionado com sucesso!`);
      servicosDisponiveis.push(resultado.servico);
      onCategoriaSelecionada();
    } else {
      throw new Error(resultado.message || 'Erro ao salvar');
    }
    
  } catch (error) {
    hideLoading();
    console.error('❌ Erro ao salvar serviço:', error);
    alert('Erro ao salvar serviço: ' + error.message);
  }
}

function adicionarServicoSelecionado() {
  const selectNome = document.getElementById('select-nome-servico');
  const inputValor = document.getElementById('input-valor-servico');
  
  const nome = selectNome.value;
  const valor = parseFloat(inputValor.value) || 0;
  
  if (!nome || nome === '__NOVO__') {
    alert('⚠️ Selecione o serviço');
    return;
  }
  
  if (valor <= 0) {
    alert('⚠️ Informe um valor válido');
    return;
  }
  
  // Buscar categoria do serviço selecionado
  const servico = servicosDisponiveis.find(s => s.nome === nome);
  const categoria = servico ? servico.categoria : 'Outros';
  
  const id = Date.now().toString();
  terceirizadosAtivos.push({
    id: id,
    nome: nome,
    categoria: categoria,
    valor: valor
  });
  
  selectNome.value = '';
  inputValor.value = '';
  
  renderTerceirizados();
  recalcular();
}

function recalcular() {
  const adicionalAuto = calcularAdicionalAutomatico();
  
  let totalMusicos = 0;
  let totalAdicionaisAuto = 0;
  let totalAdicionaisExtras = 0;
  let totalPassagem = 0;  // ← NOVO
  let countMusicos = 0;
  
  musicosSelecionados.forEach((dados, musicoId) => {
    const valorBase = dados.musico.valorBase || 0;
    const adicionalExtra = (dados.ajuste && dados.ajuste.adicionalExtra) || 0;
    const passagem = musicoTemPassagem(musicoId) ? valorPassagemDeSom : 0;  // ← NOVO
    
    totalMusicos += valorBase;
    totalAdicionaisAuto += adicionalAuto;
    totalAdicionaisExtras += adicionalExtra;
    totalPassagem += passagem;  // ← NOVO
    countMusicos++;
    
    // ✅ ATUALIZAR DISPLAY NO CARD
    const card = document.querySelector(`[data-musico-id="${musicoId}"]`);
    if (card && card.classList.contains('selected')) {
      const total = valorBase + adicionalAuto + adicionalExtra + passagem;
      const totalSpan = card.querySelector('.valor-total-row .valor-amount');
      if (totalSpan) {
        totalSpan.textContent = `R$ ${total.toFixed(2)}`;
      }
    }
  });
  
  const totalAdicionais = totalAdicionaisAuto + totalAdicionaisExtras + totalPassagem;  // ← ATUALIZADO
  
  const totalTerceirizados = terceirizadosAtivos.reduce((sum, item) => sum + (item.valor || 0), 0);
  
  const custoTotal = totalMusicos + totalAdicionais + totalTerceirizados;
  
  document.getElementById('total-musicos').textContent = `R$ ${totalMusicos.toFixed(2)}`;
  document.getElementById('detalhes-musicos').textContent = `${countMusicos} músico${countMusicos !== 1 ? 's' : ''}`;
  
  document.getElementById('total-adicionais').textContent = `R$ ${totalAdicionais.toFixed(2)}`;
  
  // ✅ DETALHAMENTO COMPLETO COM PASSAGEM
  let detalhamento = [];
  if (totalAdicionaisAuto > 0) {
    detalhamento.push(`R$ ${totalAdicionaisAuto.toFixed(2)} foraCidade`);
  }
  if (totalAdicionaisExtras > 0) {
    detalhamento.push(`R$ ${totalAdicionaisExtras.toFixed(2)} extras`);
  }
  if (totalPassagem > 0) {
    detalhamento.push(`R$ ${totalPassagem.toFixed(2)} passagemSom`);
  }
  
  document.getElementById('detalhes-adicionais').textContent = 
    detalhamento.length > 0 ? detalhamento.join(' + ') : '-';
  
  document.getElementById('total-terceirizados').textContent = `R$ ${totalTerceirizados.toFixed(2)}`;
  document.getElementById('detalhes-terceirizados').textContent = `${terceirizadosAtivos.length} item${terceirizadosAtivos.length !== 1 ? 's' : ''}`;
  
  document.getElementById('custo-total').textContent = `R$ ${custoTotal.toFixed(2)}`;
  
  if (custoTotal > 0) {
    gerarResumoTextual();
    document.getElementById('resumo-textual').classList.remove('hidden');
  } else {
    document.getElementById('resumo-textual').classList.add('hidden');
  }
}

function gerarResumoTextual() {
  const eventoForaCidade = document.getElementById('evento-fora-cidade').checked;
  const adicionalAuto = calcularAdicionalAutomatico();

  let resumo = '';

  // ===============================
  // CABEÇALHO
  // ===============================
  // CABEÇALHO DO EVENTO (não bloqueia o resumo)
let tituloEvento = 'FOLHA DE CUSTO';

try {
  const nome = document.querySelector('#evento-nome')?.value?.trim();
  const data = document.querySelector('#evento-data')?.value;

  if (nome && data) {
    tituloEvento = `${nome} - ${formatarDataSimples(data)} | FOLHA DE CUSTO`;
  } else if (nome) {
    tituloEvento = `${nome} | FOLHA DE CUSTO`;
  }
} catch (e) {
  // nunca bloqueia o resumo
}

resumo += tituloEvento + '\n\n';

  // ===============================
  // RESUMO FINANCEIRO
  // ===============================
  resumo += `💰 RESUMO FINANCEIRO\n\n`;

  // MÚSICOS (cachê base)
  const totalMusicosBase = Array.from(musicosSelecionados.values())
    .reduce((sum, dados) => sum + (dados.musico.valorBase || 0), 0);

  resumo += `MÚSICOS\n`;
  resumo += `• Cachês dos Músicos (${musicosSelecionados.size} cachês) – R$ ${totalMusicosBase.toFixed(2)}\n\n`;

 // ===============================
// ADICIONAL MÚSICOS
// ===============================

let linhasAdicionais = [];

// Evento fora da cidade
if (eventoForaCidade) {
  linhasAdicionais.push(
    `• Evento Fora da Cidade (${musicosSelecionados.size} × R$ ${adicionalAuto.toFixed(2)}) – R$ ${(musicosSelecionados.size * adicionalAuto).toFixed(2)}`
  );
}

// Passagem de som
let qtdPassagens = 0;
let totalPassagens = 0;

if (passagemDeSomAtiva) {
  qtdPassagens = Array.from(musicosSelecionados.keys())
    .filter(id => musicoTemPassagem(id)).length;

  if (qtdPassagens > 0) {
    totalPassagens = qtdPassagens * valorPassagemDeSom;
    linhasAdicionais.push(
      `• Passagem de Som (${qtdPassagens} × R$ ${valorPassagemDeSom.toFixed(2)}) – R$ ${totalPassagens.toFixed(2)}`
    );
  }
}

// Adicionais extras individuais
const extrasDetalhe = Array.from(musicosSelecionados.values())
  .filter(dados => dados.ajuste && dados.ajuste.adicionalExtra > 0);

if (extrasDetalhe.length > 0) {
  const totalExtrasIndividuais = extrasDetalhe.reduce(
    (sum, dados) => sum + dados.ajuste.adicionalExtra,
    0
  );

  linhasAdicionais.push(
    `• Ajustes Extras Individuais (${extrasDetalhe.length} músico${extrasDetalhe.length > 1 ? 's' : ''}) – R$ ${totalExtrasIndividuais.toFixed(2)}`
  );
}

// Renderização única, limpa e padronizada
if (linhasAdicionais.length > 0) {
  resumo += `ADICIONAL MÚSICOS\n`;
  resumo += linhasAdicionais.join('\n') + '\n\n';
}

  // ===============================
  // CUSTOS OPERACIONAIS
  // ===============================
  const totalTerceirizados = terceirizadosAtivos.reduce(
    (sum, item) => sum + (item.valor || 0),
    0
  );

  if (terceirizadosAtivos.length > 0) {
    resumo += `CUSTOS OPERACIONAIS\n`;
    terceirizadosAtivos.forEach(item => {
      resumo += `• ${item.nome} (${item.categoria}) – R$ ${item.valor.toFixed(2)}\n`;
    });
    resumo += `\n`;
  }

  // ===============================
  // TOTAIS
  // ===============================
  const totalExtras = Array.from(musicosSelecionados.values())
    .reduce((sum, dados) => sum + ((dados.ajuste && dados.ajuste.adicionalExtra) || 0), 0);

  const totalAdicionais = (eventoForaCidade ? adicionalAuto * musicosSelecionados.size : 0)
    + totalExtras
    + totalPassagens;

  const totalMusicosCompleto = totalMusicosBase + totalAdicionais;
  const custoTotal = totalMusicosCompleto + totalTerceirizados;

  resumo += `CUSTO TOTAL MÚSICOS: R$ ${totalMusicosCompleto.toFixed(2)}\n`;
  resumo += `CUSTO TOTAL OPERACIONAL: R$ ${totalTerceirizados.toFixed(2)}\n`;
  resumo += `CUSTO TOTAL DO EVENTO: R$ ${custoTotal.toFixed(2)}\n\n`;

  // ===============================
  // MÚSICOS (DETALHE)
  // ===============================
  resumo += `👥 MÚSICOS (${musicosSelecionados.size})\n\n`;

  musicosSelecionados.forEach((dados, musicoId) => {
    const musico = dados.musico;
    const valorBase = musico.valorBase || 0;
    const adicionalExtra = (dados.ajuste && dados.ajuste.adicionalExtra) || 0;
    const passagem = musicoTemPassagem(musicoId) ? valorPassagemDeSom : 0;
    const total = valorBase + (eventoForaCidade ? adicionalAuto : 0) + adicionalExtra + passagem;

    resumo += `• ${musico.nome} (${musico.funcao}) – R$ ${total.toFixed(2)}\n`;

    let detalhes = [];
    detalhes.push(`Cachê: R$ ${valorBase.toFixed(2)}`);
    if (eventoForaCidade) detalhes.push(`ForaCidade: R$ ${adicionalAuto.toFixed(2)}`);
    if (passagem > 0) detalhes.push(`PassagemSom: R$ ${passagem.toFixed(2)}`);
    if (adicionalExtra > 0) detalhes.push(`Extra: R$ ${adicionalExtra.toFixed(2)}`);

    resumo += `  ${detalhes.join(' | ')}\n\n`;
  });

  document.getElementById('resumo-texto').textContent = resumo;
}

// ═══════════════════════════════════════════════════════════
// SALVAR FOLHA DE CUSTO
// ═══════════════════════════════════════════════════════════

async function salvarFolhaCusto(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const enviarAprovacao = options.enviarAprovacao !== false;
  const eventoData = document.getElementById('evento-data').value;
  const eventoNome = document.getElementById('evento-nome').value.trim();
  const idEventoAgenda = String(document.getElementById('agenda-evento-id')?.value || '').trim();
  
  if (!idEventoAgenda) {
    alert('Selecione um evento da Agenda para continuar.');
    return;
  }
  
  if (!eventoData || !eventoNome) {
    alert('Dados do evento não carregados. Selecione novamente o evento da Agenda.');
    return;
  }

  await carregarEventosComPropostaFolha_();
  const pendenciaExistente = propostasPendentesPorEvento.get(idEventoAgenda);
  if (
    pendenciaExistente &&
    (!propostaPendenteAtual || String(propostaPendenteAtual.id || '').trim() !== String(pendenciaExistente.id || '').trim())
  ) {
    const desejaAtualizar = confirm('Este evento já possui uma proposta pendente. Deseja abrir essa proposta para atualização?');
    if (!desejaAtualizar) {
      return;
    }
    await selecionarEventoAgendaFolha_(idEventoAgenda);
    return;
  }
  
  if (musicosSelecionados.size === 0) {
    alert('Por favor, selecione pelo menos um músico');
    return;
  }

  const eventoForaCidade = document.getElementById('evento-fora-cidade').checked;
  const adicionalAuto = calcularAdicionalAutomatico();
  
  const musicosData = Array.from(musicosSelecionados.values()).map(dados => {
    const passagem = musicoTemPassagem(dados.musico.id) ? valorPassagemDeSom : 0;  // ← NOVO
    
    return {
      id: dados.musico.id,
      nome: dados.musico.nome,
      funcao: dados.musico.funcao,
      valorBase: dados.musico.valorBase,
      adicionalAutomatico: adicionalAuto,
      adicionalExtra: (dados.ajuste && dados.ajuste.adicionalExtra) || 0,
      adicionalPassagem: passagem,  // ← NOVO
      adicionalMotivo: passagem > 0 ? 'Passagem de Som' : '',  // ← NOVO
      justificativa: (dados.ajuste && dados.ajuste.justificativa) || '',
      total: (dados.musico.valorBase || 0) + adicionalAuto + ((dados.ajuste && dados.ajuste.adicionalExtra) || 0) + passagem  // ← ATUALIZADO
    };
  });
  
  const totalMusicos = musicosData.reduce((sum, m) => sum + (m.valorBase || 0), 0);
  const totalAdicionais = musicosData.reduce((sum, m) => 
    sum + (m.adicionalAutomatico || 0) + (m.adicionalExtra || 0) + (m.adicionalPassagem || 0), 0);
  const totalTerceirizados = terceirizadosAtivos.reduce((sum, item) => sum + (item.valor || 0), 0);
  const custoTotal = totalMusicos + totalAdicionais + totalTerceirizados;
  
  const folhaCusto = {
    id: String((propostaPendenteAtual && propostaPendenteAtual.id) || Date.now()),
    data: eventoData,
    nomeEvento: eventoNome,
    idEvento: idEventoAgenda || '',
    idEventoAgenda: idEventoAgenda || '',
    foraCidade: eventoForaCidade,
    musicos: musicosData,
    terceirizados: terceirizadosAtivos,
    totais: {
      musicos: totalMusicos,
      adicionais: totalAdicionais,
      terceirizados: totalTerceirizados,
      geral: custoTotal
    },

     passagemDeSom: passagemDeSomAtiva ? {  // ← NOVO
      ativa: true,
      valorPorPessoa: valorPassagemDeSom,
      participantes: musicosData.filter(m => m.adicionalPassagem > 0).map(m => m.id),
      totalGasto: musicosData.reduce((sum, m) => sum + (m.adicionalPassagem || 0), 0)
    } : null,

    resumo: document.getElementById('resumo-texto').textContent,
    resumoCompacto: String(document.getElementById('resumo-texto').textContent || '').replace(/\s+/g, ' ').trim().slice(0, 480),
    statusAprovacao: enviarAprovacao ? 'PENDENTE_APROVACAO' : 'RASCUNHO',
    agendaSincronizado: false,
    criadoPor: CURRENT_USER_EMAIL || localStorage.getItem('auth_email') || '',
    criadoEm: new Date().toISOString(),
    // Persistência redundante em campo já existente da planilha externa (Folhas_Custo)
    // para não depender de estrutura nova no utilitário externo.
    Folhas_Custo: {
      passagemDeSom: passagemDeSomAtiva ? {
        ativa: true,
        valorPorPessoa: valorPassagemDeSom,
        participantes: musicosData.filter(m => m.adicionalPassagem > 0).map(m => m.id),
        totalGasto: musicosData.reduce((sum, m) => sum + (m.adicionalPassagem || 0), 0)
      } : null,
      agenda: {
        idEvento: idEventoAgenda || '',
        statusAprovacao: enviarAprovacao ? 'PENDENTE_APROVACAO' : 'RASCUNHO',
        agendaSincronizado: false,
        enviadoPor: CURRENT_USER_EMAIL || localStorage.getItem('auth_email') || '',
        enviadoEm: new Date().toISOString()
      }
    }
  };
  
  try {
    showLoading(enviarAprovacao ? 'Registrando folha e enviando para aprovação...' : 'Salvando folha de custo...');
    
    const resultado = await apiPost('salvarFolhaCusto', { data: folhaCusto });
    
    hideLoading();
    
    if (resultado.success) {
      if (enviarAprovacao && idEventoAgenda) {
        eventosComPropostaFolhaCache.add(idEventoAgenda);
        eventosComPropostaFolhaCacheTs = Date.now();
        renderEventosAgendaRecomendados_().catch(() => {});
      }
      alert(enviarAprovacao
        ? (propostaPendenteAtual
            ? '✅ Proposta pendente atualizada e reenviada para aprovação!'
            : '✅ Folha registrada e enviada para aprovação na Agenda!')
        : '✅ Folha de custo salva com sucesso!');

      if (confirm('Deseja criar uma nova folha de custo?')) {
        limparFormulario();
      }
    } else {
      throw new Error(resultado.message || 'Erro ao salvar');
    }
    
  } catch (error) {
    hideLoading();
    console.error('❌ Erro ao salvar:', error);
    alert('Erro ao salvar folha de custo. Tente novamente.');
  }
}

function enviarFolhaParaAprovacaoAgenda() {
  return salvarFolhaCusto({ enviarAprovacao: true });
}

function limparFormulario() {
  document.getElementById('evento-data').value = '';
  document.getElementById('evento-nome').value = '';
  document.getElementById('evento-fora-cidade').checked = false;
  document.getElementById('adicional-info').classList.add('hidden');
  const agendaBusca = document.getElementById('agenda-evento-busca');
  const agendaId = document.getElementById('agenda-evento-id');
  const agendaSug = document.getElementById('agenda-evento-sugestoes');
  const agendaBadge = document.getElementById('agenda-evento-vinculo-status');
  if (agendaBusca) agendaBusca.value = '';
  if (agendaId) agendaId.value = '';
  if (agendaSug) agendaSug.innerHTML = '';
  if (agendaBadge) agendaBadge.classList.add('hidden');
  propostaPendenteAtual = null;
  eventoSelecionadoTemFolhaAtiva = false;
  atualizarBotaoAcaoFolha_();
  renderEventosAgendaRecomendados_();
  // Limpar passagem de som
  document.getElementById('passagem-de-som-checkbox').checked = false;
  document.getElementById('passagem-info').classList.add('hidden');
  passagemDeSomAtiva = false;
  removerCheckboxesPassagemDosCards();
  passagemDeSomPorMusico = {};
  musicosSelecionados.clear();
  terceirizadosAtivos = [];
  
  renderMusicos();
  renderTerceirizados();
  recalcular();
}

// ═══════════════════════════════════════════════════════════
// EXPORTAR PDF
// ═══════════════════════════════════════════════════════════

function abrirExportarPDF() {
  abrirModal('modal-pdf');
}

async function gerarPDF() {
  const tipoPdf = document.querySelector('input[name="tipo-pdf"]:checked').value;
  
  if (tipoPdf === 'evento') {
    await gerarPDFEvento();
  } else {
    await gerarPDFPeriodo();
  }
}

async function gerarPDFEvento() {
  if (musicosSelecionados.size === 0) {
    alert('Por favor, calcule uma folha de custo antes de exportar');
    return;
  }
  
  try {
    fecharModal('modal-pdf');
    showLoading('Gerando PDF...');
    
    const eventoData = document.getElementById('evento-data').value;
    const eventoNome = document.getElementById('evento-nome').value;
    
    const resultado = await apiPost('gerarPDF', {
      data: {
        data: eventoData,
        nome: eventoNome,
        resumo: document.getElementById('resumo-texto').textContent
      }
    });
    
    hideLoading();
    
    if (resultado.success && resultado.url) {
      window.open(resultado.url, '_blank');
    } else {
      throw new Error('URL do PDF não retornada');
    }
    
  } catch (error) {
    hideLoading();
    console.error('❌ Erro ao gerar PDF:', error);
    alert('Erro ao gerar PDF. Tente novamente.');
  }
}

async function gerarPDFPeriodo() {
  const dataInicio = document.getElementById('pdf-data-inicio').value;
  const dataFim = document.getElementById('pdf-data-fim').value;
  
  if (!dataInicio || !dataFim) {
    alert('Por favor, informe as datas de início e fim');
    return;
  }
  
  try {
    fecharModal('modal-pdf');
    showLoading('Gerando PDF do período...');
    
    const resultado = await apiPost('gerarPDFPeriodo', {
      data: {
        dataInicio: dataInicio,
        dataFim: dataFim
      }
    });
    
    hideLoading();
    
    if (resultado.success && resultado.url) {
      window.open(resultado.url, '_blank');
    } else {
      throw new Error('URL do PDF não retornada');
    }
    
  } catch (error) {
    hideLoading();
    console.error('❌ Erro ao gerar PDF:', error);
    alert('Erro ao gerar PDF. Tente novamente.');
  }
}

// ═══════════════════════════════════════════════════════════
// GERENCIAMENTO DE MODAIS
// ═══════════════════════════════════════════════════════════

function abrirModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function fecharModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}


document.addEventListener('click', function(e) {
  if (e.target.classList.contains('modal-overlay')) {
    const modal = e.target.closest('.modal');
    if (modal) {
      fecharModal(modal.id);
    }
  }
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const modals = document.querySelectorAll('.modal.active');
    modals.forEach(modal => {
      fecharModal(modal.id);
    });
  }
  
});

function renderPacotes() {
  const container = document.getElementById('pacotes-container');
  if (!container) {
    console.warn('⚠️ Container de pacotes não encontrado');
    return;
  }
  
  container.innerHTML = '';
  
  if (!pacotes || pacotes.length === 0) {
    console.warn('⚠️ Nenhum pacote disponível');
    return;
  }
  
  // Ícones padrão para pacotes (pode customizar na planilha depois)
  const icones = {
    'completa': '🎸',
    'reduzida': '🎹',
    'trio': '🎤',
    'duo': '🎵',
    'solo': '🎤'
  };
  
  // Renderizar cada pacote da planilha
  pacotes.forEach(pacote => {
    const btn = document.createElement('button');
    btn.className = 'btn-quick';
    btn.onclick = () => aplicarPacote(pacote.tipo);
    
    const icone = icones[pacote.tipo] || '🎵'; // Ícone padrão se não encontrar
    
    btn.innerHTML = `
      <span class="btn-icon">${icone}</span>
      ${pacote.nome}
    `;
    
    container.appendChild(btn);
  });
  
  // Adicionar botão "Limpar" no final
  const btnLimpar = document.createElement('button');
  btnLimpar.className = 'btn-quick btn-clear';
  btnLimpar.onclick = limparMusicos;
  btnLimpar.innerHTML = `
    <span class="btn-icon">✖</span>
    Limpar
  `;
  container.appendChild(btnLimpar);
  
  console.log(`✅ ${pacotes.length} pacotes renderizados`);
}

function abrirGerarRelatorio() {
  // Define data padrão como mês atual
  const hoje = new Date();
  const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  
  document.getElementById('relatorio-data-inicio').value = primeiroDia.toISOString().split('T')[0];
  document.getElementById('relatorio-data-fim').value = ultimoDia.toISOString().split('T')[0];
  
  abrirModal('modal-gerar-relatorio');
}

/**
 * Gera relatório (chama API)
 */
async function gerarRelatorio() {
  const dataInicio = document.getElementById('relatorio-data-inicio').value;
  const dataFim = document.getElementById('relatorio-data-fim').value;
  
  // CORREÇÃO: Pegar tipo de relatório selecionado
  const tipoRadios = document.getElementsByName('tipo-relatorio');
  let tipo = 'detalhado'; // padrão
  
  for (const radio of tipoRadios) {
    if (radio.checked) {
      tipo = radio.value;
      break;
    }
  }
  
  if (!dataInicio || !dataFim) {
    alert('Por favor, informe as datas de início e fim');
    return;
  }
  
  try {
    fecharModal('modal-gerar-relatorio');
    showLoading('Gerando relatório...');
    
    // CORREÇÃO: Enviar tipo junto com as datas
    const resultado = await apiPost('gerarPreviewPDF', {
      dataInicio: dataInicio,
      dataFim: dataFim,
      tipo: tipo  // ← NOVO PARÂMETRO!
    });
    
    hideLoading();
    
    if (resultado.success && resultado.resumo) {
      // Armazenar dados do relatório
      relatorioAtual = {
        dataInicio: dataInicio,
        dataFim: dataFim,
        tipo: tipo,  // ← ARMAZENAR TIPO
        resumo: resultado.resumo,
        totalEventos: resultado.totalEventos,
        endpoint: resultado.__debugEndpoint || ''
      };
      
      // Mostrar relatório
      exibirRelatorio();
    } else {
      throw new Error(resultado.message || 'Erro ao gerar relatório');
    }
    
  } catch (error) {
    hideLoading();
    console.error('❌ Erro ao gerar relatório:', error);
    const msg = String(error && error.message ? error.message : error);
    if (msg.toLowerCase().indexOf('nenhum evento encontrado no período') !== -1) {
      const diag = await diagnosticarPeriodoSemEventos_(dataInicio, dataFim);
      const extra = diag.noPeriodo > 0
        ? `\n\nDiagnóstico: existem ${diag.noPeriodo} folha(s) no período localmente. Isso indica divergência de endpoint/configuração do app externo.`
        : `\n\nDiagnóstico: não há folhas no período selecionado (total geral: ${diag.totalFolhas}).`;
      alert('Erro ao gerar relatório: ' + msg + extra);
      return;
    }
    if (msg === 'RELATORIO_DADOS_INVALIDOS') {
      const invalidas = await diagnosticarFolhasInvalidas_();
      if (invalidas.length) {
        const linhas = invalidas
          .map(x => `• ${x.id} | ${x.nomeEvento} | data: ${x.data || 'vazia'}`)
          .join('\n');
        alert(
          'Não foi possível gerar o relatório porque existem folhas com DATA inválida no sistema externo.\n\n' +
          'Corrija a coluna de data dessas folhas e tente novamente:\n\n' + linhas
        );
        return;
      }
      alert('Não foi possível gerar o relatório: há dados de folha com data inválida no sistema externo.');
      return;
    }
    alert('Erro ao gerar relatório: ' + msg);
  }
}

/**
 * Exibe relatório no modal
 */
function exibirRelatorio() {
  if (!relatorioAtual) return;
  
  const modal = document.getElementById('modal-exibir-relatorio');
  const titulo = document.getElementById('relatorio-titulo');
  const conteudo = document.getElementById('relatorio-conteudo');
  
  // Atualizar título
  titulo.textContent = `Relatório - ${relatorioAtual.dataInicio} a ${relatorioAtual.dataFim}`;
  
  // Atualizar conteúdo
  conteudo.textContent = relatorioAtual.resumo;
  
  // Abrir modal
  abrirModal('modal-exibir-relatorio');
}

/**
 * Copia relatório para área de transferência
 */
async function copiarRelatorio() {
  if (!relatorioAtual || !relatorioAtual.resumo) {
    alert('Nenhum relatório disponível para copiar');
    return;
  }
  
  try {
    await navigator.clipboard.writeText(relatorioAtual.resumo);
    
    // Feedback visual
    const btn = event.target;
    const textoOriginal = btn.textContent;
    btn.textContent = '✅ Copiado!';
    btn.disabled = true;
    
    setTimeout(() => {
      btn.textContent = textoOriginal;
      btn.disabled = false;
    }, 2000);
    
    
    console.log('✅ Relatório copiado para área de transferência');
    
  } catch (error) {
    console.error('❌ Erro ao copiar:', error);
    // Fallback: selecionar texto
    const textarea = document.createElement('textarea');
    textarea.value = relatorioAtual.resumo;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    
    try {
      document.execCommand('copy');
      alert('Relatório copiado!');
    } catch (err) {
      alert('Erro ao copiar. Por favor, selecione e copie manualmente (Ctrl+A, Ctrl+C)');
    }
    
    document.body.removeChild(textarea);
  }
}

/**
 * Baixa relatório em PDF
 */

async function baixarRelatorioPDF() {
  if (!relatorioAtual) {
    alert('Nenhum relatório gerado');
    return;
  }
  
  try {
    showLoading('Gerando PDF para download...');
    
    // CORREÇÃO: Usar apiPost (POST) ao invés de fetch
    const resultado = await apiPost('gerarPDFRelatorio', {
      dataInicio: relatorioAtual.dataInicio,
      dataFim: relatorioAtual.dataFim,
      tipo: relatorioAtual.tipo
    });
    
    hideLoading();
    
    if (resultado.success && resultado.downloadUrl) {
  window.open(resultado.downloadUrl, '_blank');
  
  // ✅ Feedback diferente se veio do cache
  if (resultado.fromCache) {
    alert('✅ PDF encontrado!\n\nArquivo: ' + resultado.fileName + '\n\n💡 Usando PDF existente (não duplicou)');
  } else {
    alert('✅ PDF gerado!\n\nArquivo: ' + resultado.fileName + '\n\nO download deve iniciar automaticamente.');
  }
} else {
      throw new Error(resultado.message || 'Erro ao gerar PDF');
    }
    
  } catch (error) {
    hideLoading();
    console.error('❌ Erro ao baixar PDF:', error);
    alert('Erro ao gerar PDF: ' + error.message);
  }
}

/**
 * Abre relatório no Google Drive
 */

async function abrirRelatorioDrive() {
  if (!relatorioAtual) {
    alert('Nenhum relatório gerado');
    return;
  }
  
  try {
    showLoading('Gerando PDF e abrindo no Drive...');
    
    // CORREÇÃO: Usar apiPost (POST) ao invés de fetch
    const resultado = await apiPost('abrirPDFDrive', {
      dataInicio: relatorioAtual.dataInicio,
      dataFim: relatorioAtual.dataFim,
      tipo: relatorioAtual.tipo
    });
    
    hideLoading();
    
    if (resultado.success && resultado.driveUrl) {
      // Abrir Drive em nova aba
      window.open(resultado.driveUrl, '_blank');
      
      // Feedback
      alert('✅ PDF gerado e aberto no Drive!\n\nArquivo: ' + resultado.fileName);
    } else {
      throw new Error(resultado.message || 'Erro ao abrir no Drive');
    }
    
  } catch (error) {
    hideLoading();
    console.error('❌ Erro ao abrir no Drive:', error);
    alert('Erro ao abrir no Drive: ' + error.message);
  }
}
