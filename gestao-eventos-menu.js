/**
 * ========================================
 * MENU PRINCIPAL E INTERFACES
 * ========================================
 */

/**
 * Cria menu personalizado na planilha
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  
  ui.createMenu('🎵 Gestão de Eventos')
    .addItem('📊 Dashboard', 'abrirDashboard')
    .addSeparator()
    .addItem('➕ Novo Evento', 'abrirCadastroEvento')
    .addItem('✏️ Editar Evento', 'abrirEditarEvento')
    .addItem('📅 Agenda Visual', 'abrirAgendaVisual')
    .addItem('📝 Gerar Agenda Semanal', 'abrirGerarAgenda')
    .addSeparator()
    .addItem('💰 Central Financeira', 'abrirCentralFinanceira')
    .addItem('💰 Painel Financeiro', 'abrirPainelFinanceiro')
    .addItem('🤝 Fechar Comissão', 'abrirFecharComissao')
    .addSeparator()
    
    // SUBMENU: Cadastros
    .addSubMenu(ui.createMenu('⚙️ Cadastros')
      .addItem('👤 Contratantes', 'abrirCadastroContratantes')
      .addItem('🎭 Cerimonialistas', 'abrirCadastroCerimonialistas')
      .addItem('📍 Endereços', 'abrirCadastroEnderecos')
      .addItem('🤝 Parceiros BV', 'abrirCadastroParceirosBV'))
    
    // SUBMENU: Ferramentas (NOVAS FUNCIONALIDADES) ⭐
    .addSubMenu(ui.createMenu('🔧 Ferramentas')
      .addItem('🔄 Auto-fill Endereços', 'menuAutoFill')
      .addItem('✅ Validar Cálculos', 'menuValidarCalculos')
      .addSeparator()
      .addItem('🧪 Executar Testes', 'menuExecutarTestes')
      .addItem('📋 Diagnóstico Sistema', 'menuDiagnostico')
      .addSeparator()
      .addItem('🔌 Verificar Triggers', 'menuListarTriggers')
      .addItem('📚 Documentação v2.0', 'menuDocumentacao'))
    
    .addSeparator()
    .addItem('📈 Relatórios', 'abrirRelatorios')
    .addItem('⚙️ Configurações', 'abrirConfiguracoes')
    .addToUi();
}

/**
 * Abre interface de cadastro de evento
 */
function abrirCadastroEvento() {
  const html = HtmlService.createHtmlOutputFromFile('CadastroEvento')
    .setWidth(800)
    .setHeight(600)
    .setTitle('Novo Evento');
  SpreadsheetApp.getUi().showModalDialog(html, 'Novo Evento');
}

/**
 * Abre interface de edição de eventos
 */
function abrirEditarEvento() {
  const html = HtmlService.createHtmlOutputFromFile('EditarEvento-V2')
    .setWidth(950)
    .setHeight(850)
    .setTitle('✏️ Editar Evento');
  SpreadsheetApp.getUi().showModalDialog(html, 'Editar Evento');
}

/**
 * Abre interface de Agenda Visual
 */
function abrirAgendaVisual() {
  const html = HtmlService.createHtmlOutputFromFile('AgendaVisual')
    .setWidth(800)
    .setHeight(600)
    .setTitle('Novo Evento');
  SpreadsheetApp.getUi().showModalDialog(html, 'Agenda FA');
}

/**
 * FUNÇÃO DE TESTE - Execute esta função manualmente para testar!
 * (Não execute onOpen manualmente - ela roda sozinha ao abrir a planilha)
 */
function TESTAR_EditarEvento() {
  abrirEditarEvento();
}


/**
 * Abre interface de registro de recebimento
 */
function abrirCentralFinanceira() {
  const html = HtmlService.createHtmlOutputFromFile('CentralFinanceira')
    .setWidth(600)
    .setHeight(500)
    .setTitle('Central Financeira');
  SpreadsheetApp.getUi().showModalDialog(html, 'Central Financeira');
}

/**
 * Abre interface de fechamento de comissão
 */
function abrirFecharComissao() {
  const html = HtmlService.createHtmlOutputFromFile('FecharComissao')
    .setWidth(900)
    .setHeight(700)
    .setTitle('Fechar Comissão');
  SpreadsheetApp.getUi().showModalDialog(html, 'Fechar Comissão de Vendedor');
}



function abrirPainelFinanceiro() {
  const html = HtmlService.createHtmlOutputFromFile('PainelFinanceiro')
    .setWidth(650)
    .setHeight(700);
  SpreadsheetApp.getUi().showModalDialog(html, 'Painel Financeiro');
}

/**
 * Abre interface de geração de agenda semanal
 */
function abrirGerarAgenda() {
  const html = HtmlService.createHtmlOutputFromFile('GerarAgenda')
    .setWidth(700)
    .setHeight(600)
    .setTitle('Gerar Agenda Semanal');
  SpreadsheetApp.getUi().showModalDialog(html, 'Gerar Agenda Semanal para WhatsApp');
}

/**
 * Abre dashboard executivo
 */
function abrirDashboard() {
  const html = HtmlService.createHtmlOutputFromFile('Dashboard')
    .setWidth(1200)
    .setHeight(800)
    .setTitle('Dashboard Executivo');
  SpreadsheetApp.getUi().showModelessDialog(html, 'Dashboard Executivo');
}

// Placeholders para outras telas

function abrirCadastroContratantes() {
  SpreadsheetApp.getUi().alert('🚧 Em desenvolvimento');
}

function abrirCadastroCerimonialistas() {
  SpreadsheetApp.getUi().alert('🚧 Em desenvolvimento');
}

function abrirCadastroEnderecos() {
  SpreadsheetApp.getUi().alert('🚧 Em desenvolvimento');
}

function abrirCadastroParceirosBV() {
  SpreadsheetApp.getUi().alert('🚧 Em desenvolvimento');
}

function abrirRelatorios() {
  SpreadsheetApp.getUi().alert('🚧 Em desenvolvimento');
}

function abrirConfiguracoes() {
  SpreadsheetApp.getUi().alert('🚧 Em desenvolvimento');
}

/**
 * ========================================
 * FUNÇÕES DO SUBMENU FERRAMENTAS (NOVAS)
 * ========================================
 */

/**
 * MENU: Auto-fill
 */
function menuAutoFill() {
  autoFillEnderecoFromLocal();
  SpreadsheetApp.getUi().alert('✅ Auto-fill executado!\n\nCampos vazios foram preenchidos.');
}

/**
 * MENU: Validar Cálculos
 */
function menuValidarCalculos() {
  teste4_ValidarCalculos();
}

/**
 * MENU: Executar Testes
 */
function menuExecutarTestes() {
  executarTodosOsTestes();
}

/**
 * MENU: Diagnóstico
 */
function menuDiagnostico() {
  diagnosticoPosMigracao();
}

/**
 * MENU: Listar Triggers
 */
function menuListarTriggers() {
  listarTriggers();
}

/**
 * MENU: Documentação
 */
function menuDocumentacao() {
  const ui = SpreadsheetApp.getUi();
  ui.alert(
    '📚 DOCUMENTAÇÃO v2.0',
    'SISTEMA DE 39 COLUNAS:\n\n' +
    '✅ 1-13: Identificação\n' +
    '✅ 14-17: Valores (Total, Recebido, Pendente, Status)\n' +
    '✅ 18-24: Comissão (3 níveis de prioridade)\n' +
    '✅ 25-28: BV\n' +
    '✅ 29-31: Nota Fiscal (auto)\n' +
    '✅ 32-35: Info Adicionais\n' +
    '✅ 36-39: Auditoria\n\n' +
    'FEATURES NOVAS:\n' +
    '• Sistema de comissão com prioridade\n' +
    '• Auto-fill não destrutivo\n' +
    '• Validação automática (trigger)\n' +
    '• CIDADE/ESTADO\n' +
    '• Timestamps inteligentes\n\n' +
    'Use: 🔧 Ferramentas > Executar Testes',
    ui.ButtonSet.OK
  );
}