/**
 * ========================================
 * SISTEMA DE DIAGNÓSTICO COMPLETO
 * Execute: diagnosticarSistema()
 * ========================================
 */

function diagnosticarSistema() {
  const resultados = [];
  
  resultados.push('='.repeat(60));
  resultados.push('🔍 DIAGNÓSTICO COMPLETO DO SISTEMA');
  resultados.push('='.repeat(60));
  resultados.push('');
  
  // TESTE 1: Arquivos HTML
  resultados.push('📁 TESTE 1: Verificando arquivos HTML...');
  const arquivosHTML = [
    'index',
    'CadastroEvento', 
    'RegistrarRecebimento',
    'FecharComissao',
    'GerarAgenda',
    'AgendaVisual',
    'Teste'
  ];
  
  arquivosHTML.forEach(arquivo => {
    try {
      HtmlService.createHtmlOutputFromFile(arquivo);
      resultados.push(`  ✅ ${arquivo}.html - EXISTE e CARREGA`);
    } catch(e) {
      resultados.push(`  ❌ ${arquivo}.html - ERRO: ${e.message}`);
    }
  });
  
  resultados.push('');
  
  // TESTE 2: Função doGet
  resultados.push('🔧 TESTE 2: Testando função doGet...');
  try {
    const testPages = ['home', 'teste', 'novo-evento'];
    testPages.forEach(page => {
      try {
        const result = doGet({parameter: {page: page}});
        resultados.push(`  ✅ doGet(page=${page}) - OK`);
      } catch(e) {
        resultados.push(`  ❌ doGet(page=${page}) - ERRO: ${e.message}`);
      }
    });
  } catch(e) {
    resultados.push(`  ❌ Erro geral no doGet: ${e.message}`);
  }
  
  resultados.push('');
  
  // TESTE 3: Planilha e abas
  resultados.push('📊 TESTE 3: Verificando planilha...');
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    resultados.push(`  ✅ Planilha: ${ss.getName()}`);
    resultados.push(`  ✅ ID: ${ss.getId()}`);
    
    const abas = ss.getSheets();
    resultados.push(`  ✅ Total de abas: ${abas.length}`);
    
    const abasEsperadas = ['EVENTOS', 'USUARIOS', 'VENDEDORES'];
    abasEsperadas.forEach(nome => {
      const aba = ss.getSheetByName(nome);
      if (aba) {
        resultados.push(`  ✅ Aba ${nome} - EXISTE`);
      } else {
        resultados.push(`  ⚠️ Aba ${nome} - NÃO ENCONTRADA`);
      }
    });
  } catch(e) {
    resultados.push(`  ❌ Erro ao acessar planilha: ${e.message}`);
  }
  
  resultados.push('');
  
  // TESTE 4: Usuário
  resultados.push('👤 TESTE 4: Verificando usuário...');
  try {
    const email = Session.getActiveUser().getEmail();
    resultados.push(`  ✅ Email: ${email}`);
    
    const usuario = obterUsuarioAtual();
    resultados.push(`  ✅ Usuário válido: ${usuario.valido}`);
    if (usuario.valido) {
      resultados.push(`  ✅ Nome: ${usuario.nome}`);
      resultados.push(`  ✅ Perfil: ${usuario.perfil}`);
      if (usuario.modoDev) {
        resultados.push(`  ⚠️ MODO DESENVOLVIMENTO ATIVO`);
      }
    }
  } catch(e) {
    resultados.push(`  ❌ Erro: ${e.message}`);
  }
  
  resultados.push('');
  
  // TESTE 5: Implantação
  resultados.push('🚀 TESTE 5: Informações de implantação...');
  try {
    const url = ScriptApp.getService().getUrl();
    resultados.push(`  ✅ URL do Web App: ${url}`);
  } catch(e) {
    resultados.push(`  ⚠️ Não foi possível obter URL: ${e.message}`);
  }
  
  resultados.push('');
  resultados.push('='.repeat(60));
  resultados.push('FIM DO DIAGNÓSTICO');
  resultados.push('='.repeat(60));
  
  // Exibe no log
  const relatorio = resultados.join('\n');
  Logger.log(relatorio);
  
  // Retorna também
  return relatorio;
}

/**
 * Teste de criar HTML simples
 */
function testarCriarHTML() {
  Logger.log('🧪 Testando criação de HTML...');
  
  try {
    // Teste 1: HTML inline
    const html1 = HtmlService.createHtmlOutput('<h1>Teste 1 OK</h1>');
    Logger.log('✅ HTML inline: OK');
    
    // Teste 2: HTML de arquivo
    const html2 = HtmlService.createHtmlOutputFromFile('index');
    Logger.log('✅ HTML de arquivo (index): OK');
    
    // Teste 3: HTML com título
    const html3 = HtmlService.createHtmlOutput('<h1>Teste 3</h1>')
      .setTitle('Teste')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    Logger.log('✅ HTML com configurações: OK');
    
    Logger.log('✅ TODOS OS TESTES DE HTML PASSARAM!');
    return true;
    
  } catch(e) {
    Logger.log('❌ ERRO: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    return false;
  }
}

/**
 * Listar TODOS os arquivos do projeto
 */
function listarArquivosProjeto() {
  Logger.log('📁 Listando arquivos do projeto...');
  Logger.log('='.repeat(60));
  
  try {
    const arquivos = [];
    
    // Lista arquivos .gs
    Logger.log('📄 Arquivos .gs:');
    const scriptFiles = DriveApp.getFileById(ScriptApp.getScriptId())
      .getParents()
      .next()
      .getFilesByType(MimeType.GOOGLE_APPS_SCRIPT);
    
    // Não conseguimos listar diretamente, então vamos tentar carregar
    const nomesParaTestar = [
      'index',
      'CadastroEvento',
      'RegistrarRecebimento', 
      'FecharComissao',
      'GerarAgenda',
      'AgendaVisual',
      'Teste'
    ];
    
    Logger.log('🔍 Testando arquivos HTML conhecidos:');
    nomesParaTestar.forEach(nome => {
      try {
        HtmlService.createHtmlOutputFromFile(nome);
        Logger.log(`  ✅ ${nome}.html`);
      } catch(e) {
        Logger.log(`  ❌ ${nome}.html - ${e.message}`);
      }
    });
    
  } catch(e) {
    Logger.log('❌ Erro: ' + e.message);
  }
  
  Logger.log('='.repeat(60));
}