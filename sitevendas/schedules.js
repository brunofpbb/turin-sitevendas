// schedules.js – lists available departures based on user search
// This file has been updated to use the backend proxy endpoints instead of
// calling Praxio directly. It expects the search parameters to be stored
// in localStorage under the key `searchParams` as an object with
// `originId`, `destinationId` and `date` (YYYY-MM-DD).

document.addEventListener('DOMContentLoaded', () => {
  // Attempt to update the navigation bar if the function exists
  if (typeof updateUserNav === 'function') {
    updateUserNav();
  }

  const searchParams = JSON.parse(localStorage.getItem('searchParams') || 'null');
  const busList = document.getElementById('bus-list') || document.getElementById('busList');
  const noResults = document.getElementById('no-results') || document.getElementById('noResults');
  const backBtn = document.getElementById('back-btn');

  // Return to the previous page when clicking back
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  }

  // If search parameters are missing, show a message and stop
  if (!searchParams) {
    if (noResults) {
      noResults.style.display = 'block';
      noResults.textContent = 'Dados de pesquisa ausentes.';
    }
    return;
  }

  // Convert the selected date to ISO format accepted by the API
  const dateIso = searchParams.date;

  // Show a loading message while fetching schedules
  if (noResults) {
    noResults.style.display = 'block';
    noResults.textContent = 'Buscando viagens disponíveis...';
  }

  // Fetch the list of departures from our backend
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
      // Log the raw response from the backend for debugging
      console.log('API /api/partidas response:', data);

      if (noResults) noResults.style.display = 'none';
      if (!busList) return;

      // Clear previous results
      busList.innerHTML = '';

      // The Praxio API returns the departures under a nested object. Depending
      // on the version, it may return `PartidasXmlRetorno.Linhas` or
      // `PartidasXmlRetorno.Linhas.Linha`. We'll normalise to an array.
      // Prepare list of departures. The Praxio API may return
      // either an array under `ListaPartidas` or under
      // `PartidasXmlRetorno.Linhas.Linha`.
      let linhas = [];
      if (data && Array.isArray(data.ListaPartidas)) {
        linhas = data.ListaPartidas;
      } else if (data && data.PartidasXmlRetorno && data.PartidasXmlRetorno.Linhas) {
        const raw = data.PartidasXmlRetorno.Linhas;
        if (Array.isArray(raw)) {
          linhas = raw;
        } else if (Array.isArray(raw.Linha)) {
          linhas = raw.Linha;
        }
      }

      // Log the parsed list of departures for debugging
      console.log('Parsed linhas:', linhas);

      if (!linhas || linhas.length === 0) {
        if (noResults) {
          noResults.style.display = 'block';
          noResults.textContent = 'Nenhuma viagem encontrada para os critérios informados.';
        }
        return;
      }

      // Build a card for each departure
      linhas.forEach((linha) => {
        // Extract useful fields with fallbacks. The exact property names may
        // differ depending on API version, so we guard against undefined.
        // Helper to format times like "0700" into "07:00"
        function formatHora(h) {
          if (!h) return '';
          if (typeof h !== 'string') return h;
          if (h.includes(':')) return h;
          // If string length is 4 (e.g. "0700"), insert colon
          if (h.length === 4) {
            return h.slice(0, 2) + ':' + h.slice(2);
          }
          return h;
        }
        // Extract departure time (Saída). Try multiple properties and parse as needed.
        let horario = linha.HorarioPartida || linha.HoraPartida || '';
        if (!horario && linha.ViagemTFO) {
          horario = linha.ViagemTFO.HorarioPartida || linha.ViagemTFO.HoraPartida || '';
          if (!horario) {
            // Try DataHoraInicio or DataHoraEmbarque (format: YYYY-MM-DDTHH:MM)
            const dh = linha.ViagemTFO.DataHoraInicio || linha.ViagemTFO.DataHoraEmbarque || '';
            if (dh) {
              const t = dh.split('T')[1];
              if (t) {
                horario = t.substring(0, 5);
              }
            }
          }
        }
        // Fallback: parse from DadosViagem (e.g. "07:00 - R$ 28.45 - Linha: ...")
        if (!horario && typeof linha.DadosViagem === 'string') {
          const parts = linha.DadosViagem.split(' - ');
          if (parts.length > 0) {
            horario = parts[0].trim();
          }
        }
        horario = formatHora(horario);
        // Extract arrival time (Chegada). Try multiple properties and parse dateTime if needed.
        let chegadaRaw = linha.HorarioChegada || linha.HoraChegada || '';
        if (!chegadaRaw && linha.DtaHoraChegada) {
          chegadaRaw = linha.DtaHoraChegada;
        }
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
        // Extract travel duration (Tempo de viagem). Try multiple properties.
        let tempoViagem = linha.TempoViagem || linha.Duracao || linha.DuracaoViagem || '';
        if (!tempoViagem && linha.ViagemTFO) {
          tempoViagem = linha.ViagemTFO.DuracaoViagem || linha.ViagemTFO.TempoViagem || '';
        }
        // Tarifa pode vir em várias propriedades; tenta ValorTarifa, Tarifa, VlTarifa, ValorMaiorDesconto
        const tarifaRaw =
          linha.Tarifa ??
          linha.ValorTarifa ??
          linha.VlTarifa ??
          linha.VlTarifaAnterior ??
          linha.ValorMaiorDesconto ??
          0;
        const tarifa = parseFloat(tarifaRaw);
        const idViagem = linha.IdViagem || linha.CodViagem || 0;
        const idTipoVeiculo = linha.IdTipoVeiculo || linha.IdTipoOnibus || 0;

        // Create card element and apply horizontal layout styles
        const card = document.createElement('div');
        card.className = 'schedule-card';
        card.style.display = 'flex';
        card.style.justifyContent = 'space-between';
        card.style.alignItems = 'center';
        card.style.borderBottom = '1px solid #eee';
        card.style.padding = '10px 0';

        // Extract available seats and service type for display
        const disponiveis = linha.PoltronasDisponiveis || (linha.ViagemTFO && linha.ViagemTFO.PoltronasDisponiveis) || '';
        const tipoHorario = linha.TipoHorario || (linha.ViagemTFO && linha.ViagemTFO.TipoHorario) || '';
        // Determine icons: use generic icons for executivo services (AC, WiFi, acessibilidade)
        const icons = tipoHorario && tipoHorario.toLowerCase().includes('execut') ? '❄️📶♿' : '';

        // Build a single-row info line with all details, including poltronas disponiveis
        const infoRow = document.createElement('div');
        infoRow.style.display = 'flex';
        infoRow.style.gap = '10px';
        // Build line parts
        const parts = [];
        parts.push(`<span><strong>Saída:</strong> ${horario || '00:00'}</span>`);
        parts.push(`<span><strong>Chegada:</strong> ${chegada || '--'}</span>`);
        parts.push(`<span><strong>Tempo:</strong> ${tempoViagem || '--'}</span>`);
        parts.push(`<span><strong>R$ ${isNaN(tarifa) ? '0,00' : tarifa.toFixed(2)}</strong></span>`);
        if (disponiveis) {
          parts.push(`<span><strong>Poltronas Disponiveis:</strong> ${disponiveis} 💺</span>`);
        }
        if (tipoHorario || icons) {
          let serviceText = '';
          if (tipoHorario) serviceText += tipoHorario;
          if (icons) serviceText += ` ${icons}`;
          parts.push(`<span>— ${serviceText}</span>`);
        }
        infoRow.innerHTML = parts.join(' ');

        // Create select button
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

        // Append info row and button to card
        card.appendChild(infoRow);
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
