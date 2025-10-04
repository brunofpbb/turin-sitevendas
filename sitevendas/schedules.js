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
        let horario = linha.HorarioPartida || linha.HoraPartida || '';
        // If no explicit departure time, try to parse from DadosViagem (e.g. "07:00 - R$ 28.45 - Linha: 125 ...")
        if (!horario && typeof linha.DadosViagem === 'string') {
          const parts = linha.DadosViagem.split(' - ');
          if (parts.length > 0) {
            horario = parts[0].trim();
          }
        }
        const chegada = linha.HorarioChegada || linha.HoraChegada || '';
        // Tempo de viagem pode vir como TempoViagem ou Duracao (ou DuracaoViagem)
        const tempoViagem = linha.TempoViagem || linha.Duracao || linha.DuracaoViagem || '';
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
        // Apply a flex layout inline to avoid relying on external CSS
        card.style.display = 'flex';
        card.style.justifyContent = 'space-between';
        card.style.alignItems = 'center';
        card.style.borderBottom = '1px solid #eee';
        card.style.padding = '10px 0';

        // Build content row with departure details
        const infoRow = document.createElement('div');
        infoRow.className = 'schedule-info-row';
        infoRow.style.display = 'flex';
        infoRow.style.gap = '10px';
        // Add spans for each field if available
        const spanSaida = document.createElement('span');
        spanSaida.innerHTML = `<strong>Saída:</strong> ${horario || '00:00'}`;
        infoRow.appendChild(spanSaida);
        const spanChegada = document.createElement('span');
        spanChegada.innerHTML = `<strong>Chegada:</strong> ${chegada || '--'}`;
        infoRow.appendChild(spanChegada);
        const spanTempo = document.createElement('span');
        spanTempo.innerHTML = `<strong>Tempo:</strong> ${tempoViagem || '--'}`;
        infoRow.appendChild(spanTempo);
        const spanTarifa = document.createElement('span');
        spanTarifa.innerHTML = `<strong>R$ ${isNaN(tarifa) ? '0,00' : tarifa.toFixed(2)}</strong>`;
        infoRow.appendChild(spanTarifa);

        // Button container
        const btn = document.createElement('button');
        btn.className = 'select-btn';
        btn.textContent = 'Selecionar';

        // When the user clicks "Selecionar", save the selected schedule and go to seats page
        btn.addEventListener('click', () => {
          const schedule = {
            idViagem,
            idTipoVeiculo,
            originId: searchParams.originId,
            destinationId: searchParams.destinationId,
            date: dateIso,
            departureTime: horario,
            arrivalTime: chegada,
            travelTime: tempoViagem,
            price: tarifaRaw,
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
