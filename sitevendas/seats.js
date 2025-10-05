// seats.js - exibe mapa de assentos e permite seleção
// Consulta o mapa de assentos via backend (/api/poltronas) para evitar CORS
// e manter credenciais fora do frontend.

document.addEventListener('DOMContentLoaded', () => {
  updateUserNav?.();

  const schedule = JSON.parse(localStorage.getItem('selectedSchedule') || 'null');
  const user = JSON.parse(localStorage.getItem('user') || 'null');

  const tripInfo = document.getElementById('trip-info');
  const seatMap = document.getElementById('seat-map');
  const selectedSeatP = document.getElementById('selected-seat');
  const confirmBtn = document.getElementById('confirm-seat');
  const backBtn = document.getElementById('back-btn');
  const passengerContainer = document.getElementById('passenger-container');

  // Cria/obtém contêiner da legenda (abaixo do mapa)
  let seatLegend = document.getElementById('seat-legend');
  if (!seatLegend) {
    seatLegend = document.createElement('div');
    seatLegend.id = 'seat-legend';
    seatLegend.style.marginTop = '12px';
    seatLegend.style.display = 'flex';
    seatLegend.style.flexWrap = 'wrap';
    seatLegend.style.gap = '12px';
    // Insere a legenda logo após o mapa
    if (seatMap && seatMap.parentNode) {
      seatMap.parentNode.appendChild(seatLegend);
    }
  }

  const maxSelected = 6;
  let selectedSeats = [];

  if (!schedule) {
    if (tripInfo) tripInfo.textContent = 'Nenhuma viagem selecionada.';
    if (confirmBtn) confirmBtn.disabled = true;
    return;
  }

  // ===== Cabeçalho da viagem (melhor apresentação) =====
  if (tripInfo) {
    const origin = schedule.originName || schedule.origin || 'Origem';
    const dest = schedule.destinationName || schedule.destination || 'Destino';
    const dateStr = formatDateBR(schedule.date); // YYYY-MM-DD -> DD/MM/YYYY
    const timeStr = schedule.departureTime || '--:--';
    // Layout em duas linhas: rota e detalhes
    tripInfo.innerHTML = `
      <div style="font-size:1.05rem;font-weight:600;margin-bottom:4px;">
        ${origin} → ${dest}
      </div>
      <div style="color:#555;">
        Saída: <strong>${timeStr}</strong> • Data: <strong>${dateStr}</strong>${schedule.serviceType ? ` • ${schedule.serviceType}` : ''}
      </div>
    `;
  }

  function formatDateBR(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    if (!y || !m || !d) return iso;
    return `${d}/${m}/${y}`;
  }

  /**
   * Garante que o mapa de assentos está carregado em schedule.seats.
   * Caso ainda não exista, faz uma requisição ao backend (/api/poltronas).
   */
  async function ensureSeatMap() {
    if (schedule.seats && Array.isArray(schedule.seats) && schedule.seats.length > 0) {
      // Garante regra das poltronas 1 e 2 indisponíveis, mesmo com cache
      forceBlockFrontSeats(schedule.seats);
      return;
    }
    try {
      const payload = {
        idViagem: schedule.idViagem,
        idTipoVeiculo: schedule.idTipoVeiculo,
        idLocOrigem: schedule.originId,
        idLocDestino: schedule.destinationId
      };

      console.log('[Poltronas] payload enviado:', payload);

      const response = await fetch('/api/poltronas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error('Falha ao obter poltronas');

      const data = await response.json();
      console.log('[Poltronas] resposta da API:', data);

      // Normaliza retorno
      let poltronas = [];
      if (data && data.PoltronaXmlRetorno) {
        const pol = data.PoltronaXmlRetorno;
        if (Array.isArray(pol)) {
          poltronas = pol;
        } else if (Array.isArray(pol.Poltrona)) {
          poltronas = pol.Poltrona;
        } else {
          poltronas = [pol];
        }
      } else if (data && data.LaypoltronaXml && Array.isArray(data.LaypoltronaXml.PoltronaXmlRetorno)) {
        poltronas = data.LaypoltronaXml.PoltronaXmlRetorno;
      }

      if (poltronas && poltronas.length > 0) {
        schedule.seats = poltronas
          .map((p) => {
            // Caption (número exibido), Situacao (status), poltronas inexistentes = 3 não devem aparecer
            const situacao = parseInt(p.Situacao ?? p.situacao ?? 0, 10);
            if (situacao === 3) return null; // não exibir
            const number = parseInt(
              (p.Caption ?? p.caption ?? p.Numero ?? p.NumeroPoltrona ?? p.Poltrona ?? '').toString(),
              10
            );
            if (!Number.isFinite(number)) return null;
            return {
              number,
              occupied: situacao !== 0 // qualquer situação diferente de 0 consideramos indisponível
            };
          })
          .filter(Boolean);

        // Regras locais: poltronas 1 e 2 sempre indisponíveis
        forceBlockFrontSeats(schedule.seats);
      } else {
        // Fallback
        schedule.seats = generateSeatMapFallback();
      }
    } catch (err) {
      console.error('Erro ao carregar mapa de poltronas:', err);
      schedule.seats = generateSeatMapFallback();
    }
  }

  function forceBlockFrontSeats(seatsArray) {
    const toBlock = new Set([1, 2]);
    seatsArray.forEach((s) => {
      if (toBlock.has(s.number)) s.occupied = true;
    });
  }

  /**
   * Gera um mapa de poltronas estático como fallback.
   * Padrão 2x10 em cima, corredor, 2x11 embaixo.
   */
  function generateSeatMapFallback() {
    const pattern = [
      [3, 7, 11, 15, 19, 23, 27, 31, 35, 39],
      [4, 8, 12, 16, 20, 24, 28, 32, 36, 40],
      [2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42],
      [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41]
    ];
    const seats = [];
    pattern.forEach((row) => {
      row.forEach((num) => {
        const occupied = num === 1 || num === 2 || Math.random() < 0.2;
        seats.push({ number: num, occupied });
      });
    });
    return seats;
  }

  /**
   * Renderiza o mapa de assentos na grade horizontal do ônibus.
   */
  async function renderSeatGrid() {
    await ensureSeatMap();
    if (!seatMap) return;

    seatMap.innerHTML = '';

    const rows = [
      [3, 7, 11, 15, 19, 23, 27, 31, 35, 39, null],
      [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, null],
      [null, null, null, null, null, null, null, null, null, null, null],
      [2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42],
      [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41]
    ];

    rows.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        const rowPos = rowIndex + 1;
        const colPos = colIndex + 1;
        if (cell === null) {
          const walkwayDiv = document.createElement('div');
          walkwayDiv.className = 'walkway';
          walkwayDiv.style.gridRowStart = rowPos;
          walkwayDiv.style.gridColumnStart = colPos;
          seatMap.appendChild(walkwayDiv);
        } else {
          const seatData = schedule.seats?.find((s) => s.number === cell);
          const seatDiv = document.createElement('div');
          seatDiv.className = 'seat';
          seatDiv.textContent = cell;
          seatDiv.style.gridRowStart = rowPos;
          seatDiv.style.gridColumnStart = colPos;

          if (seatData && seatData.occupied) {
            seatDiv.classList.add('occupied');
          }
          if (selectedSeats.includes(cell)) {
            seatDiv.classList.add('selected');
          }

          seatDiv.addEventListener('click', () => {
            if (seatData && seatData.occupied) return; // bloqueia clique
            const idx = selectedSeats.indexOf(cell);
            if (idx !== -1) {
              selectedSeats.splice(idx, 1);
              updatePassengerForms();
              renderSeatGrid();
              return;
            }
            if (selectedSeats.length >= maxSelected) {
              alert(`É possível selecionar no máximo ${maxSelected} poltronas por compra.`);
              return;
            }
            selectedSeats.push(cell);
            updatePassengerForms();
            renderSeatGrid();
          });

          seatMap.appendChild(seatDiv);
        }
      });
    });

    // Atualiza a legenda sempre após renderizar (cores do layout atual)
    renderLegend();
  }

  function renderLegend() {
    if (!seatLegend) return;
    seatLegend.innerHTML = '';

    const items = [
      { label: 'Disponível', bg: '#e8f5e9', border: '#bbb', text: '#333' },
      { label: 'Selecionada', bg: '#007a3b', border: '#007a3b', text: '#fff' },
      { label: 'Ocupada', bg: '#95a5a6', border: '#95a5a6', text: '#fff' }
    ];

    items.forEach(({ label, bg, border, text }) => {
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '8px';

      const box = document.createElement('div');
      box.style.width = '18px';
      box.style.height = '18px';
      box.style.borderRadius = '4px';
      box.style.border = `1px solid ${border}`;
      box.style.background = bg;

      const txt = document.createElement('span');
      txt.textContent = label;
      txt.style.color = text;

      wrap.appendChild(box);
      wrap.appendChild(txt);
      seatLegend.appendChild(wrap);
    });
  }

  /**
   * Atualiza formulários de passageiros
   */
  function updatePassengerForms() {
    passengerContainer.innerHTML = '';
    if (selectedSeats.length === 0) {
      confirmBtn.disabled = true;
      selectedSeatP.textContent = '';
      return;
    }
    confirmBtn.disabled = false;
    selectedSeatP.textContent = `Poltronas selecionadas: ${selectedSeats.join(', ')}`;

    selectedSeats.forEach((seatNumber) => {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'passenger-row';
      rowDiv.dataset.seatNumber = seatNumber.toString();
      rowDiv.style.display = 'flex';
      rowDiv.style.flexWrap = 'wrap';
      rowDiv.style.gap = '8px';
      rowDiv.style.alignItems = 'center';
      rowDiv.style.marginBottom = '8px';

      rowDiv.innerHTML = `
        <span class="seat-label" style="min-width:64px;font-weight:600;">Pol ${seatNumber}:</span>
        <input type="text" name="name" placeholder="Nome" required>
        <select name="docType" required>
          <option value="RG">RG</option>
          <option value="CNH">CNH</option>
          <option value="Passaporte">Passaporte</option>
        </select>
        <input type="text" name="docNumber" placeholder="Documento" required>
        <input type="text" name="cpf" placeholder="CPF" required>
        <input type="tel" name="phone" placeholder="Telefone" required>
      `;
      passengerContainer.appendChild(rowDiv);
    });
  }

  // Render inicial
  renderSeatGrid();
  updatePassengerForms();

  confirmBtn?.addEventListener('click', () => {
    if (selectedSeats.length === 0) return;

    const passengers = [];
    let valid = true;
    const rows = passengerContainer.querySelectorAll('.passenger-row');

    rows.forEach((rowDiv) => {
      const seatNumber = parseInt(rowDiv.dataset.seatNumber, 10);
      const name = rowDiv.querySelector('input[name="name"]').value.trim();
      const docType = rowDiv.querySelector('select[name="docType"]').value;
      const docNumber = rowDiv.querySelector('input[name="docNumber"]').value.trim();
      const cpf = rowDiv.querySelector('input[name="cpf"]').value.trim();
      const phone = rowDiv.querySelector('input[name="phone"]').value.trim();

      if (!name || !docNumber || !cpf || !phone) {
        valid = false;
        return;
      }
      passengers.push({ seatNumber, name, docType, docNumber, cpf, phone });
    });

    if (!valid) {
      alert('Preencha todos os dados dos passageiros.');
      return;
    }

    if (!user) {
      alert('Faça login para continuar.');
      const pending = {
        schedule,
        seats: selectedSeats.slice(),
        passengers,
        price: (Number(schedule.price) || 0) * selectedSeats.length,
        date: schedule.date
      };
      localStorage.setItem('pendingPurchase', JSON.stringify(pending));
      localStorage.setItem('postLoginRedirect', 'payment.html');
      window.location.href = 'login.html';
      return;
    }

    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    const newBooking = {
      id: Date.now(),
      schedule,
      seats: selectedSeats.slice(),
      passengers,
      price: (Number(schedule.price) || 0) * selectedSeats.length,
      date: schedule.date,
      paid: false
    };
    bookings.push(newBooking);
    localStorage.setItem('bookings', JSON.stringify(bookings));
    localStorage.removeItem('pendingPurchase');
    window.location.href = 'payment.html';
  });

  backBtn?.addEventListener('click', () => {
    window.history.back();
  });
});
