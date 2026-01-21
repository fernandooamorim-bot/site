/**
 * ════════════════════════════════════════════════════════════════
 * CONSTANTES DE COLUNAS - ESTRUTURA 43 COLUNAS //
 * ════════════════════════════════════════════════════════════════
 * 
 * IMPORTANTE: Sempre usar estas constantes em vez de números!
 * Exemplo: dados[i][COL.VALOR_TOTAL] em vez de dados[i][14]
 * 
 * Índices JavaScript (base-0): Coluna 1 = índice 0, Coluna 43 = índice 42
 */

const COL = {
  // Identificação e Tipo (1-4)
  ID_EVENTO: 0,              // Col 1
  TIPO_REGISTRO: 1,          // Col 2
  DATA_EVENTO: 2,            // Col 3
  DATA_FIM: 3,               // Col 4 ← NOVA!
  
  // Horário e Características (5-8)
  HORA_INICIO: 4,            // Col 5 (antes era índice 3)
  DURACAO: 5,                // Col 6 (antes era índice 4)
  TIPO_EVENTO: 6,            // Col 7 (antes era índice 5)
  PROJETO: 7,                // Col 8 (antes era índice 6)
  
  // Contratante e Cerimonialista (9-14)
  ID_CONTRATANTE: 8,         // Col 9 (antes era índice 7)
  NOME_CONTRATANTE: 9,       // Col 10 (antes era índice 8)
  ID_CERIMONIALISTA: 10,     // Col 11 (antes era índice 9)
  NOME_CERIMONIALISTA: 11,   // Col 12 (antes era índice 10)
  ID_ENDERECO: 12,           // Col 13 (antes era índice 11)
  LOCAL: 13,                 // Col 14 (antes era índice 12)
  
  // Valores Financeiros (15-18)
  VALOR_TOTAL: 14,           // Col 15 (antes era índice 13)
  VALOR_RECEBIDO: 15,        // Col 16 (antes era índice 14)
  VALOR_PENDENTE: 16,        // Col 17 (antes era índice 15)
  STATUS_RECEBIMENTO: 17,    // Col 18 (antes era índice 16)
  
  // Vendedor e Comissão (19-25)
  ID_VENDEDOR: 18,           // Col 19 (antes era índice 17)
  NOME_VENDEDOR: 19,         // Col 20 (antes era índice 18)
  COMISSAO_TIPO: 20,         // Col 21 (antes era índice 19)
  COMISSAO_VALOR: 21,        // Col 22 (antes era índice 20)
  VALOR_COMISSAO_CALCULADO: 22,  // Col 23 (antes era índice 21)
  VALOR_COMISSAO_PAGO: 23,   // Col 24 (antes era índice 22)
  STATUS_COMISSAO: 24,       // Col 25 (antes era índice 23)
  
  // BV - Bonificação de Vendas (26-30)
  ID_BV: 25,                 // Col 26 (antes era índice 24)
  NOME_BV: 26,               // Col 27 (antes era índice 25)
  VALOR_BV: 27,              // Col 28 (antes era índice 26)
  STATUS_BV: 28,             // Col 29 (antes era índice 27)
  BV_DATA_PAGAMENTO: 29,     // Col 30 ← NOVA!
  
  // Nota Fiscal (31-33)
  TEM_NF: 30,                // Col 31 (antes era índice 28)
  VALOR_NF: 31,              // Col 32 (antes era índice 29)
  STATUS_NF: 32,             // Col 33 (antes era índice 30)
  
  // Folha de Custo (34-35)
  FOLHA_CUSTO_VALOR: 33,     // Col 34 ← NOVA!
  FOLHA_CUSTO_DESCRICAO: 34, // Col 35 ← NOVA!
  
  // Extras e Auditoria (36-43)
  LOOK: 35,                  // Col 36 (antes era índice 31)
  SOM_RESPONSAVEL: 36,       // Col 37 (antes era índice 32)
  OBSERVACOES: 37,           // Col 38 (antes era índice 33)
  STATUS_GERAL: 38,          // Col 39 (antes era índice 34)
  DATA_CRIACAO: 39,          // Col 40 (antes era índice 35)
  CRIADO_POR: 40,            // Col 41 (antes era índice 36)
  ULTIMA_EDICAO: 41,         // Col 42 (antes era índice 37)
  EDITADO_POR: 42            // Col 43 (antes era índice 38)
};

/**
 * Versão com números de coluna (1-based) para uso com getRange
 */
const COLUNA = {
  ID_EVENTO: 1,
  TIPO_REGISTRO: 2,
  DATA_EVENTO: 3,
  DATA_FIM: 4,
  HORA_INICIO: 5,
  DURACAO: 6,
  TIPO_EVENTO: 7,
  PROJETO: 8,
  ID_CONTRATANTE: 9,
  NOME_CONTRATANTE: 10,
  ID_CERIMONIALISTA: 11,
  NOME_CERIMONIALISTA: 12,
  ID_ENDERECO: 13,
  LOCAL: 14,
  VALOR_TOTAL: 15,
  VALOR_RECEBIDO: 16,
  VALOR_PENDENTE: 17,
  STATUS_RECEBIMENTO: 18,
  ID_VENDEDOR: 19,
  NOME_VENDEDOR: 20,
  COMISSAO_TIPO: 21,
  COMISSAO_VALOR: 22,
  VALOR_COMISSAO_CALCULADO: 23,
  VALOR_COMISSAO_PAGO: 24,
  STATUS_COMISSAO: 25,
  ID_BV: 26,
  NOME_BV: 27,
  VALOR_BV: 28,
  STATUS_BV: 29,
  BV_DATA_PAGAMENTO: 30,
  TEM_NF: 31,
  VALOR_NF: 32,
  STATUS_NF: 33,
  FOLHA_CUSTO_VALOR: 34,
  FOLHA_CUSTO_DESCRICAO: 35,
  LOOK: 36,
  SOM_RESPONSAVEL: 37,
  OBSERVACOES: 38,
  STATUS_GERAL: 39,
  DATA_CRIACAO: 40,
  CRIADO_POR: 41,
  ULTIMA_EDICAO: 42,
  EDITADO_POR: 43
};

// Total de colunas
const TOTAL_COLUNAS_EVENTOS = 43;
