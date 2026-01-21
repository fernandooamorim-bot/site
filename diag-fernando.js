/**
 * 🔍 DIAGNÓSTICO COMPLETO - PROBLEMA DE COLUNAS
 * Adicione este código no Apps Script e execute testeDiagnostico()
 */

function testeDiagnostico() {
  Logger.log('═'.repeat(80));
  Logger.log('🔍 DIAGNÓSTICO COMPLETO - VERIFICAÇÃO DE ESTRUTURA');
  Logger.log('═'.repeat(80));
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('EVENTOS');
  
  // 1. VERIFICAR CABEÇALHOS DA PLANILHA
  Logger.log('\n📋 CABEÇALHOS DA PLANILHA:');
  Logger.log('─'.repeat(80));
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  headers.forEach((h, i) => {
    Logger.log(`Coluna ${String.fromCharCode(65+i)} (índice ${i}): ${h}`);
  });
  
  // 2. VERIFICAR DADOS DA LINHA 2
  Logger.log('\n📊 DADOS DA LINHA 2 (EXEMPLO):');
  Logger.log('─'.repeat(80));
  
  if (sheet.getLastRow() >= 2) {
    const dados = sheet.getRange(2, 1, 1, headers.length).getValues()[0];
    dados.forEach((v, i) => {
      const tipo = v instanceof Date ? 'Date' : typeof v;
      Logger.log(`Coluna ${String.fromCharCode(65+i)} (${headers[i]}): ${v} [tipo: ${tipo}]`);
    });
  } else {
    Logger.log('⚠️ Não há dados na linha 2');
  }
  
  // 3. SIMULAR CADASTRO DE EVENTO
  Logger.log('\n🧪 SIMULAÇÃO DE CADASTRO:');
  Logger.log('─'.repeat(80));
  
  const dadosTeste = {
    tipoRegistro: 'Evento',
    dataEvento: '2025-12-31',      // YYYY-MM-DD
    dataFim: null,                 // vazio
    horaInicio: '19:00',
    duracao: 120,
    tipoEvento: 'Casamento',
    projeto: 'Banda Completa',
    idContratante: '1',
    idEndereco: '1',
    valorTotal: 5000,
    idVendedor: '1',
    comissaoTipo: 'Padrão',
    temNF: false,
    valorBV: 0
  };
  
  Logger.log('📥 Dados recebidos (simulação):');
  Logger.log(JSON.stringify(dadosTeste, null, 2));
  
  // 4. PROCESSAR DADOS (como faz criarEvento)
  Logger.log('\n⚙️ PROCESSAMENTO:');
  Logger.log('─'.repeat(80));
  
  const dataEventoFormatada = formatarDataTexto(dadosTeste.dataEvento);
  Logger.log(`dataEvento (original): ${dadosTeste.dataEvento}`);
  Logger.log(`dataEvento (formatada): ${dataEventoFormatada}`);
  
  const dataFimFormatada = dadosTeste.dataFim ? formatarDataTexto(dadosTeste.dataFim) : '';
  Logger.log(`dataFim (original): ${dadosTeste.dataFim}`);
  Logger.log(`dataFim (formatada): "${dataFimFormatada}"`);
  
  const partesHora = dadosTeste.horaInicio.split(':');
  const horaDate = new Date(1970, 0, 1, parseInt(partesHora[0]), parseInt(partesHora[1]), 0);
  Logger.log(`horaInicio (original): ${dadosTeste.horaInicio}`);
  Logger.log(`horaInicio (Date): ${horaDate}`);
  
  // 5. MONTAR ARRAY (primeiras 10 posições)
  Logger.log('\n📦 ARRAY novaLinha (primeiras 10 posições):');
  Logger.log('─'.repeat(80));
  
  const arrayTeste = [
    'AG-TEST-001',           // 0: ID_EVENTO
    dadosTeste.tipoRegistro, // 1: TIPO_REGISTRO
    dataEventoFormatada,     // 2: DATA_EVENTO
    dataFimFormatada,        // 3: DATA_FIM
    horaDate,                // 4: HORA_INICIO
    dadosTeste.duracao,      // 5: DURACAO
    dadosTeste.tipoEvento,   // 6: TIPO_EVENTO
    dadosTeste.projeto,      // 7: PROJETO
    dadosTeste.idContratante, // 8: ID_CONTRATANTE
    'João Silva'             // 9: NOME_CONTRATANTE
  ];
  
  arrayTeste.forEach((v, i) => {
    const coluna = String.fromCharCode(65+i);
    const tipo = v instanceof Date ? 'Date' : typeof v;
    Logger.log(`Posição ${i} (Coluna ${coluna}): ${v} [tipo: ${tipo}]`);
  });
  
  // 6. VERIFICAR SE ESTÁ VAZIO
  Logger.log('\n⚠️ VERIFICAÇÃO DE VALORES VAZIOS:');
  Logger.log('─'.repeat(80));
  
  Logger.log(`dataFimFormatada === '' ? ${dataFimFormatada === ''}`);
  Logger.log(`dataFimFormatada === null ? ${dataFimFormatada === null}`);
  Logger.log(`dataFimFormatada === undefined ? ${dataFimFormatada === undefined}`);
  Logger.log(`Length: ${dataFimFormatada.length}`);
  
  // 7. CONCLUSÃO
  Logger.log('\n' + '═'.repeat(80));
  Logger.log('🎯 CONCLUSÃO:');
  Logger.log('═'.repeat(80));
  
  Logger.log('\n✅ SE TUDO ACIMA ESTÁ CORRETO:');
  Logger.log('   - Posição 2 = DATA_EVENTO');
  Logger.log('   - Posição 3 = DATA_FIM (vazio "")');
  Logger.log('   - Posição 4 = HORA_INICIO (Date)');
  Logger.log('   - Posição 5 = DURACAO (120)');
  Logger.log('   - Posição 6 = TIPO_EVENTO (Casamento)');
  
  Logger.log('\n❌ SE NA PLANILHA ESTÁ:');
  Logger.log('   - Coluna D (DATA_FIM) = 19:00 ← ERRADO!');
  Logger.log('   - Coluna E (HORA_INICIO) = 120 ← ERRADO!');
  
  Logger.log('\n🔍 ENTÃO O PROBLEMA É:');
  Logger.log('   1. Sheets está "compactando" array vazio');
  Logger.log('   2. OU existe outra função sendo executada');
  Logger.log('   3. OU trigger está reprocessando');
  
  Logger.log('\n' + '═'.repeat(80));
  Logger.log('📝 Veja o log completo acima para análise');
  Logger.log('═'.repeat(80));
}

function formatarDataTexto(valor) {
  if (!valor) return '';
  if (typeof valor === 'string' && valor.includes('-')) {
    const [ano, mes, dia] = valor.split('-');
    return `${dia}/${mes}/${ano}`;
  }
  return valor;
}