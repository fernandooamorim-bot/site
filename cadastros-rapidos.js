/**
 * Cadastros rápidos consolidados (canônico)
 * Evita colisão de funções globais vindas de arquivos legados.
 */

const CADASTROS_MESTRES_INFO_ = {
  contratante: { sheet: 'CONTRATANTES', statusCol: 7, label: 'Contratante' },
  local: { sheet: 'ENDERECOS', statusCol: 9, label: 'Local' },
  cerimonialista: { sheet: 'CERIMONIALISTAS', statusCol: 6, label: 'Cerimonialista' },
  parceiro: { sheet: 'PARCEIROS_BV', statusCol: 6, label: 'Parceiro' }
};

const CONTRATANTE_CAMPOS_COMPLEMENTARES_ = ['TIPO_PESSOA', 'ENDERECO_COMPLETO', 'REPRESENTANTE_LEGAL'];

function garantirCamposComplementaresContratante_(sheet) {
  if (!sheet) throw new Error('Aba CONTRATANTES não encontrada');
  const ultimaColuna = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, ultimaColuna).getValues()[0].map(function (v) {
    return String(v || '').trim().toUpperCase();
  });
  CONTRATANTE_CAMPOS_COMPLEMENTARES_.forEach(function (header) {
    if (headers.indexOf(header) >= 0) return;
    headers.push(header);
    sheet.getRange(1, headers.length).setValue(header);
  });
  const mapa = {};
  headers.forEach(function (header, i) { if (header) mapa[header] = i + 1; });
  return mapa;
}

function normalizarTipoPessoaContratante_(valor) {
  const tipo = String(valor || '').trim().toUpperCase();
  if (tipo === 'PF' || tipo === 'PESSOA FÍSICA' || tipo === 'PESSOA FISICA') return 'PF';
  if (tipo === 'PJ' || tipo === 'PESSOA JURÍDICA' || tipo === 'PESSOA JURIDICA') return 'PJ';
  return '';
}

function normalizarEntidadeCadastro_(entidade) {
  const e = String(entidade || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (!e) return '';
  if (e === 'contratante' || e === 'contratantes') return 'contratante';
  if (e === 'local' || e === 'locais' || e === 'endereco' || e === 'enderecos') return 'local';
  if (e === 'cerimonialista' || e === 'cerimonialistas') return 'cerimonialista';
  if (e === 'parceiro' || e === 'parceiros' || e === 'parceiro_bv' || e === 'parceiros_bv') return 'parceiro';
  return '';
}

function obterInfoCadastroMestre_(entidade) {
  const chave = normalizarEntidadeCadastro_(entidade);
  return chave ? CADASTROS_MESTRES_INFO_[chave] : null;
}

function contarVinculosCadastroEmEventos_(entidade, idCadastro) {
  try {
    const idAlvo = String(idCadastro || '').trim();
    if (!idAlvo) return 0;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('EVENTOS');
    if (!sheet) return 0;
    const data = sheet.getDataRange().getValues();
    let idx = -1;
    const chave = normalizarEntidadeCadastro_(entidade);
    if (chave === 'contratante') idx = (typeof COL !== 'undefined' && COL.ID_CONTRATANTE !== undefined) ? COL.ID_CONTRATANTE : 8;
    if (chave === 'local') idx = (typeof COL !== 'undefined' && COL.ID_ENDERECO !== undefined) ? COL.ID_ENDERECO : 12;
    if (chave === 'cerimonialista') idx = (typeof COL !== 'undefined' && COL.ID_CERIMONIALISTA !== undefined) ? COL.ID_CERIMONIALISTA : 10;
    if (chave === 'parceiro') idx = (typeof COL !== 'undefined' && COL.ID_BV !== undefined) ? COL.ID_BV : 25;
    if (idx < 0) return 0;

    let total = 0;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idx] || '').trim() === idAlvo) total++;
    }
    return total;
  } catch (_) {
    return 0;
  }
}

function obterStatusCadastro_(sheet, linha, statusCol) {
  const raw = String(sheet.getRange(linha, statusCol).getValue() || '').trim().toUpperCase();
  return raw === 'INATIVO' ? 'INATIVO' : 'ATIVO';
}

function valorParaLogCadastro_(valor) {
  if (valor === null || typeof valor === 'undefined') return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    const d = valor instanceof Date ? valor : new Date(valor);
    if (isNaN(d.getTime())) return String(valor);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  return String(valor).trim();
}

function coletarDeltaCadastro_(antes, depois) {
  const delta = [];
  const keys = {};
  Object.keys(antes || {}).forEach(function (k) { keys[k] = true; });
  Object.keys(depois || {}).forEach(function (k) { keys[k] = true; });
  Object.keys(keys).forEach(function (campo) {
    const valorAntes = valorParaLogCadastro_(antes[campo]);
    const valorDepois = valorParaLogCadastro_(depois[campo]);
    if (valorAntes !== valorDepois) {
      delta.push({
        campo: campo,
        antes: valorAntes,
        depois: valorDepois
      });
    }
  });
  return delta;
}

function registrarLogCadastroDetalhado_(acao, tabela, idRegistro, nomeRegistro, delta, extra) {
  try {
    if (typeof registrarLog !== 'function') return;
    const payload = {
      tipo: 'CADASTRO_EDICAO_DETALHADA',
      nomeRegistro: String(nomeRegistro || '').trim(),
      totalAlteracoes: Array.isArray(delta) ? delta.length : 0,
      alteracoes: Array.isArray(delta) ? delta : [],
      extra: extra || {}
    };
    registrarLog(
      String(acao || 'EDITAR_CADASTRO'),
      String(tabela || 'CADASTRO'),
      String(idRegistro || ''),
      JSON.stringify(payload)
    );
  } catch (_) {}
}

function definirStatusCadastroMestre_(dados, statusAlvo) {
  try {
    const entidade = normalizarEntidadeCadastro_((dados && dados.entidade) || '');
    const id = String((dados && dados.id) || '').trim();
    if (!entidade) return { sucesso: false, mensagem: 'Entidade inválida para atualização de status.' };
    if (!id) return { sucesso: false, mensagem: 'ID é obrigatório para atualizar status.' };

    const info = obterInfoCadastroMestre_(entidade);
    if (!info) return { sucesso: false, mensagem: 'Configuração da entidade não encontrada.' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(info.sheet);
    if (!sheet) return { sucesso: false, mensagem: 'Aba ' + info.sheet + ' não encontrada.' };

    const registro = localizarRegistroPorId_(sheet, id);
    if (!registro) return { sucesso: false, mensagem: info.label + ' não encontrado.' };

    const atual = obterStatusCadastro_(sheet, registro.linha, info.statusCol);
    const novo = String(statusAlvo || '').trim().toUpperCase() === 'INATIVO' ? 'INATIVO' : 'ATIVO';
    if (atual === novo) {
      return {
        sucesso: true,
        id: registro.id,
        nome: registro.nome,
        entidade: entidade,
        status: atual,
        mensagem: info.label + ' já está ' + (atual === 'ATIVO' ? 'ativo.' : 'inativo.')
      };
    }

    sheet.getRange(registro.linha, info.statusCol).setValue(novo);
    const totalVinculos = contarVinculosCadastroEmEventos_(entidade, id);
    registrarLogCadastroDetalhado_(
      novo === 'ATIVO' ? 'REATIVAR_CADASTRO' : 'INATIVAR_CADASTRO',
      info.sheet,
      registro.id,
      registro.nome,
      [{ campo: 'status', antes: atual, depois: novo }],
      { entidade: entidade, totalVinculos: totalVinculos }
    );

    return {
      sucesso: true,
      id: registro.id,
      nome: registro.nome,
      entidade: entidade,
      status: novo,
      totalVinculos: totalVinculos,
      mensagem: info.label + ' ' + (novo === 'ATIVO' ? 'reativado.' : 'inativado.') + ' com sucesso.'
    };
  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function inativarCadastroMestre(dados) {
  return definirStatusCadastroMestre_(dados, 'INATIVO');
}

function reativarCadastroMestre(dados) {
  return definirStatusCadastroMestre_(dados, 'ATIVO');
}

function cadastrarContratanteRapido(dados) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('CONTRATANTES');

    if (!sheet) {
      return { sucesso: false, mensagem: 'Aba CONTRATANTES não encontrada' };
    }
    const camposComplementares = garantirCamposComplementaresContratante_(sheet);

    const ultimaLinha = sheet.getLastRow();
    const novoId = ultimaLinha > 1 ? sheet.getRange(ultimaLinha, 1).getValue() + 1 : 1;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).toLowerCase() === String(dados.nome || '').toLowerCase()) {
        return {
          sucesso: false,
          mensagem: 'Contratante "' + dados.nome + '" já existe!',
          idExistente: data[i][0]
        };
      }
    }

    sheet.appendRow([
      novoId,
      dados.nome,
      dados.telefone || '',
      dados.email || '',
      dados.cpfCnpj || '',
      new Date()
    ]);
    sheet.getRange(sheet.getLastRow(), CADASTROS_MESTRES_INFO_.contratante.statusCol).setValue('ATIVO');
    const linhaNova = sheet.getLastRow();
    if (dados.tipoPessoa !== undefined) sheet.getRange(linhaNova, camposComplementares.TIPO_PESSOA).setValue(normalizarTipoPessoaContratante_(dados.tipoPessoa));
    if (dados.enderecoCompleto !== undefined) sheet.getRange(linhaNova, camposComplementares.ENDERECO_COMPLETO).setValue(String(dados.enderecoCompleto || '').trim());
    if (dados.representanteLegal !== undefined) sheet.getRange(linhaNova, camposComplementares.REPRESENTANTE_LEGAL).setValue(String(dados.representanteLegal || '').trim());

    return {
      sucesso: true,
      id: novoId,
      nome: dados.nome,
      mensagem: 'Contratante cadastrado!'
    };

  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function cadastrarCerimonialistaRapido(dados) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('CERIMONIALISTAS');

    if (!sheet) {
      return { sucesso: false, mensagem: 'Aba CERIMONIALISTAS não encontrada' };
    }

    const ultimaLinha = sheet.getLastRow();
    const novoId = ultimaLinha > 1 ? sheet.getRange(ultimaLinha, 1).getValue() + 1 : 1;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).toLowerCase() === String(dados.nome || '').toLowerCase()) {
        return {
          sucesso: false,
          mensagem: 'Cerimonialista já existe!',
          idExistente: data[i][0]
        };
      }
    }

    sheet.appendRow([
      novoId,
      dados.nome,
      dados.telefone || '',
      dados.empresa || '',
      new Date()
    ]);
    sheet.getRange(sheet.getLastRow(), CADASTROS_MESTRES_INFO_.cerimonialista.statusCol).setValue('ATIVO');

    return {
      sucesso: true,
      id: novoId,
      nome: dados.nome,
      mensagem: 'Cerimonialista cadastrado!'
    };

  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function cadastrarEnderecoRapido(dados) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('ENDERECOS');

    if (!sheet) {
      return { sucesso: false, mensagem: 'Aba ENDERECOS não encontrada' };
    }

    const ultimaLinha = sheet.getLastRow();
    const novoId = ultimaLinha > 1 ? sheet.getRange(ultimaLinha, 1).getValue() + 1 : 1;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).toLowerCase() === String(dados.nomeLocal || '').toLowerCase()) {
        return {
          sucesso: false,
          mensagem: 'Local já existe!',
          idExistente: data[i][0]
        };
      }
    }

    sheet.appendRow([
      novoId,
      dados.nomeLocal,
      dados.enderecoCompleto || '',
      dados.linkMaps || '',
      dados.observacoes || '',
      new Date(),
      dados.cidade || '',
      dados.estado || ''
    ]);
    sheet.getRange(sheet.getLastRow(), CADASTROS_MESTRES_INFO_.local.statusCol).setValue('ATIVO');

    return {
      sucesso: true,
      id: novoId,
      nome: dados.nomeLocal,
      mensagem: 'Local cadastrado!'
    };

  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function cadastrarParceiroBVRapido(dados) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('PARCEIROS_BV');

    if (!sheet) {
      return { sucesso: false, mensagem: 'Aba PARCEIROS_BV não encontrada' };
    }

    const ultimaLinha = sheet.getLastRow();
    const novoId = ultimaLinha > 1 ? sheet.getRange(ultimaLinha, 1).getValue() + 1 : 1;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).toLowerCase() === String(dados.nome || '').toLowerCase()) {
        return {
          sucesso: false,
          mensagem: 'Parceiro já existe!',
          idExistente: data[i][0]
        };
      }
    }

    sheet.appendRow([
      novoId,
      dados.nome,
      dados.telefone || '',
      dados.tipo || 'BV',
      new Date()
    ]);
    sheet.getRange(sheet.getLastRow(), CADASTROS_MESTRES_INFO_.parceiro.statusCol).setValue('ATIVO');

    return {
      sucesso: true,
      id: novoId,
      nome: dados.nome,
      mensagem: 'Parceiro cadastrado!'
    };

  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function normalizarCadastroTexto_(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function localizarRegistroPorNome_(sheet, nome) {
  const alvo = normalizarCadastroTexto_(nome);
  if (!alvo) return null;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (normalizarCadastroTexto_(data[i][1]) === alvo) {
      return {
        linha: i + 1,
        id: String(data[i][0] || '').trim(),
        nome: String(data[i][1] || '').trim(),
        raw: data[i]
      };
    }
  }
  return null;
}

function localizarRegistroPorId_(sheet, id) {
  const alvoId = String(id || '').trim();
  if (!alvoId) return null;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === alvoId) {
      return {
        linha: i + 1,
        id: String(data[i][0] || '').trim(),
        nome: String(data[i][1] || '').trim(),
        raw: data[i]
      };
    }
  }
  return null;
}

function regularizarContratante(dados) {
  try {
    const nome = String((dados && dados.nome) || '').trim();
    if (!nome) return { sucesso: false, mensagem: 'Nome do contratante é obrigatório.' };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CONTRATANTES');
    if (!sheet) return { sucesso: false, mensagem: 'Aba CONTRATANTES não encontrada' };

    const existente = localizarRegistroPorNome_(sheet, nome);
    if (existente) {
      return { sucesso: true, id: existente.id, nome: existente.nome, acao: 'vinculado' };
    }

    const criado = cadastrarContratanteRapido({ nome: nome });
    if (!criado || !criado.sucesso) return criado || { sucesso: false, mensagem: 'Falha ao criar contratante.' };
    return { sucesso: true, id: String(criado.id), nome: String(criado.nome || nome), acao: 'criado' };
  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function regularizarLocal(dados) {
  try {
    const nome = String((dados && (dados.nome || dados.nomeLocal)) || '').trim();
    if (!nome) return { sucesso: false, mensagem: 'Nome do local é obrigatório.' };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ENDERECOS');
    if (!sheet) return { sucesso: false, mensagem: 'Aba ENDERECOS não encontrada' };

    const existente = localizarRegistroPorNome_(sheet, nome);
    if (existente) {
      return { sucesso: true, id: existente.id, nome: existente.nome, acao: 'vinculado' };
    }

    const criado = cadastrarEnderecoRapido({ nomeLocal: nome });
    if (!criado || !criado.sucesso) return criado || { sucesso: false, mensagem: 'Falha ao criar local.' };
    return { sucesso: true, id: String(criado.id), nome: String(criado.nome || nome), acao: 'criado' };
  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function atualizarContratante(dados) {
  try {
    const id = String((dados && dados.id) || '').trim();
    if (!id) return { sucesso: false, mensagem: 'ID do contratante é obrigatório.' };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CONTRATANTES');
    if (!sheet) return { sucesso: false, mensagem: 'Aba CONTRATANTES não encontrada' };
    const camposComplementares = garantirCamposComplementaresContratante_(sheet);

    const registro = localizarRegistroPorId_(sheet, id);
    if (!registro) return { sucesso: false, mensagem: 'Contratante não encontrado.' };

    const antes = {
      nome: String(registro.raw[1] || '').trim(),
      telefone: String(registro.raw[2] || '').trim(),
      email: String(registro.raw[3] || '').trim(),
      cpfCnpj: String(registro.raw[4] || '').trim(),
      tipoPessoa: String(registro.raw[camposComplementares.TIPO_PESSOA - 1] || '').trim(),
      enderecoCompleto: String(registro.raw[camposComplementares.ENDERECO_COMPLETO - 1] || '').trim(),
      representanteLegal: String(registro.raw[camposComplementares.REPRESENTANTE_LEGAL - 1] || '').trim()
    };

    const nome = String((dados && dados.nome) || registro.nome || '').trim();
    if (!nome) return { sucesso: false, mensagem: 'Nome do contratante é obrigatório.' };

    sheet.getRange(registro.linha, 2).setValue(nome);
    if (dados.telefone !== undefined) sheet.getRange(registro.linha, 3).setValue(String(dados.telefone || '').trim());
    if (dados.email !== undefined) sheet.getRange(registro.linha, 4).setValue(String(dados.email || '').trim());
    if (dados.cpfCnpj !== undefined) sheet.getRange(registro.linha, 5).setValue(String(dados.cpfCnpj || '').trim());
    if (dados.tipoPessoa !== undefined) sheet.getRange(registro.linha, camposComplementares.TIPO_PESSOA).setValue(normalizarTipoPessoaContratante_(dados.tipoPessoa));
    if (dados.enderecoCompleto !== undefined) sheet.getRange(registro.linha, camposComplementares.ENDERECO_COMPLETO).setValue(String(dados.enderecoCompleto || '').trim());
    if (dados.representanteLegal !== undefined) sheet.getRange(registro.linha, camposComplementares.REPRESENTANTE_LEGAL).setValue(String(dados.representanteLegal || '').trim());
    const depois = {
      nome: nome,
      telefone: dados.telefone !== undefined ? String(dados.telefone || '').trim() : antes.telefone,
      email: dados.email !== undefined ? String(dados.email || '').trim() : antes.email,
      cpfCnpj: dados.cpfCnpj !== undefined ? String(dados.cpfCnpj || '').trim() : antes.cpfCnpj,
      tipoPessoa: dados.tipoPessoa !== undefined ? normalizarTipoPessoaContratante_(dados.tipoPessoa) : antes.tipoPessoa,
      enderecoCompleto: dados.enderecoCompleto !== undefined ? String(dados.enderecoCompleto || '').trim() : antes.enderecoCompleto,
      representanteLegal: dados.representanteLegal !== undefined ? String(dados.representanteLegal || '').trim() : antes.representanteLegal
    };
    const delta = coletarDeltaCadastro_(antes, depois);
    registrarLogCadastroDetalhado_('EDITAR_CADASTRO', 'CONTRATANTES', id, nome, delta, { entidade: 'contratante' });

    return { sucesso: true, id: id, nome: nome, mensagem: 'Contratante atualizado.' };
  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function atualizarEndereco(dados) {
  try {
    const id = String((dados && dados.id) || '').trim();
    if (!id) return { sucesso: false, mensagem: 'ID do local é obrigatório.' };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ENDERECOS');
    if (!sheet) return { sucesso: false, mensagem: 'Aba ENDERECOS não encontrada' };

    const registro = localizarRegistroPorId_(sheet, id);
    if (!registro) return { sucesso: false, mensagem: 'Local não encontrado.' };

    const antes = {
      nome: String(registro.raw[1] || '').trim(),
      enderecoCompleto: String(registro.raw[2] || '').trim(),
      linkMaps: String(registro.raw[3] || '').trim(),
      observacoes: String(registro.raw[4] || '').trim(),
      cidade: String(registro.raw[6] || '').trim(),
      estado: String(registro.raw[7] || '').trim()
    };

    const nome = String((dados && (dados.nome || dados.nomeLocal)) || registro.nome || '').trim();
    if (!nome) return { sucesso: false, mensagem: 'Nome do local é obrigatório.' };

    sheet.getRange(registro.linha, 2).setValue(nome);
    if (dados.enderecoCompleto !== undefined) sheet.getRange(registro.linha, 3).setValue(String(dados.enderecoCompleto || '').trim());
    if (dados.linkMaps !== undefined) sheet.getRange(registro.linha, 4).setValue(String(dados.linkMaps || '').trim());
    if (dados.observacoes !== undefined) sheet.getRange(registro.linha, 5).setValue(String(dados.observacoes || '').trim());
    if (dados.cidade !== undefined) sheet.getRange(registro.linha, 7).setValue(String(dados.cidade || '').trim());
    if (dados.estado !== undefined) sheet.getRange(registro.linha, 8).setValue(String(dados.estado || '').trim());
    const depois = {
      nome: nome,
      enderecoCompleto: dados.enderecoCompleto !== undefined ? String(dados.enderecoCompleto || '').trim() : antes.enderecoCompleto,
      linkMaps: dados.linkMaps !== undefined ? String(dados.linkMaps || '').trim() : antes.linkMaps,
      observacoes: dados.observacoes !== undefined ? String(dados.observacoes || '').trim() : antes.observacoes,
      cidade: dados.cidade !== undefined ? String(dados.cidade || '').trim() : antes.cidade,
      estado: dados.estado !== undefined ? String(dados.estado || '').trim() : antes.estado
    };
    const delta = coletarDeltaCadastro_(antes, depois);
    registrarLogCadastroDetalhado_('EDITAR_CADASTRO', 'ENDERECOS', id, nome, delta, { entidade: 'local' });

    return { sucesso: true, id: id, nome: nome, mensagem: 'Local atualizado.' };
  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function obterContratantePorId(dados) {
  try {
    const id = String((dados && dados.id) || '').trim();
    if (!id) return { sucesso: false, mensagem: 'ID do contratante é obrigatório.' };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CONTRATANTES');
    if (!sheet) return { sucesso: false, mensagem: 'Aba CONTRATANTES não encontrada' };
    const camposComplementares = garantirCamposComplementaresContratante_(sheet);

    const registro = localizarRegistroPorId_(sheet, id);
    if (!registro) return { sucesso: false, mensagem: 'Contratante não encontrado.' };

    const linha = registro.raw || [];
    return {
      sucesso: true,
      contratante: {
        id: registro.id,
        nome: String(linha[1] || '').trim(),
        telefone: String(linha[2] || '').trim(),
        email: String(linha[3] || '').trim(),
        cpfCnpj: String(linha[4] || '').trim(),
        tipoPessoa: String(linha[camposComplementares.TIPO_PESSOA - 1] || '').trim(),
        enderecoCompleto: String(linha[camposComplementares.ENDERECO_COMPLETO - 1] || '').trim(),
        representanteLegal: String(linha[camposComplementares.REPRESENTANTE_LEGAL - 1] || '').trim()
      }
    };
  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function obterEnderecoPorId(dados) {
  try {
    const id = String((dados && dados.id) || '').trim();
    if (!id) return { sucesso: false, mensagem: 'ID do local é obrigatório.' };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ENDERECOS');
    if (!sheet) return { sucesso: false, mensagem: 'Aba ENDERECOS não encontrada' };

    const registro = localizarRegistroPorId_(sheet, id);
    if (!registro) return { sucesso: false, mensagem: 'Local não encontrado.' };

    const linha = registro.raw || [];
    return {
      sucesso: true,
      endereco: {
        id: registro.id,
        nome: String(linha[1] || '').trim(),
        enderecoCompleto: String(linha[2] || '').trim(),
        linkMaps: String(linha[3] || '').trim(),
        observacoes: String(linha[4] || '').trim(),
        cidade: String(linha[6] || '').trim(),
        estado: String(linha[7] || '').trim()
      }
    };
  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function atualizarCerimonialista(dados) {
  try {
    const id = String((dados && dados.id) || '').trim();
    if (!id) return { sucesso: false, mensagem: 'ID do cerimonialista é obrigatório.' };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CERIMONIALISTAS');
    if (!sheet) return { sucesso: false, mensagem: 'Aba CERIMONIALISTAS não encontrada' };

    const registro = localizarRegistroPorId_(sheet, id);
    if (!registro) return { sucesso: false, mensagem: 'Cerimonialista não encontrado.' };

    const antes = {
      nome: String(registro.raw[1] || '').trim(),
      telefone: String(registro.raw[2] || '').trim(),
      empresa: String(registro.raw[3] || '').trim()
    };

    const nome = String((dados && dados.nome) || registro.nome || '').trim();
    if (!nome) return { sucesso: false, mensagem: 'Nome do cerimonialista é obrigatório.' };

    sheet.getRange(registro.linha, 2).setValue(nome);
    if (dados.telefone !== undefined) sheet.getRange(registro.linha, 3).setValue(String(dados.telefone || '').trim());
    if (dados.empresa !== undefined) sheet.getRange(registro.linha, 4).setValue(String(dados.empresa || '').trim());
    const depois = {
      nome: nome,
      telefone: dados.telefone !== undefined ? String(dados.telefone || '').trim() : antes.telefone,
      empresa: dados.empresa !== undefined ? String(dados.empresa || '').trim() : antes.empresa
    };
    const delta = coletarDeltaCadastro_(antes, depois);
    registrarLogCadastroDetalhado_('EDITAR_CADASTRO', 'CERIMONIALISTAS', id, nome, delta, { entidade: 'cerimonialista' });

    return { sucesso: true, id: id, nome: nome, mensagem: 'Cerimonialista atualizado.' };
  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function obterCerimonialistaPorId(dados) {
  try {
    const id = String((dados && dados.id) || '').trim();
    if (!id) return { sucesso: false, mensagem: 'ID do cerimonialista é obrigatório.' };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CERIMONIALISTAS');
    if (!sheet) return { sucesso: false, mensagem: 'Aba CERIMONIALISTAS não encontrada' };

    const registro = localizarRegistroPorId_(sheet, id);
    if (!registro) return { sucesso: false, mensagem: 'Cerimonialista não encontrado.' };

    const linha = registro.raw || [];
    return {
      sucesso: true,
      cerimonialista: {
        id: registro.id,
        nome: String(linha[1] || '').trim(),
        telefone: String(linha[2] || '').trim(),
        empresa: String(linha[3] || '').trim()
      }
    };
  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function atualizarParceiroBV(dados) {
  try {
    const id = String((dados && dados.id) || '').trim();
    if (!id) return { sucesso: false, mensagem: 'ID do parceiro é obrigatório.' };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PARCEIROS_BV');
    if (!sheet) return { sucesso: false, mensagem: 'Aba PARCEIROS_BV não encontrada' };

    const registro = localizarRegistroPorId_(sheet, id);
    if (!registro) return { sucesso: false, mensagem: 'Parceiro não encontrado.' };

    const antes = {
      nome: String(registro.raw[1] || '').trim(),
      telefone: String(registro.raw[2] || '').trim(),
      tipo: String(registro.raw[3] || '').trim()
    };

    const nome = String((dados && dados.nome) || registro.nome || '').trim();
    if (!nome) return { sucesso: false, mensagem: 'Nome do parceiro é obrigatório.' };

    sheet.getRange(registro.linha, 2).setValue(nome);
    if (dados.telefone !== undefined) sheet.getRange(registro.linha, 3).setValue(String(dados.telefone || '').trim());
    if (dados.tipo !== undefined) sheet.getRange(registro.linha, 4).setValue(String(dados.tipo || '').trim() || 'BV');
    const depois = {
      nome: nome,
      telefone: dados.telefone !== undefined ? String(dados.telefone || '').trim() : antes.telefone,
      tipo: dados.tipo !== undefined ? (String(dados.tipo || '').trim() || 'BV') : antes.tipo
    };
    const delta = coletarDeltaCadastro_(antes, depois);
    registrarLogCadastroDetalhado_('EDITAR_CADASTRO', 'PARCEIROS_BV', id, nome, delta, { entidade: 'parceiro' });

    return { sucesso: true, id: id, nome: nome, mensagem: 'Parceiro atualizado.' };
  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}

function obterParceiroBVPorId(dados) {
  try {
    const id = String((dados && dados.id) || '').trim();
    if (!id) return { sucesso: false, mensagem: 'ID do parceiro é obrigatório.' };

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PARCEIROS_BV');
    if (!sheet) return { sucesso: false, mensagem: 'Aba PARCEIROS_BV não encontrada' };

    const registro = localizarRegistroPorId_(sheet, id);
    if (!registro) return { sucesso: false, mensagem: 'Parceiro não encontrado.' };

    const linha = registro.raw || [];
    return {
      sucesso: true,
      parceiro: {
        id: registro.id,
        nome: String(linha[1] || '').trim(),
        telefone: String(linha[2] || '').trim(),
        tipo: String(linha[3] || '').trim()
      }
    };
  } catch (erro) {
    return { sucesso: false, mensagem: 'Erro: ' + erro.message };
  }
}
