/**
 * ======================================================
 * API AUTH — BACKEND (Apps Script)
 * ======================================================
 * Responsável por:
 * - Autenticação via sessão Google
 * - Validação de acesso por e-mail
 * - Controle de perfil (Proprietário, Sócio, Músico)
 *
 * IMPORTANTE:
 * - ESTE ARQUIVO NÃO RETORNA HTML
 * - APENAS JSON
 * - USADO POR SITE EXTERNO (Web App)
 * ======================================================
 */


/**
 * Endpoint principal do Web App
 * Todas as chamadas externas entram por aqui
 */
function doGet(e) {
  try {
    const action = e?.parameter?.action;

    if (!action) {
      return jsonResponse({
        ok: false,
        error: 'NO_ACTION',
        message: 'Parâmetro action não informado'
      });
    }

    switch (action) {

      /**
       * =========================
       * AUTH
       * =========================
       */
      case 'auth.me':
        return authMe();

      /**
       * =========================
       * DEFAULT
       * =========================
       */
      default:
        return jsonResponse({
          ok: false,
          error: 'UNKNOWN_ACTION',
          action
        });
    }

  } catch (err) {
    return jsonResponse({
      ok: false,
      error: 'SERVER_ERROR',
      message: err.message
    });
  }
}


/**
 * ======================================================
 * AUTH.ME
 * Retorna dados do usuário autenticado
 * ======================================================
 */
function authMe() {
  const email = Session.getActiveUser().getEmail();

  // NÃO autenticado no Google
  if (!email) {
    return jsonResponse({
      ok: false,
      error: 'NOT_AUTHENTICATED',
      message: 'Usuário não autenticado no Google'
    });
  }

  const usuario = buscarUsuarioPorEmail(email);

  // Email não autorizado no sistema
  if (!usuario) {
    return jsonResponse({
      ok: false,
      error: 'ACCESS_DENIED',
      message: 'Usuário não autorizado',
      email
    });
  }

  // Usuário inativo
  if (String(usuario.STATUS).toLowerCase() !== 'ativo') {
    return jsonResponse({
      ok: false,
      error: 'USER_INACTIVE',
      message: 'Usuário inativo no sistema'
    });
  }

  // OK
  return jsonResponse({
    ok: true,
    user: {
      id: usuario.ID_USUARIO,
      email: usuario.EMAIL,
      nome: usuario.NOME,
      perfil: usuario.PERFIL
    }
  });
}


/**
 * ======================================================
 * BUSCA USUÁRIO NA PLANILHA
 * ======================================================
 */
function buscarUsuarioPorEmail(email) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('USUARIOS'); // ajuste se necessário

  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).toUpperCase().trim());

  const idxEmail  = headers.indexOf('EMAIL');
  const idxStatus = headers.indexOf('STATUS');

  if (idxEmail < 0) return null;

  for (let i = 1; i < data.length; i++) {
    const rowEmail = String(data[i][idxEmail]).toLowerCase().trim();

    if (rowEmail === email.toLowerCase().trim()) {
      return {
        ID_USUARIO: data[i][headers.indexOf('ID_USUARIO')],
        EMAIL: data[i][idxEmail],
        NOME: data[i][headers.indexOf('NOME')],
        PERFIL: data[i][headers.indexOf('PERFIL')],
        STATUS: data[i][idxStatus]
      };
    }
  }

  return null;
}


/**
 * ======================================================
 * RESPONSE JSON PADRÃO
 * ======================================================
 */
function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}