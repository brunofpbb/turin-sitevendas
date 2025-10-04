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
      let linhas = [];
      if (data && data.PartidasXmlRetorno && data.PartidasXmlRetorno.Linhas) {
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
        const horario = linha.HorarioPartida || linha.HoraPartida || '00:00';
        const chegada = linha.HorarioChegada || linha.HoraChegada || '';
        const tempoViagem = linha.TempoViagem || '';
        const tarifa = linha.Tarifa || linha.ValorTarifa || 0;
        const idViagem = linha.IdViagem || linha.CodViagem || 0;
        const idTipoVeiculo = linha.IdTipoVeiculo || linha.IdTipoOnibus || 0;

        const card = document.createElement('div');
        card.className = 'schedule-card';
        card.innerHTML = `
          <div class="schedule-info">
            <p><strong>Saída:</strong> ${horario}</p>
            <p><strong>Chegada:</strong> ${chegada}</p>
            <p><strong>Tempo de viagem:</strong> ${tempoViagem}</p>
          </div>
          <div class="schedule-price">
            <p><strong>R$ ${parseFloat(tarifa).toFixed(2)}</strong></p>
            <button class="select-btn">Selecionar</button>
          </div>
        `;

        // When the user clicks "Selecionar", save the selected schedule and go to seats page
        card.querySelector('.select-btn').addEventListener('click', () => {
          const schedule = {
            idViagem,
            idTipoVeiculo,
            originId: searchParams.originId,
            destinationId: searchParams.destinationId,
            date: dateIso,
            departureTime: horario,
            arrivalTime: chegada,
            travelTime: tempoViagem,
            price: tarifa,
          };
          localStorage.setItem('selectedSchedule', JSON.stringify(schedule));
          window.location.href = 'seats.html';
        });

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
