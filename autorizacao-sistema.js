/**
 * ======================================================
 * AUTORIZAÇÃO DO SISTEMA
 * ======================================================
 * Mantém diagnóstico de escopos fora da planilha para que a ausência de
 * permissão não fique mascarada por fallbacks de configuração.
 *
 * Esta função é administrativa: execute `autorizarSistemaAgenda` no editor
 * do Apps Script, usando a conta proprietária, sempre que o Google indicar
 * que alguma permissão do projeto está pendente.
 */

const AUTORIZACAO_SISTEMA_ESCOPOS_ = [
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/script.send_mail',
  'https://www.googleapis.com/auth/script.scriptapp'
];

function diagnosticarAutorizacaoSistema_() {
  const info = ScriptApp.getAuthorizationInfo(
    ScriptApp.AuthMode.FULL,
    AUTORIZACAO_SISTEMA_ESCOPOS_
  );
  const status = info.getAuthorizationStatus();
  const requerida = status === ScriptApp.AuthorizationStatus.REQUIRED;
  let escoposAutorizados = [];
  try {
    escoposAutorizados = info.getAuthorizedScopes() || [];
  } catch (_) {}

  return {
    ok: !requerida,
    status: String(status),
    escoposSolicitados: AUTORIZACAO_SISTEMA_ESCOPOS_.slice(),
    escoposAutorizados: escoposAutorizados.map(function (escopo) {
      return String(escopo);
    })
  };
}

/**
 * Executar manualmente no editor para disparar a autorização granular do
 * Google para todos os escopos declarados no manifesto do projeto.
 */
function autorizarSistemaAgenda() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  const diagnostico = diagnosticarAutorizacaoSistema_();
  console.log('[AGENDA_AUTH_GRANTED] ' + JSON.stringify({
    status: diagnostico.status,
    quantidadeEscoposAutorizados: diagnostico.escoposAutorizados.length
  }));
  return diagnostico;
}

function registrarFalhaAutorizacaoSistema_(contexto) {
  let diagnostico = { ok: false, status: 'DIAGNOSTICO_INDISPONIVEL' };
  try {
    diagnostico = diagnosticarAutorizacaoSistema_();
  } catch (_) {}

  // Cloud Logging: não depende de SpreadsheetApp e não inclui e-mail,
  // payload, tokens ou valores da planilha.
  console.error('[AGENDA_AUTH_MISSING] ' + JSON.stringify({
    action: String(contexto && contexto.action || ''),
    requestId: String(contexto && contexto.requestId || ''),
    status: String(diagnostico.status || ''),
    quantidadeEscoposAutorizados: Array.isArray(diagnostico.escoposAutorizados)
      ? diagnostico.escoposAutorizados.length
      : 0
  }));
}

function erroDeAutorizacaoPlanilha_(mensagem) {
  return /permission to call SpreadsheetApp|auth\/spreadsheets(?:\.currentonly)?|authorization is required/i
    .test(String(mensagem || ''));
}
