/**
 * ========================================
 * SISTEMA DE GESTÃO DE EVENTOS MUSICAIS
 * ========================================
 * 
 * Autor: Claude (Anthropic)
 * Data: 28/12/2024
 * Versão: 1.0
 * 
 * Descrição:
 * Sistema completo de gestão financeira e operacional
 * para empresa de eventos musicais com controle de:
 * - Agenda de eventos
 * - Recebimentos e pagamentos
 * - Comissões de vendedores
 * - Dashboard executivo
 * - Relatórios gerenciais
 */

// ========================================
// FUNÇÃO PRINCIPAL - EXECUTAR ESTA PRIMEIRO
// ========================================


/**
 * Cria toda a estrutura do sistema
 * EXECUTAR APENAS 1 VEZ na planilha nova
 */
function criarEstruturaCompleta() {
  try {
    Logger.log('🚀 Iniciando criação da estrutura...');
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Remove a aba padrão "Planilha1" se existir
    const sheetPadrao = ss.getSheetByName('Planilha1');
    if (sheetPadrao) {
      ss.deleteSheet(sheetPadrao);
    }
    
    // Cria todas as abas
    criarAbaEventos(ss);
    criarAbaContratantes(ss);
    criarAbaCerimonialistas(ss);
    criarAbaEnderecos(ss);
    criarAbaVendedores(ss);
    criarAbaParceirosBV(ss);
    criarAbaUsuarios(ss);
    criarAbaMovimentacoesFinanceiras(ss);
    criarAbaFechamentosComissao(ss);
    criarAbaLogs(ss);
    criarAbaConfig(ss);
    
    // Insere dados iniciais
    inserirDadosIniciais(ss);
    
    // Formata todas as abas
    formatarTodasAbas(ss);
    
    Logger.log('✅ Estrutura criada com sucesso!');
    SpreadsheetApp.getUi().alert('✅ Sistema criado com sucesso!\n\nAgora você pode começar a usar.');
    
  } catch (error) {
    Logger.log('❌ Erro: ' + error.message);
    SpreadsheetApp.getUi().alert('❌ Erro ao criar estrutura: ' + error.message);
  }
}

// ========================================
// CRIAÇÃO DAS ABAS
// ========================================

/**
 * ABA 1: EVENTOS
 */
function criarAbaEventos(ss) {
  Logger.log('Criando aba EVENTOS...');
  
  const sheet = ss.insertSheet('EVENTOS');
  
  // Cabeçalhos
  const headers = [
    'ID_EVENTO',
    'TIPO_REGISTRO',
    'DATA_EVENTO',
    'HORA_INICIO',
    'DURACAO',
    'TIPO_EVENTO',
    'PROJETO',
    'ID_CONTRATANTE',
    'NOME_CONTRATANTE',
    'ID_CERIMONIALISTA',
    'NOME_CERIMONIALISTA',
    'ID_ENDERECO',
    'LOCAL',
    'VALOR_TOTAL',
    'TEM_NF',
    'VALOR_NF',
    'ID_BV',
    'VALOR_BV',
    'ID_VENDEDOR',
    'NOME_VENDEDOR',
    'COMISSAO_TIPO',
    'COMISSAO_VALOR',
    'STATUS_PAGAMENTO',
    'LOOK',
    'SOM_RESPONSAVEL',
    'OBSERVACOES',
    'DATA_CRIACAO',
    'CRIADO_POR',
    'ULTIMA_EDICAO',
    'EDITADO_POR'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  // Formatar cabeçalho
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1a1a1a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  
  // Congelar primeira linha
  sheet.setFrozenRows(1);
  
  // Ajustar larguras
  sheet.setColumnWidth(1, 120);  // ID
  sheet.setColumnWidth(2, 120);  // TIPO_REGISTRO
  sheet.setColumnWidth(3, 100);  // DATA_EVENTO
  sheet.setColumnWidth(26, 150); // OBSERVACOES
}

/**
 * ABA 2: CONTRATANTES
 */
function criarAbaContratantes(ss) {
  Logger.log('Criando aba CONTRATANTES...');
  
  const sheet = ss.insertSheet('CONTRATANTES');
  
  const headers = [
    'ID_CONTRATANTE',
    'NOME',
    'WHATSAPP',
    'EMAIL',
    'OBSERVACOES',
    'DATA_CADASTRO'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1a1a1a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 200);
}

/**
 * ABA 3: CERIMONIALISTAS
 */
function criarAbaCerimonialistas(ss) {
  Logger.log('Criando aba CERIMONIALISTAS...');
  
  const sheet = ss.insertSheet('CERIMONIALISTAS');
  
  const headers = [
    'ID_CERIMONIALISTA',
    'NOME',
    'WHATSAPP',
    'OBSERVACOES',
    'DATA_CADASTRO'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1a1a1a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 200);
}

/**
 * ABA 4: ENDERECOS
 */
function criarAbaEnderecos(ss) {
  Logger.log('Criando aba ENDERECOS...');
  
  const sheet = ss.insertSheet('ENDERECOS');
  
  const headers = [
    'ID_ENDERECO',
    'NOME_LOCAL',
    'ENDERECO_COMPLETO',
    'LINK_MAPS',
    'OBSERVACOES',
    'DATA_CADASTRO'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1a1a1a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 250);
}

/**
 * ABA 5: VENDEDORES
 */
function criarAbaVendedores(ss) {
  Logger.log('Criando aba VENDEDORES...');
  
  const sheet = ss.insertSheet('VENDEDORES');
  
  const headers = [
    'ID_VENDEDOR',
    'NOME',
    'COMISSAO_PADRAO',
    'STATUS',
    'OBSERVACOES',
    'DATA_CADASTRO'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1a1a1a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 140);
}

/**
 * ABA 6: PARCEIROS_BV
 */
function criarAbaParceirosBV(ss) {
  Logger.log('Criando aba PARCEIROS_BV...');
  
  const sheet = ss.insertSheet('PARCEIROS_BV');
  
  const headers = [
    'ID_PARCEIRO',
    'NOME',
    'WHATSAPP',
    'STATUS',
    'DATA_CADASTRO'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1a1a1a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 200);
}

/**
 * ABA 7: USUARIOS
 */
function criarAbaUsuarios(ss) {
  Logger.log('Criando aba USUARIOS...');
  
  const sheet = ss.insertSheet('USUARIOS');
  
  const headers = [
    'ID_USUARIO',
    'EMAIL',
    'NOME',
    'PERFIL',
    'STATUS',
    'DATA_CADASTRO'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1a1a1a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 250);
  sheet.setColumnWidth(3, 200);
}

/**
 * ABA 8: MOVIMENTACOES_FINANCEIRAS (LEDGER CENTRAL)
 */
function criarAbaMovimentacoesFinanceiras(ss) {
  Logger.log('Criando aba MOVIMENTACOES_FINANCEIRAS...');
  
  const sheet = ss.insertSheet('MOVIMENTACOES_FINANCEIRAS');
  
  const headers = [
    'ID_MOVIMENTACAO',
    'TIPO_MOVIMENTACAO',
    'NATUREZA',
    'ID_EVENTO',
    'NOME_EVENTO',
    'DATA_MOVIMENTACAO',
    'VALOR',
    'FORMA_PAGAMENTO',
    'CONTRAPARTE',
    'ID_CONTRAPARTE',
    'LINK_COMPROVANTE',
    'OBSERVACOES',
    'PROCESSADO_POR',
    'TIMESTAMP',
    'INCLUIDO_EM_FECHAMENTO',
    'STATUS'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#0d47a1')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 150); // ID
  sheet.setColumnWidth(2, 180); // TIPO
  sheet.setColumnWidth(5, 200); // NOME_EVENTO
}

/**
 * ABA 9: FECHAMENTOS_COMISSAO
 */
function criarAbaFechamentosComissao(ss) {
  Logger.log('Criando aba FECHAMENTOS_COMISSAO...');
  
  const sheet = ss.insertSheet('FECHAMENTOS_COMISSAO');
  
  const headers = [
    'ID_FECHAMENTO',
    'ID_VENDEDOR',
    'NOME_VENDEDOR',
    'DATA_INICIO',
    'DATA_FIM',
    'TOTAL_BRUTO_RECEBIDO',
    'TOTAL_COMISSAO',
    'AJUSTE_CREDITO',
    'AJUSTE_DEBITO',
    'DESCRICAO_AJUSTE',
    'VALOR_FINAL',
    'STATUS',
    'DATA_GERACAO',
    'GERADO_POR'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#1b5e20')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(3, 200);
}

/**
 * ABA 10: LOGS
 */
function criarAbaLogs(ss) {
  Logger.log('Criando aba LOGS...');
  
  const sheet = ss.insertSheet('LOGS');
  
  const headers = [
    'ID_LOG',
    'DATA_HORA',
    'USUARIO',
    'ACAO',
    'TABELA',
    'ID_REGISTRO',
    'DETALHES'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#424242')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(7, 300);
}

/**
 * ABA 11: CONFIG
 */
function criarAbaConfig(ss) {
  Logger.log('Criando aba CONFIG...');
  
  const sheet = ss.insertSheet('CONFIG');
  
  const headers = [
    'CHAVE',
    'VALOR',
    'DESCRICAO'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#4a148c')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 250);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 400);
}

// ========================================
// INSERÇÃO DE DADOS INICIAIS
// ========================================

function inserirDadosIniciais(ss) {
  Logger.log('Inserindo dados iniciais...');
  
  // VENDEDORES
  const sheetVendedores = ss.getSheetByName('VENDEDORES');
  const vendedores = [
    [1, 'Fernando Amorim', 0.10, 'Ativo', 'Proprietário', new Date()],
    [2, 'Suetônio', 0.10, 'Ativo', 'Sócio - Vendedor principal', new Date()]
  ];
  sheetVendedores.getRange(2, 1, vendedores.length, vendedores[0].length).setValues(vendedores);
  
  // USUARIOS
  const sheetUsuarios = ss.getSheetByName('USUARIOS');
  const usuarios = [
    [1, 'fernando@exemplo.com', 'Fernando Amorim', 'Proprietário', 'Ativo', new Date()],
    [2, 'suetonio@exemplo.com', 'Suetônio', 'Sócio', 'Ativo', new Date()],
    [3, 'musico1@exemplo.com', 'Músico 1', 'Músico', 'Ativo', new Date()],
    [4, 'musico2@exemplo.com', 'Músico 2', 'Músico', 'Ativo', new Date()],
    [5, 'musico3@exemplo.com', 'Músico 3', 'Músico', 'Ativo', new Date()],
    [6, 'musico4@exemplo.com', 'Músico 4', 'Músico', 'Ativo', new Date()],
    [7, 'musico5@exemplo.com', 'Músico 5', 'Músico', 'Ativo', new Date()],
    [8, 'musico6@exemplo.com', 'Músico 6', 'Músico', 'Ativo', new Date()],
    [9, 'musico7@exemplo.com', 'Músico 7', 'Músico', 'Ativo', new Date()],
    [10, 'musico8@exemplo.com', 'Músico 8', 'Músico', 'Ativo', new Date()],
    [11, 'musico9@exemplo.com', 'Músico 9', 'Músico', 'Ativo', new Date()]
  ];
  sheetUsuarios.getRange(2, 1, usuarios.length, usuarios[0].length).setValues(usuarios);
  
  // CONFIG
  const sheetConfig = ss.getSheetByName('CONFIG');
  const configs = [
    ['COMISSAO_PADRAO_PERCENTUAL', '10', 'Percentual padrão de comissão (%)'],
    ['NF_PERCENTUAL', '6.2', 'Percentual de imposto da nota fiscal (%)'],
    ['DURACAO_PADRAO_EVENTO', '2h', 'Duração padrão dos eventos'],
    ['PREFIXO_ID_EVENTO', 'AG', 'Prefixo para ID de eventos'],
    ['PREFIXO_ID_MOVIMENTACAO', 'MOV', 'Prefixo para ID de movimentações'],
    ['PREFIXO_ID_FECHAMENTO', 'AC-VND', 'Prefixo para ID de fechamentos'],
    ['EMAIL_NOTIFICACOES', 'fernando@exemplo.com', 'Email para notificações do sistema'],
    ['NOME_EMPRESA', 'Banda XYZ', 'Nome da banda/empresa']
  ];
  sheetConfig.getRange(2, 1, configs.length, configs[0].length).setValues(configs);
  
  Logger.log('✅ Dados iniciais inseridos');
}

// ========================================
// FORMATAÇÃO
// ========================================

function formatarTodasAbas(ss) {
  Logger.log('Formatando abas...');
  
  const sheets = ss.getSheets();
  
  sheets.forEach(sheet => {
    // Formata como tabela zebrada
    const lastRow = sheet.getMaxRows();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns())
        .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
    }
    
    // Auto-resize todas as colunas
    sheet.autoResizeColumns(1, sheet.getMaxColumns());
  });
  
  Logger.log('✅ Formatação concluída');
}