// schedules.js – lists available departures based on user search
// This version uses the backend proxy endpoints instead of calling Praxio directly.
// It expects the search parameters to be stored in localStorage under the key
// `searchParams` as an object with `originId`, `destinationId`, `originName`,
// `destinationName` and `date` (YYYY-MM-DD).

document.addEventListener('DOMContentLoaded', () => {
  // Atualiza a navegação do usuário se a função existir
  if (typeof updateUserNav === 'function') {
    updateUserNav();
  }

  const searchParams = JSON.parse(localStorage.getItem('searchParams') || 'null');
  const busList = document.getElementById('bus-list') || document.getElementById('busList');
  const noResults = document.getElementById('no-results') || document.getElementById('noResults');
  const backBtn = document.getElementById('back-btn');

  // Botão voltar para a página inicial
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
  }

  // Se não houver parâmetros de busca, exibe mensagem e sai
  if (!searchParams) {
    if (noResults) {
      noResults.style.display = 'block';
      noResults.textContent = 'Dados de pesquisa ausentes.';
    }
    return;
  }

  // A data selecionada já está em formato ISO (YYYY-MM-DD)
  const dateIso = searchParams.date;

  // Mostra mensagem de carregamento
  if (noResults) {
    noResults.style.display = 'block';
    noResults.textContent = 'Buscando viagens disponíveis...';
  }

  // Chama o backend para obter a lista de partidas
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
      // Esconde a mensagem de carregamento
      if (noResults) noResults.style.display = 'none';
      if (!busList) return;

      busList.innerHTML = '';

      // Normaliza a lista de partidas. A API Praxio pode retornar
      // `ListaPartidas` ou `PartidasXmlRetorno.Linhas.Linha`.
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

      if (!linhas || linhas.length === 0) {
        if (noResults) {
          noResults.style.display = 'block';
          noResults.textContent = 'Nenhuma viagem encontrada para os critérios informados.';
        }
        return;
      }

      // Função auxiliar para formatar horas no formato HH:MM
      function formatHora(h) {
        if (!h) return '';
        if (typeof h !== 'string') return h;
        if (h.includes(':')) return h;
        if (h.length === 4) {
          return h.slice(0, 2) + ':' + h.slice(2);
        }
        return h;
      }

      linhas.forEach((linha) => {
        // Extrai horário de saída
        let horario = linha.HorarioPartida || linha.HoraPartida || '';
        if (!horario && linha.ViagemTFO) {
          horario = linha.ViagemTFO.HorarioPartida || linha.ViagemTFO.HoraPartida || '';
          if (!horario) {
            const dh = linha.ViagemTFO.DataHoraInicio || linha.ViagemTFO.DataHoraEmbarque || '';
            if (dh) {
              const t = dh.split('T')[1];
              if (t) {
                horario = t.substring(0, 5);
              }
            }
          }
        }
        if (!horario && typeof linha.DadosViagem === 'string') {
          const parts = linha.DadosViagem.split(' - ');
          if (parts.length > 0) {
            horario = parts[0].trim();
          }
        }
        horario = formatHora(horario);

        // Extrai horário de chegada
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

        // Extrai duração da viagem
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
        const idTipoVeiculo = linha.IdTipoVeiculo || linha.IdTipoOnibus || 0;

        // Poltronas disponíveis e tipo de serviço
        const disponiveis = linha.PoltronasDisponiveis || (linha.ViagemTFO && linha.ViagemTFO.PoltronasDisponiveis) || '';
        const tipoHorario = linha.TipoHorario || (linha.ViagemTFO && linha.ViagemTFO.TipoHorario) || '';
        const icons = tipoHorario && tipoHorario.toLowerCase().includes('execut') ? '❄️📶♿' : '';

        // Cria o card que contém as informações da viagem e o botão
        const card = document.createElement('div');
        card.className = 'schedule-card';
        card.style.display = 'flex';
        card.style.justifyContent = 'space-between';
        card.style.alignItems = 'center';
        card.style.borderBottom = '1px solid #eee';
        card.style.padding = '10px 0';

        // Contêiner vertical para duas linhas de informações
        const infoContainer = document.createElement('div');
        infoContainer.style.display = 'flex';
        infoContainer.style.flexDirection = 'column';
        infoContainer.style.flex = '1';
        infoContainer.style.gap = '4px';

        // Primeira linha: horário de saída, chegada, tempo e tarifa
        const firstRow = document.createElement('div');
        firstRow.style.display = 'flex';
        firstRow.style.flexWrap = 'wrap';
        firstRow.style.gap = '10px';
        const firstParts = [];
        firstParts.push(`<span><strong>Saída:</strong> ${horario || '00:00'}</span>`);
        firstParts.push(`<span><strong>Chegada:</strong> ${chegada || '--'}</span>`);
        firstParts.push(`<span><strong>Tempo:</strong> ${tempoViagem || '--'}</span>`);
        firstParts.push(`<span><strong>R$ ${isNaN(tarifa) ? '0,00' : tarifa.toFixed(2)}</strong></span>`);
        firstRow.innerHTML = firstParts.join(' ');

        // Segunda linha: poltronas disponíveis e tipo de serviço
        const secondRow = document.createElement('div');
        secondRow.style.display = 'flex';
        secondRow.style.flexWrap = 'wrap';
        secondRow.style.gap = '10px';
        const secondParts = [];
        if (disponiveis) {
          secondParts.push(`<span><strong>Poltronas Disponiveis:</strong> ${disponiveis} 💺</span>`);
        }
        if (tipoHorario || icons) {
          let serviceText = '';
          if (tipoHorario) serviceText += tipoHorario;
          if (icons) serviceText += ` ${icons}`;
          // prefix dash when there are preceding parts
          secondParts.push(`<span>${serviceText}</span>`);
        }
        secondRow.innerHTML = secondParts.join(' ');

        infoContainer.appendChild(firstRow);
        infoContainer.appendChild(secondRow);

        // Botão selecionar
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

        // Monta a estrutura do card
        card.appendChild(infoContainer);
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
