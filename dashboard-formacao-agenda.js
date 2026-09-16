(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DashboardFormacaoAgenda = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIA_MS = 24 * 60 * 60 * 1000;
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function numero(valor) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  }

  function dataValida(valor) {
    if (!valor) return null;
    const data = valor instanceof Date ? new Date(valor.getTime()) : new Date(valor);
    if (Number.isNaN(data.getTime())) return null;
    data.setHours(0, 0, 0, 0);
    return data;
  }

  function isoLocal(data) {
    if (!data) return '';
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
  }

  function soma(lista, campo) {
    return lista.reduce((total, item) => total + numero(item[campo]), 0);
  }

  function mediana(valores) {
    const lista = valores.filter(Number.isFinite).sort((a, b) => a - b);
    if (!lista.length) return null;
    const meio = Math.floor(lista.length / 2);
    return lista.length % 2 ? lista[meio] : (lista[meio - 1] + lista[meio]) / 2;
  }

  function media(valores) {
    const lista = valores.filter(Number.isFinite);
    return lista.length ? lista.reduce((total, valor) => total + valor, 0) / lista.length : null;
  }

  function diasEntre(inicio, fim) {
    if (!inicio || !fim) return null;
    const dias = Math.round((fim.getTime() - inicio.getTime()) / DIA_MS);
    return dias >= 0 && dias <= 1461 ? dias : null;
  }

  function adicionarBucket(mapa, chave, label, valor, importado) {
    if (!mapa[chave]) mapa[chave] = { chave, label, eventos: 0, valor: 0, importados: 0, valorImportados: 0 };
    mapa[chave].eventos += 1;
    mapa[chave].valor += numero(valor);
    if (importado) {
      mapa[chave].importados += 1;
      mapa[chave].valorImportados += numero(valor);
    }
  }

  function montarFaixas(lista) {
    const faixas = {
      ate30: { label: 'Até 30 dias', eventos: 0, valor: 0 },
      '1a3': { label: '1 a 3 meses', eventos: 0, valor: 0 },
      '3a6': { label: '3 a 6 meses', eventos: 0, valor: 0 },
      '6a12': { label: '6 a 12 meses', eventos: 0, valor: 0 },
      '12mais': { label: '12+ meses', eventos: 0, valor: 0 }
    };
    lista.forEach((evento) => {
      const meses = numero(evento.antecedenciaDias) / 30.4375;
      const chave = meses <= 1 ? 'ate30' : (meses <= 3 ? '1a3' : (meses <= 6 ? '3a6' : (meses <= 12 ? '6a12' : '12mais')));
      faixas[chave].eventos += 1;
      faixas[chave].valor += evento.valor;
    });
    return Object.values(faixas);
  }

  function montarJanelasMensais(baseConfiavel, futuroConfiavel, agendaFutura, anoFuturo, hoje) {
    return MESES.map((mes, indice) => {
      const mesNumero = indice + 1;
      const historico = baseConfiavel.filter((evento) => evento.dataEvento.getMonth() === indice);
      const atuaisConfiaveis = futuroConfiavel.filter((evento) => evento.dataEvento.getMonth() === indice);
      const atuais = agendaFutura.filter((evento) => evento.dataEvento.getMonth() === indice);
      const importados = atuais.filter((evento) => evento.importado);
      const antecedenciaMedianaDias = mediana(historico.map((evento) => evento.antecedenciaDias));
      const antecedenciaAtualMedianaDias = mediana(atuaisConfiaveis.map((evento) => evento.antecedenciaDias));
      let aberturaTipica = null;
      let status = 'sem-base';
      if (historico.length >= 3 && antecedenciaMedianaDias !== null) {
        aberturaTipica = new Date(anoFuturo, indice, 15);
        aberturaTipica.setDate(aberturaTipica.getDate() - Math.round(antecedenciaMedianaDias));
        const diasAteAbertura = Math.round((aberturaTipica.getTime() - hoje.getTime()) / DIA_MS);
        // Contratos migrados permanecem na carteira, mas não comprovam que a
        // janela comercial atual esteja sendo trabalhada no prazo esperado.
        if (hoje >= aberturaTipica) status = atuaisConfiaveis.length ? 'em-curso' : 'atencao';
        else if (diasAteAbertura <= 45) status = 'proxima';
        else status = 'planejada';
      }
      return {
        mes: mesNumero,
        label: `${mes}/${anoFuturo}`,
        eventosAtuais: atuais.length,
        valorAtual: soma(atuais, 'valor'),
        eventosImportados: importados.length,
        valorImportados: soma(importados, 'valor'),
        amostraAtualConfiavel: atuaisConfiaveis.length,
        antecedenciaAtualMedianaDias,
        amostraHistorica: historico.length,
        antecedenciaMedianaDias,
        aberturaTipica: isoLocal(aberturaTipica),
        status
      };
    });
  }

  function calcular(eventosEntrada, anoBase, agora) {
    const ano = Number(anoBase);
    const anoFuturo = ano + 1;
    const hoje = dataValida(agora) || dataValida(new Date());
    // O corte nunca pode avançar além de hoje. Para a agenda do próximo ano,
    // usa a data atual; para a agenda do ano corrente, continua no mesmo ano.
    const anoCorteAtual = Math.min(hoje.getFullYear(), anoFuturo);
    const corteAtual = new Date(anoCorteAtual, hoje.getMonth(), hoje.getDate());
    const corteHistorico = new Date(anoCorteAtual - 1, hoje.getMonth(), hoje.getDate());

    const eventos = (Array.isArray(eventosEntrada) ? eventosEntrada : []).map((evento) => {
      const dataEvento = dataValida(evento.dataEvento);
      const dataCadastro = dataValida(evento.dataCadastro);
      return {
        dataEvento,
        dataCadastro,
        valor: numero(evento.valor),
        importado: !!evento.importado,
        antecedenciaDias: dataEvento && dataCadastro ? diasEntre(dataCadastro, dataEvento) : null
      };
    }).filter((evento) => evento.dataEvento);

    const baseAno = eventos.filter((evento) => evento.dataEvento.getFullYear() === ano);
    const agendaFutura = eventos.filter((evento) => evento.dataEvento.getFullYear() === anoFuturo);
    const baseComData = baseAno.filter((evento) => evento.dataCadastro);
    const futuroComDataNoCorte = agendaFutura.filter((evento) => evento.dataCadastro && evento.dataCadastro <= corteAtual);
    const baseTemporal = baseAno.filter((evento) => evento.dataCadastro && !evento.importado && evento.antecedenciaDias !== null);
    const futuroTemporal = agendaFutura.filter((evento) => evento.dataCadastro && !evento.importado && evento.dataCadastro <= corteAtual && evento.antecedenciaDias !== null);
    const historicoEquivalente = baseTemporal.filter((evento) => evento.dataCadastro <= corteHistorico);

    const valorBaseTotal = soma(baseAno, 'valor');
    const valorFuturoTotal = soma(agendaFutura, 'valor');
    const valorBaseAmostra = soma(baseComData, 'valor');
    const valorFuturoAmostra = soma(futuroComDataNoCorte, 'valor');
    const valorFuturoComparavel = soma(futuroTemporal, 'valor');
    const valorHistorico = soma(historicoEquivalente, 'valor');
    const coberturaCarteira = valorBaseTotal > 0 ? (valorFuturoTotal / valorBaseTotal) * 100 : null;
    const coberturaAmostraTemporal = valorBaseAmostra > 0 ? (valorFuturoAmostra / valorBaseAmostra) * 100 : null;
    const coberturaNoMesmoCorte = valorBaseTotal > 0 ? (valorHistorico / valorBaseTotal) * 100 : null;
    const deltaHistoricoValor = valorFuturoComparavel - valorHistorico;
    const deltaHistoricoPct = valorHistorico > 0 ? (deltaHistoricoValor / valorHistorico) * 100 : null;
    const faltaParaIgualar = Math.max(valorBaseTotal - valorFuturoTotal, 0);
    const prazoTipicoFuturoDias = mediana(futuroTemporal.map((evento) => evento.antecedenciaDias));
    const prazoTipicoBaseDias = mediana(baseTemporal.map((evento) => evento.antecedenciaDias));
    const prazoMedioFuturoDias = media(futuroTemporal.map((evento) => evento.antecedenciaDias));

    const porMesCadastro = {};
    // A captação por mês só usa datas confiáveis de entrada. Importações são
    // mostradas separadamente, pois a data de migração não é a data de venda.
    futuroTemporal.forEach((evento) => {
      const chave = `${evento.dataCadastro.getFullYear()}-${String(evento.dataCadastro.getMonth() + 1).padStart(2, '0')}`;
      adicionarBucket(porMesCadastro, chave, `${MESES[evento.dataCadastro.getMonth()]}/${evento.dataCadastro.getFullYear()}`, evento.valor, false);
    });
    const captacaoMensal = Object.values(porMesCadastro).sort((a, b) => a.chave.localeCompare(b.chave));
    const rankingCaptacao = [...captacaoMensal].sort((a, b) => b.valor - a.valor || b.eventos - a.eventos).slice(0, 6);

    const corte60 = new Date(corteAtual);
    corte60.setDate(corte60.getDate() - 60);
    const ultimos60 = futuroTemporal.filter((evento) => evento.dataCadastro >= corte60);
    const eventosMigrados = agendaFutura.filter((evento) => evento.importado);
    const importadosFuturo = eventosMigrados.length;
    const semDataCadastroFuturo = agendaFutura.filter((evento) => !evento.dataCadastro).length;
    const semDataCadastroBase = baseAno.filter((evento) => !evento.dataCadastro).length;
    const datasPrazoInvalidasFuturo = agendaFutura.filter((evento) => evento.dataCadastro && evento.antecedenciaDias === null).length;
    const datasPrazoInvalidasBase = baseAno.filter((evento) => evento.dataCadastro && evento.antecedenciaDias === null).length;
    const baseComparavelSuficiente = historicoEquivalente.length >= 3 && valorHistorico > 0;

    let leitura;
    if (!baseComparavelSuficiente) {
      leitura = {
        tipo: 'neutro',
        titulo: 'Comparação histórica indisponível',
        texto: `A agenda de ${anoFuturo} soma ${agendaFutura.length} eventos e ${valorFuturoTotal}. Ainda não há ao menos 3 eventos confiáveis de ${ano} registrados até o mesmo corte do ano anterior para classificar o ritmo.`
      };
    } else if (deltaHistoricoPct < -10) {
      leitura = { tipo: 'atencao', titulo: 'Ritmo abaixo do mesmo estágio', texto: `A agenda de ${anoFuturo} está ${Math.abs(deltaHistoricoPct).toFixed(1)}% abaixo do valor que ${ano} já tinha contratado no mesmo estágio.` };
    } else if (deltaHistoricoPct > 10) {
      leitura = { tipo: 'positivo', titulo: 'Ritmo acima do mesmo estágio', texto: `A agenda de ${anoFuturo} está ${deltaHistoricoPct.toFixed(1)}% acima do valor que ${ano} já tinha contratado no mesmo estágio.` };
    } else {
      leitura = { tipo: 'estavel', titulo: 'Ritmo próximo do mesmo estágio', texto: `A agenda de ${anoFuturo} está dentro de uma faixa de 10% do valor que ${ano} tinha contratado no mesmo estágio.` };
    }

    return {
      anoBase: ano,
      anoFuturo,
      geradoEm: Date.now(),
      corteAtual: isoLocal(corteAtual),
      corteHistorico: isoLocal(corteHistorico),
      resumo: {
        eventosFuturos: agendaFutura.length,
        valorFuturo: valorFuturoTotal,
        valorFuturoComparavel,
        valorFuturoAmostra,
        ticketMedio: agendaFutura.length ? valorFuturoTotal / agendaFutura.length : 0,
        eventosBase: baseAno.length,
        valorBaseTotal,
        valorBaseAmostra,
        coberturaCarteira,
        coberturaAmostraTemporal,
        coberturaNoMesmoCorte,
        faltaParaIgualar,
        eventosHistorico: historicoEquivalente.length,
        valorHistorico,
        deltaHistoricoValor,
        deltaHistoricoPct,
        baseComparavelSuficiente,
        prazoTipicoFuturoDias,
        prazoTipicoBaseDias,
        prazoMedioFuturoDias,
        eventosUltimos60: ultimos60.length,
        valorUltimos60: soma(ultimos60, 'valor'),
        eventosMigrados: eventosMigrados.length,
        valorMigrados: soma(eventosMigrados, 'valor')
      },
      qualidade: {
        eventosFuturos: agendaFutura.length,
        eventosFuturosConfiaveis: futuroTemporal.length,
        importadosFuturo,
        semDataCadastroFuturo,
        datasPrazoInvalidasFuturo,
        eventosBase: baseAno.length,
        eventosBaseConfiaveis: baseTemporal.length,
        semDataCadastroBase,
        datasPrazoInvalidasBase
      },
      captacaoMensal,
      rankingCaptacao,
      faixasFuturo: montarFaixas(futuroTemporal),
      faixasBase: montarFaixas(baseTemporal),
      janelasMensais: montarJanelasMensais(baseTemporal, futuroTemporal, agendaFutura, anoFuturo, hoje),
      leitura
    };
  }

  return { calcular };
});
