/**
 * ════════════════════════════════════════════════════════════════
 * DIAGNÓSTICO COMPLETO - SISTEMA 43 COLUNAS
 * ════════════════════════════════════════════════════════════════
 * 
 * Execute: diagnosticoCompleto()
 * Vai mostrar EXATAMENTE o que está errado
 */

function diagnosticoCompleto() {
  Logger.log('═'.repeat(80));
  Logger.log('🔍 DIAGNÓSTICO COMPLETO - SISTEMA FA PRODUÇÕES');
  Logger.log('═'.repeat(80));
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('EVENTOS');
  
  if (!sheet) {
    Logger.log('❌ ERRO CRÍTICO: Aba EVENTOS não encontrada!');
    return;
  }
  
  // 1. VERIFICA ESTRUTURA
  Logger.log('\n📊 PASSO 1: VERIFICANDO ESTRUTURA DA ABA');
  Logger.log('─'.repeat(80));
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log(`Total de colunas: ${headers.length}`);
  
  if (headers.length !== 43) {
    Logger.log(`⚠️ PROBLEMA: Esperado 43 colunas, encontrado ${headers.length}`);
  } else {
    Logger.log('✅ Estrutura correta: 43 colunas');
  }
  
  // 2. MOSTRA CABEÇALHOS
  Logger.log('\n📋 PASSO 2: CABEÇALHOS DAS COLUNAS');
  Logger.log('─'.repeat(80));
  
  headers.forEach((header, index) => {
    Logger.log(`Col ${index + 1} (índice ${index}): ${header}`);
  });
  
  // 3. VERIFICA CONSTANTES COL
  Logger.log('\n🔧 PASSO 3: VERIFICANDO CONSTANTES COL');
  Logger.log('─'.repeat(80));
  
  try {
    Logger.log(`COL.ID_EVENTO = ${COL.ID_EVENTO} (esperado: 0)`);
    Logger.log(`COL.TIPO_REGISTRO = ${COL.TIPO_REGISTRO} (esperado: 1)`);
    Logger.log(`COL.DATA_EVENTO = ${COL.DATA_EVENTO} (esperado: 2)`);
    Logger.log(`COL.DATA_FIM = ${COL.DATA_FIM} (esperado: 3)`);
    Logger.log(`COL.HORA_INICIO = ${COL.HORA_INICIO} (esperado: 4)`);
    Logger.log(`COL.NOME_CONTRATANTE = ${COL.NOME_CONTRATANTE} (esperado: 9)`);
    Logger.log(`COL.LOCAL = ${COL.LOCAL} (esperado: 13)`);
    Logger.log(`COL.TIPO_EVENTO = ${COL.TIPO_EVENTO} (esperado: 6)`);
    Logger.log('✅ Constantes COL estão definidas');
  } catch (e) {
    Logger.log(`❌ ERRO: Constantes COL não encontradas! ${e.message}`);
    Logger.log('   SOLUÇÃO: Adicione o arquivo colunas-constantes.js');
  }
  
  // 4. TESTA LEITURA DE DADOS
  Logger.log('\n📖 PASSO 4: TESTANDO LEITURA DE EVENTOS');
  Logger.log('─'.repeat(80));
  
  const data = sheet.getDataRange().getValues();
  
  Logger.log(`Total de linhas: ${data.length}`);
  Logger.log(`Eventos encontrados: ${data.length - 1}\n`);
  
  // Mostra primeiros 3 eventos
  for (let i = 1; i <= Math.min(3, data.length - 1); i++) {
    Logger.log(`─── EVENTO ${i} ───`);
    Logger.log(`Linha ${i + 1} da planilha (índice ${i} do array)`);
    Logger.log('');
    
    // Mostra TODOS os valores da linha
    Logger.log('📊 DADOS BRUTOS (primeiro 15 colunas):');
    for (let col = 0; col < 15; col++) {
      Logger.log(`  [${col}] = "${data[i][col]}" (${typeof data[i][col]})`);
    }
    
    Logger.log('');
    Logger.log('🎯 DADOS INTERPRETADOS (usando índices fixos):');
    Logger.log(`  [0] ID_EVENTO = "${data[i][0]}"`);
    Logger.log(`  [1] TIPO_REGISTRO = "${data[i][1]}"`);
    Logger.log(`  [2] DATA_EVENTO = "${data[i][2]}"`);
    Logger.log(`  [3] ??? = "${data[i][3]}" ← DEVERIA SER DATA_FIM`);
    Logger.log(`  [4] ??? = "${data[i][4]}" ← DEVERIA SER HORA_INICIO`);
    Logger.log(`  [5] ??? = "${data[i][5]}" ← DEVERIA SER DURACAO`);
    Logger.log(`  [6] ??? = "${data[i][6]}" ← DEVERIA SER TIPO_EVENTO`);
    Logger.log(`  [7] ??? = "${data[i][7]}" ← DEVERIA SER PROJETO`);
    Logger.log(`  [8] ??? = "${data[i][8]}" ← DEVERIA SER ID_CONTRATANTE`);
    Logger.log(`  [9] ??? = "${data[i][9]}" ← DEVERIA SER NOME_CONTRATANTE`);
    Logger.log(`  [10] ??? = "${data[i][10]}" ← DEVERIA SER ID_CERIMONIALISTA`);
    Logger.log(`  [11] ??? = "${data[i][11]}" ← DEVERIA SER NOME_CERIMONIALISTA`);
    Logger.log(`  [12] ??? = "${data[i][12]}" ← DEVERIA SER ID_ENDERECO`);
    Logger.log(`  [13] ??? = "${data[i][13]}" ← DEVERIA SER LOCAL`);
    Logger.log(`  [14] ??? = "${data[i][14]}" ← DEVERIA SER VALOR_TOTAL`);
    
    Logger.log('');
    Logger.log('🔍 VERIFICAÇÃO:');
    
    // Tenta encontrar onde está o nome do contratante
    Logger.log('  Procurando NOME do contratante (texto longo):');
    for (let col = 0; col < 15; col++) {
      const valor = data[i][col];
      if (typeof valor === 'string' && valor.length > 3 && 
          !valor.includes('-') && !valor.includes(':') &&
          valor !== 'Evento' && valor !== 'Reunião' && valor !== 'Bloqueio') {
        Logger.log(`    → Possível nome encontrado na coluna ${col}: "${valor}"`);
      }
    }
    
    Logger.log('');
  }
  
  // 5. TESTA FUNÇÃO gerarAgendaSemanal
  Logger.log('\n🧪 PASSO 5: TESTANDO FUNÇÃO gerarAgendaSemanal()');
  Logger.log('─'.repeat(80));
  
  try {
    const hoje = new Date();
    const proximaSemana = new Date(hoje);
    proximaSemana.setDate(hoje.getDate() + 7);
    
    const resultado = gerarAgendaSemanal(hoje, proximaSemana);
    
    Logger.log('Resultado da função:');
    Logger.log(resultado.texto);
    Logger.log('');
    Logger.log(`Total de eventos na agenda: ${resultado.quantidadeEventos}`);
  } catch (e) {
    Logger.log(`❌ ERRO ao executar gerarAgendaSemanal: ${e.message}`);
    Logger.log(`Stack: ${e.stack}`);
  }
  
  Logger.log('\n═'.repeat(80));
  Logger.log('✅ DIAGNÓSTICO COMPLETO FINALIZADO');
  Logger.log('═'.repeat(80));
  Logger.log('\nVeja os logs acima para identificar o problema!');
}

/**
 * Teste simplificado - mostra apenas o primeiro evento
 */
function testeRapido() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('EVENTOS');
  const data = sheet.getDataRange().getValues();
  
  Logger.log('═'.repeat(60));
  Logger.log('TESTE RÁPIDO - PRIMEIRO EVENTO');
  Logger.log('═'.repeat(60));
  
  Logger.log(`\nTotal de colunas: ${data[0].length}`);
  Logger.log(`\nCABEÇALHOS (primeiros 15):`);
  for (let i = 0; i < 15; i++) {
    Logger.log(`  Col ${i + 1}: ${data[0][i]}`);
  }
  
  Logger.log(`\nPRIMEIRO EVENTO (linha 2):`);
  for (let i = 0; i < 15; i++) {
    Logger.log(`  [${i}] = "${data[1][i]}"`);
  }
  
  Logger.log('\n' + '═'.repeat(60));
}

/**
 * Verifica se o arquivo colunas-constantes.js foi carregado
 */
function verificarConstantes() {
  Logger.log('═'.repeat(60));
  Logger.log('VERIFICANDO CONSTANTES COL');
  Logger.log('═'.repeat(60));
  
  try {
    Logger.log('\nTentando acessar COL...');
    Logger.log(`typeof COL = ${typeof COL}`);
    
    if (typeof COL !== 'undefined') {
      Logger.log('\n✅ COL está definido!');
      Logger.log('\nValores importantes:');
      Logger.log(`  COL.ID_EVENTO = ${COL.ID_EVENTO}`);
      Logger.log(`  COL.TIPO_REGISTRO = ${COL.TIPO_REGISTRO}`);
      Logger.log(`  COL.DATA_FIM = ${COL.DATA_FIM}`);
      Logger.log(`  COL.HORA_INICIO = ${COL.HORA_INICIO}`);
      Logger.log(`  COL.NOME_CONTRATANTE = ${COL.NOME_CONTRATANTE}`);
      Logger.log(`  COL.LOCAL = ${COL.LOCAL}`);
      Logger.log(`  COL.TIPO_EVENTO = ${COL.TIPO_EVENTO}`);
    } else {
      Logger.log('\n❌ COL não está definido!');
      Logger.log('\nSOLUÇÃO:');
      Logger.log('1. Verifique se o arquivo "colunas-constantes.js" existe');
      Logger.log('2. Nome do arquivo deve ser exatamente: colunas-constantes.js');
      Logger.log('3. Deve estar no mesmo projeto do Apps Script');
    }
  } catch (e) {
    Logger.log(`\n❌ ERRO: ${e.message}`);
    Logger.log('\nCOL não está acessível!');
  }
  
  Logger.log('\n' + '═'.repeat(60));
}

/**
 * Mostra a agenda com índices FIXOS (sem usar COL)
 * Para testar e descobrir onde estão os dados
 */
function testarAgendaComIndicesFixos() {
  Logger.log('═'.repeat(80));
  Logger.log('TESTE: AGENDA COM ÍNDICES FIXOS (43 COLUNAS)');
  Logger.log('═'.repeat(80));
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('EVENTOS');
  const data = sheet.getDataRange().getValues();
  
  Logger.log(`\nTotal de colunas: ${data[0].length}`);
  Logger.log(`Total de eventos: ${data.length - 1}\n`);
  
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue; // Pula vazios
    
    const evento = {
      id: data[i][0],           // Col 1
      tipo: data[i][1],         // Col 2
      data: data[i][2],         // Col 3
      dataFim: data[i][3],      // Col 4 (NOVA)
      hora: data[i][4],         // Col 5 (+1)
      duracao: data[i][5],      // Col 6 (+1)
      tipoEvento: data[i][6],   // Col 7 (+1)
      projeto: data[i][7],      // Col 8 (+1)
      idContratante: data[i][8], // Col 9 (+1)
      nomeContratante: data[i][9], // Col 10 (+1)
      idCerimonialista: data[i][10], // Col 11 (+1)
      nomeCerimonialista: data[i][11], // Col 12 (+1)
      idEndereco: data[i][12],  // Col 13 (+1)
      local: data[i][13]        // Col 14 (+1)
    };
    
    Logger.log(`─── EVENTO ${i} ───`);
    Logger.log(`ID: ${evento.id}`);
    Logger.log(`Data: ${evento.data}`);
    Logger.log(`Hora: ${evento.hora}`);
    Logger.log(`Tipo: ${evento.tipoEvento}`);
    Logger.log(`Contratante: ${evento.nomeContratante}`);
    Logger.log(`Local: ${evento.local}`);
    Logger.log('');
  }
  
  Logger.log('═'.repeat(80));
}
