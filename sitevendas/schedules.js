// schedules.js – lists available departures based on user search
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
      data: dateIso
    })
  })
    .then((res) => res.json())
    .then((data) => {
      console.log('API /api/partidas response:', data);
      if (noResults) noResults.style.display = 'none';
      if (!busList) return;

      busList.innerHTML = '';

      let linhas = [];
      if (data && Array.isArray(data.ListaPartidas)) {
        linhas = data.ListaPartidas;
      } else if (data && data.PartidasXmlRetorno && data.PartidasXmlRetorno.Linhas) {
        const raw = data.PartidasXmlRetorno.Linhas;
        if (Array.isArray(raw)) linhas = raw;
        else if (Array.isArray(raw.Linha)) linhas = raw.Linha;
      }

      console.log('Parsed linhas:', linhas);

      if (!linhas || linhas.length === 0) {
        if (noResults) {
          noResults.style.display = 'block';
          noResults.textContent = 'Nenhuma viagem encontrada para os critérios informados.';
        }
        return;
      }

      function formatHora(h) {
        if (!h) return '';
        if (typeof h !== 'string') return h;
        if (h.includes(':')) return h;
        if (h.length === 4) return h.slice(0, 2) + ':' + h.slice(2);
        return h;
      }

      linhas.forEach((linha) => {
        let horario = linha.HorarioPartida || linha.HoraPartida || '';
        if (!horario && linha.ViagemTFO) {
          horario = linha.ViagemTFO.HorarioPartida || linha.ViagemTFO.HoraPartida || '';
          if (!horario) {
            const dh = linha.ViagemTFO.DataHoraInicio || linha.ViagemTFO.DataHoraEmbarque || '';
            if (dh) {
              const t = dh.split('T')[1];
              if (t) horario = t.substring(0, 5);
            }
          }
        }
        if (!horario && typeof linha.DadosViagem === 'string') {
          const parts = linha.DadosViagem.split(' - ');
          if (parts.length > 0) horario = parts[0].trim();
        }
        horario = formatHora(horario);

        let chegadaRaw = linha.HorarioChegada || linha.HoraChegada || '';
        if (!chegadaRaw && linha.DtaHoraChegada) chegadaRaw = linha.DtaHoraChegada;
        if (!chegadaRaw && linha.ViagemTFO) {
          chegadaRaw = linha.ViagemTFO.DtaHoraChegada || linha.ViagemTFO.DataHoraChegada || '';
        }
        let chegada = '';
        if (chegadaRaw) {
          if (typeof chegadaRaw === 'string' && chegadaRaw.includes('T')) {
            const t = chegadaRaw.split('T')[1];
            chegada = t.substring(0, 5);
          } else {
            chegada = formatHora(chegadaRaw);
          }
        }

        let tempoViagem = linha.TempoViagem || linha.Duracao || linha.DuracaoViagem || '';
        if (!tempoViagem && linha.ViagemTFO) {
          tempoViagem = linha.ViagemTFO.DuracaoViagem || linha.ViagemTFO.TempoViagem || '';
        }

        const tarifaRaw =
          linha.Tarifa ??
          linha.ValorTarifa ??
          linha.VlTarifa ??
          linha.VlTarifaAnterior ??
          linha.ValorMaiorDesconto ??
          0;
        const tarifa = parseFloat(tarifaRaw);

        const idViagem = linha.IdViagem || linha.CodViagem || 0;
        const idTipoVeiculo =
          linha.IdTipoVeiculo || (linha.ViagemTFO && linha.ViagemTFO.TipoVeiculo) || linha.TipoVeiculo || 0;

        const disponiveis =
          linha.PoltronasDisponiveis || (linha.ViagemTFO && linha.ViagemTFO.PoltronasDisponiveis) || '';

        const tipoHorario =
          linha.TipoHorario || (linha.ViagemTFO && linha.ViagemTFO.TipoHorario) || '';

        const icons = tipoHorario && tipoHorario.toLowerCase().includes('execut') ? '❄️📶♿' : '';

        // === CARD ===
        const card = document.createElement('div');
        card.className = 'schedule-card';

        const left = document.createElement('div');
        left.className = 'schedule-left';

        // Primeira linha (Saída, Chegada, Tempo, Preço)
        const line1 = document.createElement('div');
        line1.className = 'schedule-line';
        line1.innerHTML = [
          `<span><strong>Saída:</strong> ${horario || '00:00'}</span>`,
          `<span><strong>Chegada:</strong> ${chegada || '--'}</span>`,
          `<span><strong>Tempo:</strong> ${tempoViagem || '--'}</span>`,
          `<span><strong>R$ ${isNaN(tarifa) ? '0,00' : tarifa.toFixed(2)}</strong></span>`
        ].join('  ');

        // Segunda linha (Poltronas disponíveis + tipo/ícones)
        const line2 = document.createElement('div');
        line2.className = 'schedule-line';
        const parts2 = [];
        if (disponiveis) {
          parts2.push(`<span><strong>Poltronas disponíveis:</strong> ${disponiveis} 💺</span>`);
        }
        if (tipoHorario || icons) {
          let serviceText = '';
          if (tipoHorario) serviceText += tipoHorario;
          if (icons) serviceText += ` ${icons}`;
          parts2.push(`<span>${serviceText}</span>`);
        }
        line2.innerHTML = parts2.join(' — ');

        left.appendChild(line1);
        left.appendChild(line2);

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
            serviceType: tipoHorario || null
          };
          localStorage.setItem('selectedSchedule', JSON.stringify(schedule));
          window.location.href = 'seats.html';
        });

        card.appendChild(left);
        card.appendChild(btn);
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
