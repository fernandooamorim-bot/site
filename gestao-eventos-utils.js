/**
 * ========================================
 * FUNÇÕES UTILITÁRIAS E HELPERS
 * ========================================
 */

// ========================================
// GERAÇÃO DE IDs
// ========================================

/**
 * Gera ID único para evento
 * Formato: AG-YYYYMMDD-NNN
 */
function gerarIDEvento() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('EVENTOS');
  const config = getConfig();
  
  const prefixo = config.PREFIXO_ID_EVENTO || 'AG';
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const dia = String(hoje.getDate()).padStart(2, '0');
  const dataStr = `${ano}${mes}${dia}`;
  
  // Busca último ID do dia
  const data = sheet.getDataRange().getValues();
  let maxSeq = 0;
  
  for (let i = 1; i < data.length; i++) {
    const id = data[i][0];
    if (id && id.includes(dataStr)) {
      const seq = parseInt(id.split('-')[2]);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  
  const novoSeq = String(maxSeq + 1).padStart(3, '0');
  return `${prefixo}-${dataStr}-${novoSeq}`;
}

/**
 * Gera ID único para movimentação financeira
 * Formato: MOV-YYYYMMDD-NNN
 */
function gerarIDMovimentacao() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('MOVIMENTACOES_FINANCEIRAS');
  const config = getConfig();
  
  const prefixo = config.PREFIXO_ID_MOVIMENTACAO || 'MOV';
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const dia = String(hoje.getDate()).padStart(2, '0');
  const dataStr = `${ano}${mes}${dia}`;
  
  const data = sheet.getDataRange().getValues();
  let maxSeq = 0;
  
  for (let i = 1; i < data.length; i++) {
    const id = data[i][0];
    if (id && id.includes(dataStr)) {
      const seq = parseInt(id.split('-')[2]);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  
  const novoSeq = String(maxSeq + 1).padStart(3, '0');
  return `${prefixo}-${dataStr}-${novoSeq}`;
}

/**
 * Gera ID único para fechamento de comissão
 * Formato: AC-VND-NNN-YYYYMMDDHHMMSS
 */
function gerarIDFechamento(idVendedor) {
  const config = getConfig();
  const prefixo = config.PREFIXO_ID_FECHAMENTO || 'AC-VND';
  
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  const hora = String(agora.getHours()).padStart(2, '0');
  const min = String(agora.getMinutes()).padStart(2, '0');
  const seg = String(agora.getSeconds()).padStart(2, '0');
  
  const vendedorSeq = String(idVendedor).padStart(3, '0');
  const timestamp = `${ano}${mes}${dia}${hora}${min}${seg}`;
  
  return `${prefixo}-${vendedorSeq}-${timestamp}`;
}

// ========================================
// CONFIGURAÇÕES
// ========================================

/**
 * Retorna configurações do sistema como objeto
 */
function getConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('CONFIG');
  const data = sheet.getDataRange().getValues();
  
  const config = {};
  for (let i = 1; i < data.length; i++) {
    const chave = data[i][0];
    const valor = data[i][1];
    config[chave] = valor;
  }
  
  return config;
}

/**
 * Atualiza uma configuração
 */
function setConfig(chave, valor) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('CONFIG');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === chave) {
      sheet.getRange(i + 1, 2).setValue(valor);
      registrarLog('ATUALIZAR', 'CONFIG', chave, `Valor atualizado para: ${valor}`);
      return true;
    }
  }
  
  return false;
}

// ========================================
// SISTEMA DE LOGS
// ========================================

/**
 * Registra log de ação no sistema
 */
function registrarLog(request, acao, tabela, idRegistro, detalhes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('LOGS');

  const usuario = requireUser(request.token);

  const proximaLinha = sheet.getLastRow() + 1;
  const idLog = `LOG-${Date.now()}`;

  const novoLog = [
    idLog,
    new Date(),
    usuario.email,
    acao,
    tabela,
    idRegistro,
    detalhes
  ];

  sheet
    .getRange(proximaLinha, 1, 1, novoLog.length)
    .setValues([novoLog]);
}

// ========================================
// VALIDAÇÕES
// ========================================

/**
 * Valida se email é de usuário ativo
 */
function validarUsuario(email) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('USUARIOS');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === email && data[i][4] === 'Ativo') {
      return {
        valido: true,
        id: data[i][0],
        nome: data[i][2],
        perfil: data[i][3]
      };
    }
  }
  
  return { valido: false };
}

/**
 * Verifica permissão do usuário
 */
function verificarPermissao(request, acao) {
  const usuario = requireUser(request.token);

  const permissoes = {
    'Proprietário': ['*'], // Todas as permissões
    'Sócio': ['cadastrar_evento', 'ver_financeiro', 'ver_dashboard'],
    'Músico': ['ver_agenda']
  };

  const perfilPermissoes = permissoes[usuario.perfil] || [];

  return perfilPermissoes.includes('*') || perfilPermissoes.includes(acao);
}

// ========================================
// BUSCA E LOOKUP
// ========================================

/**
 * Busca contratante por ID
 */
function buscarContratante(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('CONTRATANTES');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      return {
        id: data[i][0],
        nome: data[i][1],
        whatsapp: data[i][2],
        email: data[i][3]
      };
    }
  }
  
  return null;
}

/**
 * Busca vendedor por ID
 */
function buscarVendedor(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('VENDEDORES');
  const data = sheet.getDataRange().getValues();
  const alvo = String(id).trim();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === alvo) {
      return {
        id: data[i][0],
        nome: data[i][1],
        comissaoPadrao: data[i][2],
        status: data[i][3]
      };
    }
  }
  
  return null;
}

/**
 * Busca evento por ID
 */
function buscarEvento(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('EVENTOS');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][COL.ID_EVENTO] === id) {
      return {
        id: data[i][COL.ID_EVENTO],
        tipo: data[i][COL.TIPO_REGISTRO],
        data: data[i][COL.DATA_EVENTO],
        dataFim: data[i][COL.DATA_FIM],
        horaInicio: data[i][COL.HORA_INICIO],
        nomeContratante: data[i][COL.NOME_CONTRATANTE],
        idContratante: data[i][COL.ID_CONTRATANTE],
        valorTotal: data[i][COL.VALOR_TOTAL],        // Col 15 (antes 14)
        valorRecebido: data[i][COL.VALOR_RECEBIDO],  // Col 16 (antes 15)
        valorPendente: data[i][COL.VALOR_PENDENTE],  // Col 17 (antes 16)
        statusRecebimento: data[i][COL.STATUS_RECEBIMENTO], // Col 18 (antes 17)
        idVendedor: data[i][COL.ID_VENDEDOR],        // Col 19 (antes 18)
        nomeVendedor: data[i][COL.NOME_VENDEDOR],    // Col 20 (antes 19)
        comissaoTipo: data[i][COL.COMISSAO_TIPO],    // Col 21 (antes 20)
        comissaoValor: data[i][COL.COMISSAO_VALOR],  // Col 22 (antes 21)
        idBV: data[i][COL.ID_BV],                    // Col 26 (antes 25)
        nomeBV: data[i][COL.NOME_BV],                // Col 27 (antes 26)
        valorBV: data[i][COL.VALOR_BV],              // Col 28 (antes 27)
        statusBV: data[i][COL.STATUS_BV],            // Col 29 (antes 28)
        bvDataPagamento: data[i][COL.BV_DATA_PAGAMENTO], // Col 30 NOVA!
        temNF: data[i][COL.TEM_NF],                  // Col 31 (antes 29)
        valorNF: data[i][COL.VALOR_NF],              // Col 32 (antes 30)
        statusNF: data[i][COL.STATUS_NF],            // Col 33 (antes 31)
        folhaCustoValor: data[i][COL.FOLHA_CUSTO_VALOR], // Col 34 NOVA!
        folhaCustoDescricao: data[i][COL.FOLHA_CUSTO_DESCRICAO] // Col 35 NOVA!
      };
    }
  }
  
  return null;
}

// ========================================
// LISTAS PARA DROPDOWNS
// ========================================

/**
 * Retorna lista de contratantes para dropdown
 */
function listarContratantes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('CONTRATANTES');
  const data = sheet.getDataRange().getValues();
  
  const lista = [];
  for (let i = 1; i < data.length; i++) {
    lista.push({
      id: data[i][0],
      nome: data[i][1]
    });
  }
  
  return lista;
}

/**
 * Retorna lista de vendedores ativos
 */
function listarVendedores() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('VENDEDORES');
  const data = sheet.getDataRange().getValues();
  
  const lista = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][3] === 'Ativo') {
      lista.push({
        id: data[i][0],
        nome: data[i][1]
      });
    }
  }
  
  return lista;
}

/**
 * Retorna lista de cerimonialistas
 */
function listarCerimonialistas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('CERIMONIALISTAS');
  const data = sheet.getDataRange().getValues();
  
  const lista = [];
  for (let i = 1; i < data.length; i++) {
    lista.push({
      id: data[i][0],
      nome: data[i][1]
    });
  }
  
  return lista;
}

/**
 * Retorna lista de endereços
 */
function listarEnderecos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('ENDERECOS');
  const data = sheet.getDataRange().getValues();
  
  const lista = [];
  for (let i = 1; i < data.length; i++) {
    lista.push({
      id: data[i][0],
      nome: data[i][1],
      endereco: data[i][2]
    });
  }
  
  return lista;
}

function listarParceirosBV() {
  Logger.log('📋 listarParceirosBV');
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName('PARCEIROS_BV');
    if (!sheet) return [];

    const dados = sheet.getDataRange().getValues();
    const lista = [];

    for (let i = 1; i < dados.length; i++) {
      const id = dados[i][0];
      const nome = dados[i][1];
      if (id && nome) {
        lista.push({ id: String(id), nome: String(nome) });
      }
    }

    Logger.log('✅ ' + lista.length + ' parceiros BV');
    return lista;
  } catch (erro) {
    Logger.log('❌ Erro: ' + erro.message);
    return [];
  }
}

// ========================================
// FORMATAÇÃO
// ========================================

/**
 * Formata valor em moeda brasileira
 */
function formatarMoeda(valor) {
  if (valor === null || valor === undefined) return 'R$ 0,00';
  
  return 'R$ ' + Number(valor).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Formata data para padrão brasileiro
 */
function formatarData(data) {
  if (!data) return '';
  
  const d = new Date(data);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const ano = d.getFullYear();
  
  return `${dia}/${mes}/${ano}`;
}

/**
 * Formata percentual
 */
function formatarPercentual(valor) {
  if (valor === null || valor === undefined) return '0%';
  
  return (Number(valor) * 100).toFixed(1) + '%';
}
/**
 * Formata percentual no formato inteiro (10 = 10%)
 * Usado para comissões configuradas como inteiro
 */
function formatarPercentualInteiro(valor) {
  if (valor === null || valor === undefined) return '0%';
  
  return Number(valor).toFixed(1) + '%';
}

/*DATA DO MODO CERTO - CORREÇAO DE DATA*/
function parseDataSemFuso(dataStr) {
  if (!dataStr) return null;

  if (Object.prototype.toString.call(dataStr) === '[object Date]') {
    return dataStr;
  }

  const partes = String(dataStr).split('-');
  if (partes.length !== 3) return null;

  return new Date(
    Number(partes[0]),      // ano
    Number(partes[1]) - 1,  // mês (0-based)
    Number(partes[2]),      // dia
    12, 0, 0                // meio-dia → evita shift de fuso
  );
}

/**
 * Normaliza datas para uso FINANCEIRO
 * ⚠️ NÃO MEXER
 * Retorna SOMENTE DATA (00:00:00)
 * Garante que o Google Sheets formate como DATA, não DATA/HORA
 */
function normalizarData(valor) {
  if (!valor) return null;

  // Se já for Date → zera hora
  if (valor instanceof Date) {
    return new Date(
      valor.getFullYear(),
      valor.getMonth(),
      valor.getDate(),
      0, 0, 0, 0
    );
  }

  // YYYY-MM-DD
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [y, m, d] = valor.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }

  // DD/MM/YYYY
  if (typeof valor === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(valor)) {
    const [d, m, y] = valor.split('/').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }

  return null;
}
