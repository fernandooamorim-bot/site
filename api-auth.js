/**
 * =========================================================
 * API AUTH — Autenticação e Autorização do Sistema
 * =========================================================
 *
 * Responsável por:
 * - Identificar o usuário logado via Google
 * - Validar acesso com base na planilha (USUARIOS)
 * - Retornar dados padronizados para frontend externo
 *
 * NÃO usa OAuth manual
 * NÃO usa token
 * NÃO usa CORS
 *
 * Funciona via Web App (doGet)
 * =========================================================
 */


/**
 * =========================================================
 * ENTRYPOINT DO WEB APP
 * =========================================================
 * Todas as chamadas externas passam por aqui
 */
function doGet(e) {
  try {
    const action = e?.parameter?.action;

    if (!action) {
      return jsonResponse({
        error: true,
        message: 'Ação não informada'
      }, 400);
    }

    switch (action) {

      case 'auth.me':
        return authMe();

      default:
        return jsonResponse({
          error: true,
          message: 'Ação inválida'
        }, 404);
    }

  } catch (err) {
    return jsonResponse({
      error: true,
      message: err.message
    }, 500);
  }
}


/**
 * =========================================================
 * AUTH.ME
 * =========================================================
 * Retorna informações do usuário logado
 * Baseado em sessão Google + planilha
 */
function authMe() {
  const email = Session.getActiveUser().getEmail();

  // Sessão não identificada (caso raro)
  if (!email) {
    return jsonResponse({
      logado: false,
      autorizado: false,
      motivo: 'Sessão Google não identificada'
    }, 401);
  }

  const usuario = buscarUsuarioPorEmail(email);

  // Usuário não encontrado
  if (!usuario) {
    return jsonResponse({
      logado: true,
      autorizado: false,
      email,
      motivo: 'Usuário não cadastrado'
    }, 403);
  }

  // Usuário inativo
  if (usuario.STATUS !== 'Ativo') {
    return jsonResponse({
      logado: true,
      autorizado: false,
      email,
      motivo: 'Usuário inativo'
    }, 403);
  }

  // Usuário válido
  return jsonResponse({
    logado: true,
    autorizado: true,
    email: usuario.EMAIL,
    nome: usuario.NOME,
    perfil: usuario.PERFIL,
    status: usuario.STATUS
  });
}


/**
 * =========================================================
 * BUSCA USUÁRIO NA PLANILHA
 * =========================================================
 * Aba esperada: USUARIOS
 *
 * Colunas obrigatórias:
 * - EMAIL
 * - NOME
 * - PERFIL
 * - STATUS
 */
function buscarUsuarioPorEmail(email) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('USUARIOS');

  if (!sheet) {
    throw new Error('Aba USUARIOS não encontrada');
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const idxEmail  = headers.indexOf('EMAIL');
  const idxNome   = headers.indexOf('NOME');
  const idxPerfil = headers.indexOf('PERFIL');
  const idxStatus = headers.indexOf('STATUS');

  if (idxEmail < 0 || idxNome < 0 || idxPerfil < 0 || idxStatus < 0) {
    throw new Error('Estrutura da aba USUARIOS inválida');
  }

  for (let i = 1; i < data.length; i++) {
    const emailPlanilha = String(data[i][idxEmail] || '').toLowerCase().trim();

    if (emailPlanilha === email.toLowerCase()) {
      return {
        EMAIL:  data[i][idxEmail],
        NOME:   data[i][idxNome],
        PERFIL: data[i][idxPerfil],
        STATUS: data[i][idxStatus]
      };
    }
  }

  return null;
}


/**
 * =========================================================
 * HELPER — RESPOSTA JSON
 * =========================================================
 * Padroniza respostas para o frontend
 */
function jsonResponse(obj, statusCode = 200) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}