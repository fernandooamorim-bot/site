(function (global) {
  function toNumber_(value) {
    var n = Number(value);
    return isFinite(n) ? n : NaN;
  }

  function normalizeStatusRecebimento(statusRaw, opts) {
    var options = opts || {};
    var recebido = toNumber_(options.valorRecebido);
    var pendente = toNumber_(options.valorPendente);
    var total = toNumber_(options.valorTotal);

    if (isNaN(pendente) && !isNaN(total) && !isNaN(recebido)) {
      pendente = total - recebido;
    }

    var status = String(statusRaw || '').trim().toUpperCase();

    if (status === 'N/A' || status === 'NA') return 'N/A';
    if (status === 'QUITADO' || status === 'PAGO' || status === 'PROCESSADO') return 'QUITADO';
    if (status === 'PARCIAL') return 'PARCIAL';
    if (status === 'EM_ABERTO' || status === 'ABERTO') return 'EM_ABERTO';

    if (status === 'PENDENTE') {
      if (!isNaN(recebido) && recebido > 0) {
        if (!isNaN(pendente) && pendente > 0) return 'PARCIAL';
        if (!isNaN(total) && recebido < total) return 'PARCIAL';
      }
      return 'EM_ABERTO';
    }

    if (!isNaN(pendente)) {
      if (pendente <= 0) return 'QUITADO';
      if (!isNaN(recebido) && recebido > 0) return 'PARCIAL';
      return 'EM_ABERTO';
    }

    return status || 'EM_ABERTO';
  }

  function labelStatusRecebimento(statusRaw, opts) {
    var normalizado = normalizeStatusRecebimento(statusRaw, opts);
    var detalhado = !!(opts && opts.detailed === true);

    if (detalhado) {
      var detalhados = {
        'EM_ABERTO': 'Em aberto (sem recebimento)',
        'PARCIAL': 'Parcial (recebido em parte)',
        'QUITADO': 'Quitado',
        'N/A': 'Não se aplica'
      };
      return detalhados[normalizado] || normalizado;
    }

    var curtos = {
      'EM_ABERTO': 'Em aberto',
      'PARCIAL': 'Parcial',
      'QUITADO': 'Quitado',
      'N/A': 'Não se aplica'
    };
    return curtos[normalizado] || normalizado;
  }

  function badgeClassStatusRecebimento(statusRaw, opts) {
    var normalizado = normalizeStatusRecebimento(statusRaw, opts);
    if (normalizado === 'QUITADO') return 'status-pago';
    if (normalizado === 'PARCIAL') return 'status-parcial';
    return 'status-pendente';
  }

  global.StatusFormatters = {
    normalizeStatusRecebimento: normalizeStatusRecebimento,
    labelStatusRecebimento: labelStatusRecebimento,
    badgeClassStatusRecebimento: badgeClassStatusRecebimento
  };
})(window);
