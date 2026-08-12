/**
 * ======================================================
 * INTEGRAÇÃO — ORÇAMENTOS DO SISTEMA PRINCIPAL
 * ======================================================
 * Mantém o contrato usado pelo frontend e executa todo o fluxo
 * diretamente no motor interno e na aba ORCAMENTOS.
 */

function gerarOrcamentoInterno(params, email) {
  const usuario = requireUserByEmail(email);
  return gerarOrcamentoInternoLocal_(params || {}, usuario);
}

function listarOrcamentosInternos(params, email) {
  requireUserByEmail(email);
  return listarOrcamentosInternosLocal_(params || {});
}
