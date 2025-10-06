// schedules.js – lists available departures based on user search
// Usa os endpoints do backend proxy (/api/partidas) e mostra as viagens em "cards".

document.addEventListener('DOMContentLoaded', () => {
  if (typeof updateUserNav === 'function') updateUserNav();

  const searchParams = JSON.parse(localStorage.getItem('searchParams') || 'null');
  const busList = document.getElementById('bus-list') || document.getElementById('busList');
  const noResults = document.getElementById('no-results') || document.getElementById('noResults');
  const backBtn = document.getElementById('back-btn');

  if (backBtn) backBtn.addEventListener('click', () => (window.location.href = 'index.html'));

  if (!searchParams) {
    if (noResults) {
      noResults.style.display = 'block';
      noResults.textContent = 'Dados de pesquisa ausentes.';
    }
    return;
  }

  const dateIso = searchParams.date;

  if (noResults) {
    noResults.style.display = 'block';
    noResults.textContent = 'Buscando viagens disponíveis...';
  }

  fetch('/api/partidas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origemId: searchParams.originId,
      destinoId: searchParams.destinationId,
      data: dateIso,
    }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (noResults) noResults.style.display = 'none';
      if (!busList) return;

      busList.innerHTML = '';

      // Normalização do retorno
      let linhas = [];
      if (data && Array.isArray(data.ListaPartidas)) {
        linhas = data.ListaPartidas;
      } else if (data && data.PartidasXmlRetorno && data.PartidasXmlRetorno.Linhas) {
        const raw = data.PartidasXmlRetorno.Linhas;
        if (Array.isArray(raw)) linhas = raw;
        else if (Array.isArray(raw.Linha)) linhas = raw.Linha;
      }

      if (!linhas || linhas.length === 0) {
        if (noResults) {
          noResults.style.display = 'block';
          noResults.textContent = 'Nenhuma viagem encontrada para os critérios informados.';
        }
        return;
      }

      // Auxiliar: HH:MM
      function formatHora(h) {
        if (!h) return '';
        if (typeof h !== 'string') return h;
        if (h.includes(':')) return h;
        if (h.length === 4) return h.slice(0, 2) + ':' + h.slice(2);
        return h;
      }

      linhas.forEach((linha) => {
        // Saída
        let horario = linha.HorarioPartida || linha.HoraPartida || '';
        if (!horario && linha.ViagemTFO) {
          horario =
            linha.ViagemTFO.HorarioPartida ||
            linha.ViagemTFO.HoraPartida ||
            (linha.ViagemTFO.DataHoraInicio || linha.ViagemTFO.DataHoraEmbarque || '')
              .split('T')[1]?.substring(0, 5) ||
            '';
        }
        if (!horario && typeof linha.DadosViagem === 'string') {
          const parts = linha.DadosViagem.split(' - ');
          if (parts.length > 0) horario = parts[0].trim();
        }
        horario = formatHora(horario);

        // Chegada
        let chegadaRaw = linha.HorarioChegada || linha.HoraChegada || linha.DtaHoraChegada || '';
        if (!chegadaRaw && linha.ViagemTFO) {
          chegadaRaw = linha.ViagemTFO.DtaHoraChegada || linha.ViagemTFO.DataHoraChegada || '';
        }
        let chegada = '';
        if (chegadaRaw) {
          if (typeof chegadaRaw === 'string' && chegadaRaw.includes('T')) {
            chegada = chegadaRaw.split('T')[1].substring(0, 5);
          } else {
            chegada = formatHora(chegadaRaw);
          }
        }

        // Duração
        let tempoViagem = linha.TempoViagem || linha.Duracao || linha.DuracaoViagem || '';
        if (!tempoViagem && linha.ViagemTFO) {
          tempoViagem = linha.ViagemTFO.DuracaoViagem || linha.ViagemTFO.TempoViagem || '';
        }

        // Tarifa
        const tarifaRaw =
          linha.Tarifa ??
          linha.ValorTarifa ??
          linha.VlTarifa ??
          linha.VlTarifaAnterior ??
          linha.ValorMaiorDesconto ??
          0;
        const tarifa = parseFloat(tarifaRaw);

        const idViagem = linha.IdViagem || linha.CodViagem || 0;
        const idTipoVeiculo = linha.IdTipoVeiculo || linha.TipoVeiculo || linha.IdTipoOnibus || 0;

        const disponiveis =
          linha.PoltronasDisponiveis ||
          (linha.ViagemTFO && linha.ViagemTFO.PoltronasDisponiveis) ||
          '';

        const tipoHorario =
          linha.TipoHorario || (linha.ViagemTFO && linha.ViagemTFO.TipoHorario) || '';

        const icons =
          tipoHorario && tipoHorario.toLowerCase().includes('execut') ? '❄️📶♿' : '';

        // ---------- CARD ----------
        const card = document.createElement('div');
        card.className = 'schedule-card';
        

        // header (horários, tempo e preço)
        const header = document.createElement('div');
        header.className = 'schedule-header';
        header.innerHTML = `
          <div><b>Saída:</b> ${horario || '00:00'}</div>
          <div><b>Chegada:</b> ${chegada || '--'}</div>
          <div><b>Tempo:</b> ${tempoViagem || '--'}</div>
          <div><b>R$ ${isNaN(tarifa) ? '0,00' : tarifa.toFixed(2)}</b></div>
        `;

        // body (poltronas e serviço)
        const body = document.createElement('div');
        body.className = 'schedule-body';
        const parts = [];
        if (disponiveis) parts.push(`<div><b>Poltronas Disponíveis:</b> ${disponiveis} 💺</div>`);
        if (tipoHorario || icons) {
          let serviceText = tipoHorario || '';
          if (icons) serviceText += ` ${icons}`;
          parts.push(`<div>${serviceText}</div>`);
        }
        body.innerHTML = parts.join('');

        // ações (botão)
        const actions = document.createElement('div');
        actions.className = 'schedule-actions';
        actions.style.gridRow = '1 / -1'; 
        const btn = document.createElement('button');
        btn.className = 'select-btn';
        btn.textContent = 'Selecionar';
        btn.addEventListener('click', () => {
          const schedule = {
            idViagem,
            idTipoVeiculo,
            originId: searchParams.originId,
            destinationId: searchParams.destinationId,
            originName: searchParams.originName,
            destinationName: searchParams.destinationName,
            date: dateIso,
            departureTime: horario,
            arrivalTime: chegada,
            travelTime: tempoViagem,
            price: tarifaRaw,
            seatsAvailable: disponiveis || null,
            serviceType: tipoHorario || null,
          };
          localStorage.setItem('selectedSchedule', JSON.stringify(schedule));
          window.location.href = 'seats.html';
        });

        actions.appendChild(btn);

        // monta card (grid: info ocupa 1fr e ações fica à direita)
        card.appendChild(header);
        card.appendChild(actions);
        card.appendChild(body);

        // ajusta ordem visual: header (linha 1), ações (linha 1 col2), body (linha 2 col1)
        header.style.gridColumn = '1 / 2';
        actions.style.gridColumn = '2 / 3';
        body.style.gridColumn = '1 / 2';

        busList.appendChild(card);
      });
    })
    .catch((err) => {
      console.error(err);
      if (noResults) {
        noResults.style.display = 'block';
        noResults.textContent = 'Falha ao buscar viagens. Tente novamente mais tarde.';
      }
    });
});
