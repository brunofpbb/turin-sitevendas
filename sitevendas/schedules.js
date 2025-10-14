// schedules.js – módulo de lista de partidas
// exporta renderSchedules(container, statusEl, params, onSelect)

export function renderSchedules(container, statusEl, params, onSelect){
  if (!params) {
    if (statusEl){ statusEl.style.display = 'block'; statusEl.textContent = 'Dados de pesquisa ausentes.'; }
    return;
  }
  if (statusEl){ statusEl.style.display = 'block'; statusEl.textContent = 'Buscando viagens disponíveis...'; }

  fetch('/api/partidas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origemId:  params.originId,
      destinoId: params.destinationId,
      data:      params.date
    })
  })
  .then(r => r.json())
  .then(data => {
    if (statusEl) statusEl.style.display = 'none';
    container.innerHTML = '';

    let linhas = [];
    if (data && Array.isArray(data.ListaPartidas)) {
      linhas = data.ListaPartidas;
    } else if (data && data.PartidasXmlRetorno && data.PartidasXmlRetorno.Linhas) {
      const raw = data.PartidasXmlRetorno.Linhas;
      if (Array.isArray(raw)) linhas = raw;
      else if (Array.isArray(raw.Linha)) linhas = raw.Linha;
    }

    if (!linhas || linhas.length === 0) {
      if (statusEl){ statusEl.style.display = 'block'; statusEl.textContent = 'Nenhuma viagem encontrada para os critérios informados.'; }
      return;
    }

    const fmtHora = (h)=>{
      if (!h) return '';
      if (typeof h !== 'string') return h;
      if (h.includes(':')) return h;
      if (h.length === 4) return h.slice(0,2)+':'+h.slice(2);
      return h;
    };

    linhas.forEach(linha=>{
      let saida = linha.HorarioPartida || linha.HoraPartida || '';
      if (!saida && linha.ViagemTFO) {
        saida = linha.ViagemTFO.HorarioPartida || linha.ViagemTFO.HoraPartida ||
                (linha.ViagemTFO.DataHoraInicio || linha.ViagemTFO.DataHoraEmbarque || '').split('T')[1]?.substring(0,5) || '';
      }
      if (!saida && typeof linha.DadosViagem === 'string') {
        const p = linha.DadosViagem.split(' - ');
        if (p.length > 0) saida = p[0].trim();
      }
      saida = fmtHora(saida);

      let chegadaRaw = linha.HorarioChegada || linha.HoraChegada || linha.DtaHoraChegada || '';
      if (!chegadaRaw && linha.ViagemTFO) {
        chegadaRaw = linha.ViagemTFO.DtaHoraChegada || linha.ViagemTFO.DataHoraChegada || '';
      }
      let chegada = '';
      if (chegadaRaw) {
        if (typeof chegadaRaw === 'string' && chegadaRaw.includes('T')) chegada = chegadaRaw.split('T')[1].substring(0,5);
        else chegada = fmtHora(chegadaRaw);
      }

      let tempo = linha.TempoViagem || linha.Duracao || linha.DuracaoViagem || '';
      if (!tempo && linha.ViagemTFO) tempo = linha.ViagemTFO.DuracaoViagem || linha.ViagemTFO.TempoViagem || '';

      const tarifaRaw =
        linha.Tarifa ?? linha.ValorTarifa ?? linha.VlTarifa ?? linha.VlTarifaAnterior ?? linha.ValorMaiorDesconto ?? 0;
      const tarifa = parseFloat(tarifaRaw);

      const idViagem      = linha.IdViagem || linha.CodViagem || 0;
      const idTipoVeiculo = linha.IdTipoVeiculo || linha.TipoVeiculo || linha.IdTipoOnibus || 0;

      const disponiveis =
        linha.PoltronasDisponiveis || (linha.ViagemTFO && linha.ViagemTFO.PoltronasDisponiveis) || '';

      const tipoHorario =
        linha.TipoHorario || (linha.ViagemTFO && linha.ViagemTFO.TipoHorario) || '';

      const icons = tipoHorario && tipoHorario.toLowerCase().includes('execut') ? '❄️🛜🚻' : '';

      // CARD (usa suas classes)
      const card = document.createElement('div');
      card.className = 'schedule-card';

      const header = document.createElement('div');
      header.className = 'schedule-header';
      header.innerHTML = `
        <div><b>Saída:</b> ${saida || '00:00'}</div>
        <div><b>Chegada:</b> ${chegada || '--'}</div>
        <div><b>Tempo:</b> ${tempo || '--'}</div>
        <div><b>R$ ${isNaN(tarifa) ? '0,00' : tarifa.toFixed(2)}</b></div>
      `;

      const body = document.createElement('div');
      body.className = 'schedule-body';
      const parts = [];
      if (disponiveis) parts.push(`<div><b>Poltronas Disponíveis:</b> ${disponiveis} 💺</div>`);
      if (tipoHorario || icons) parts.push(`<div>${tipoHorario || ''} ${icons}</div>`);
      body.innerHTML = parts.join('');

      const actions = document.createElement('div');
      actions.className = 'schedule-actions';
      const btn = document.createElement('button');
      btn.className = 'select-btn';
      btn.textContent = 'Selecionar';
      btn.addEventListener('click', ()=>{
        const schedule = {
          idViagem,
          idTipoVeiculo,
          originId: params.originId,
          destinationId: params.destinationId,
          originName: params.originName,
          destinationName: params.destinationName,
          date: params.date,
          departureTime: saida,
          arrivalTime: chegada,
          travelTime: tempo,
          price: tarifaRaw,
          seatsAvailable: disponiveis || null,
          serviceType: tipoHorario || null
        };
        onSelect && onSelect(schedule);
      });

      actions.appendChild(btn);
      card.appendChild(header);
      card.appendChild(actions);
      card.appendChild(body);

      header.style.gridColumn = '1 / 2';
      actions.style.gridColumn = '2 / 3';
      body.style.gridColumn   = '1 / 2';

      container.appendChild(card);
    });
  })
  .catch(err=>{
    console.error(err);
    if (statusEl){ statusEl.style.display = 'block'; statusEl.textContent = 'Falha ao buscar viagens. Tente novamente mais tarde.'; }
  });
}
