/**
 * Configuração interna compartilhada por integrações do backend.
 * A aba CONFIG é a fonte principal; Script Properties é contingência.
 */
function obterConfigSeguro(chave) {
  const nome = String(chave || '').trim();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('CONFIG');
  if (!sheet) return obterConfigSeguroContingencia_(nome);

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === nome) return data[i][1];
  }
  return obterConfigSeguroContingencia_(nome);
}

function obterConfigSeguroContingencia_(nome) {
  try {
    const valor = PropertiesService.getScriptProperties().getProperty(nome);
    if (valor !== null && String(valor).trim() !== '') return valor;
  } catch (_) {}
  return '';
}
