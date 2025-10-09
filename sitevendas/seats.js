// seats.js - seleção de poltronas
document.addEventListener('DOMContentLoaded', () => {
  if (typeof updateUserNav === 'function') updateUserNav();

  const schedule           = JSON.parse(localStorage.getItem('selectedSchedule') || 'null');
  const user               = JSON.parse(localStorage.getItem('user') || 'null');

  const tripInfo           = document.getElementById('trip-info');
  const seatMap            = document.getElementById('seat-map');
  const selectedSeatP      = document.getElementById('selected-seat');
  const confirmBtn         = document.getElementById('confirm-seat');
  const backBtn            = document.getElementById('back-btn');
  const passengerContainer = document.getElementById('passenger-container');

  const maxSelected = 6;
  let selectedSeats = [];

  // --- sem viagem ---
  if (!schedule) {
    if (tripInfo) tripInfo.textContent = 'Nenhuma viagem selecionada.';
    if (confirmBtn) confirmBtn.disabled = true;
    return;
  }

  // --- cabeçalho ---
  if (tripInfo) {
    const origin = schedule.originName || schedule.origin || schedule.origem || '';
    const dest   = schedule.destinationName || schedule.destination || schedule.destino || '';
    try {
      const [ano, mes, dia] = String(schedule.date || '').split('-');
      const dataBR = (dia && mes && ano) ? `${dia}/${mes}/${ano}` : schedule.date || '';
      const horaBR = schedule.departureTime || schedule.horaPartida || '';
      tripInfo.innerHTML = `<strong>${origin}</strong> &rarr; <strong>${dest}</strong> – ${dataBR} às ${horaBR}`;
    } catch {
      tripInfo.textContent = `${origin} → ${dest} em ${schedule.date} às ${schedule.departureTime}`;
    }
  }

  // --- busca poltronas da API. retorna true/false ---
  async function ensureSeatMap() {
    // se já veio de outra tela, reaproveita
    if (Array.isArray(schedule.seats) && schedule.seats.length > 0) return true;

    try {
      const payload = {
        idViagem:      schedule.idViagem,
        idTipoVeiculo: schedule.idTipoVeiculo,
        idLocOrigem:   schedule.originId,
        idLocDestino:  schedule.destinationId,
      };

      const response = await fetch('/api/poltronas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);

      const raw  = await response.json();
      const data = Array.isArray(raw) ? (raw[0] || {}) : raw;

      let poltronas = [];
      if (data?.PoltronaXmlRetorno) {
        const p = data.PoltronaXmlRetorno;
        poltronas = Array.isArray(p) ? p : (Array.isArray(p?.Poltrona) ? p.Poltrona : [p]);
      } else if (data?.LaypoltronaXml?.PoltronaXmlRetorno) {
        poltronas = data.LaypoltronaXml.PoltronaXmlRetorno;
      }

      const seats = (poltronas || []).map(p => {
        const number = parseInt(
          p.Caption || p.caption || p.Numero || p.NumeroPoltrona || p.Poltrona,
          10
        );
        const situacao = parseInt(p.Situacao ?? p.situacao ?? 0, 10);
        return { number, situacao, occupied: situacao !== 0 };
      }).filter(s => Number.isFinite(s.number) && s.number >= 1 && s.number <= 42);

      if (!seats.length) throw new Error('Mapa vazio');

      schedule.seats = seats;
      return true;
    } catch (err) {
      console.error('Erro ao carregar mapa de poltronas:', err);
      schedule.seats = null;
      return false;
    }
  }

  // --- render do grid (42 posições) ---
  async function renderSeatGrid() {
    const ok = await ensureSeatMap();

    // limpa
    seatMap.innerHTML = '';
    passengerContainer.innerHTML = '';
    selectedSeatP.textContent = '';
    confirmBtn.disabled = true;

    // falha: mostra mensagem no lugar do mapa
    if (!ok || !Array.isArray(schedule.seats)) {
      const msg = document.createElement('div');
      msg.className = 'seat-error';
      msg.style.padding = '16px';
      msg.style.background = '#fff7f7';
      msg.style.border = '1px solid #f2c7c7';
      msg.style.borderRadius = '8px';
      msg.style.color = '#8a1f1f';
      msg.style.textAlign = 'center';
      msg.textContent = 'Não foi possível carregar o mapa de poltronas. Tente novamente mais tarde.';
      seatMap.appendChild(msg);
      return;
    }

    const rows = [
      [3, 7, 11, 15, 19, 23, 27, 31, 35, 39, null],
      [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, null],
      [null, null, null, null, null, null, null, null, null, null, null],
      [2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42],
      [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41],
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
          return;
        }

        const seatDiv = document.createElement('div');
        seatDiv.className = 'seat';
        seatDiv.textContent = cell;
        seatDiv.dataset.seat = String(cell);
        seatDiv.style.gridRowStart = rowPos;
        seatDiv.style.gridColumnStart = colPos;

        if (selectedSeats.includes(cell)) seatDiv.classList.add('selected');

        const seatData = schedule.seats.find(s => Number(s.number) === cell);

        const isForcedBlocked = (cell === 1 || cell === 2); // 1 e 2 sempre indisponíveis
        const isInactive      = seatData?.situacao === 3;
        const isOccupied      = !!seatData?.occupied;
        const isMissing       = !seatData;
        const isUnavailable   = isForcedBlocked || isInactive || isOccupied || isMissing;

        if (isUnavailable) {
          seatDiv.classList.add('occupied');
          seatDiv.setAttribute('aria-disabled', 'true');
          seatMap.appendChild(seatDiv);
          return;
        }

        seatDiv.addEventListener('click', () => {
          // toggle seleção
          seatDiv.classList.toggle('selected');
          if (selectedSeats.includes(cell)) {
            selectedSeats = selectedSeats.filter(x => x !== cell);
          } else {
            if (selectedSeats.length >= maxSelected) {
              alert(`É possível selecionar no máximo ${maxSelected} poltronas por compra.`);
              seatDiv.classList.remove('selected');
              return;
            }
            selectedSeats.push(cell);
          }
          updatePassengerForms();
        });

        seatMap.appendChild(seatDiv);
      });
    });
  }

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
      rowDiv.dataset.seatNumber = String(seatNumber);
      rowDiv.innerHTML = `
        <span class="seat-label">Pol ${seatNumber}:</span>
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

  // inicializa
  renderSeatGrid();

  // clique do botão – versão única (não duplica)
  confirmBtn.addEventListener('click', (e) => {
    e?.preventDefault?.();

    if (!Array.isArray(selectedSeats) || selectedSeats.length === 0) {
      alert('Primeiro selecione uma poltrona.');
      return;
    }

    // valida passageiros
    const rows = passengerContainer.querySelectorAll('.passenger-row');
    const passengers = [];
    let valid = true;
    rows.forEach((rowDiv) => {
      const seatNumber = parseInt(rowDiv.dataset.seatNumber, 10);
      const name      = rowDiv.querySelector('input[name="name"]').value.trim();
      const docType   = rowDiv.querySelector('select[name="docType"]').value;
      const docNumber = rowDiv.querySelector('input[name="docNumber"]').value.trim();
      const cpf       = rowDiv.querySelector('input[name="cpf"]').value.trim();
      const phone     = rowDiv.querySelector('input[name="phone"]').value.trim();
      if (!name || !docNumber || !cpf || !phone) valid = false;
      passengers.push({ seatNumber, name, docType, docNumber, cpf, phone });
    });

    if (!valid) {
      alert('Preencha todos os dados dos passageiros.');
      return;
    }

    // força login se necessário
    if (!user) {
      alert('Faça login para continuar.');
      const pending = {
        schedule,
        seats: selectedSeats.slice(),
        passengers,
        price: schedule.price * selectedSeats.length,
        date: schedule.date,
      };
      localStorage.setItem('pendingPurchase', JSON.stringify(pending));
      localStorage.setItem('postLoginRedirect', 'payment.html');
      window.location.href = 'login.html';
      return;
    }

    // persiste compra e segue para pagamento
    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    bookings.push({
      id: Date.now(),
      schedule,
      seats: selectedSeats.slice(),
      passengers,
      price: schedule.price * selectedSeats.length,
      date: schedule.date,
      paid: false,
    });
    localStorage.setItem('bookings', JSON.stringify(bookings));
    localStorage.removeItem('pendingPurchase');
    window.location.href = 'payment.html';
  });

  backBtn.addEventListener('click', () => window.history.back());
});
