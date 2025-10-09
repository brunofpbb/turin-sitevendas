// seats.js - seleção de poltronas (sem tipo/doc; validação robusta)
document.addEventListener('DOMContentLoaded', () => {
  if (typeof updateUserNav === 'function') updateUserNav();

  const schedule           = JSON.parse(localStorage.getItem('selectedSchedule') || 'null');
  const user               = JSON.parse(localStorage.getItem('user') || 'null');

  const tripInfo           = document.getElementById('trip-info');
  const seatMap            = document.getElementById('seat-map');
  const selectedSeatP      = document.getElementById('selected-seat');
  const passengerContainer = document.getElementById('passenger-container');

  // Botão de pagar (id + fallback por data-attr/classe)
  let confirmBtn = document.getElementById('confirm-seat') ||
                   document.querySelector('[data-confirm], button.confirm-seat');

  // Form envolvente (se houver) para interceptar submit mudo
  const formEl = (confirmBtn && confirmBtn.closest('form')) || document.querySelector('#passenger-form');

  const backBtn            = document.getElementById('back-btn');

  const maxSelected = 6;
  let selectedSeats = [];

  // ====== Cabeçalho ======
  if (!schedule) {
    if (tripInfo) tripInfo.textContent = 'Nenhuma viagem selecionada.';
    if (confirmBtn) confirmBtn.disabled = true;
    return;
  }

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

  // ====== API: Carrega poltronas ======
  async function loadSeatsFromApi() {
    if (Array.isArray(schedule.seats) && schedule.seats.length > 0) return true;
    try {
      const payload = {
        idViagem:      schedule.idViagem,
        idTipoVeiculo: schedule.idTipoVeiculo,
        idLocOrigem:   schedule.originId,
        idLocDestino:  schedule.destinationId,
      };
      const resp = await fetch('/api/poltronas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);

      const raw  = await resp.json();
      const data = Array.isArray(raw) ? (raw[0] || {}) : raw;

      let poltronas = [];
      if (data?.PoltronaXmlRetorno) {
        const p = data.PoltronaXmlRetorno;
        poltronas = Array.isArray(p) ? p : (Array.isArray(p?.Poltrona) ? p.Poltrona : [p]);
      } else if (data?.LaypoltronaXml?.PoltronaXmlRetorno) {
        poltronas = data.LaypoltronaXml.PoltronaXmlRetorno;
      }

      const seats = (poltronas || []).map(p => {
        const number = parseInt(p.Caption || p.caption || p.Numero || p.NumeroPoltrona || p.Poltrona, 10);
        const situacao = parseInt(p.Situacao ?? p.situacao ?? 0, 10);
        return { number, situacao, occupied: situacao !== 0 };
      }).filter(s => Number.isFinite(s.number) && s.number >= 1 && s.number <= 42);

      if (!seats.length) throw new Error('Mapa vazio');
      schedule.seats = seats;
      return true;
    } catch (e) {
      console.error('Erro ao carregar mapa de poltronas:', e);
      schedule.seats = null;
      return false;
    }
  }

  // ====== Render ======
  async function render() {
    const ok = await loadSeatsFromApi();

    if (seatMap) seatMap.innerHTML = '';
    if (passengerContainer) passengerContainer.innerHTML = '';
    if (selectedSeatP) selectedSeatP.textContent = '';

    if (!ok || !Array.isArray(schedule.seats)) {
      // erro: mostra mensagem e desabilita pagar
      if (seatMap) {
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
      }
      if (confirmBtn) confirmBtn.disabled = true;
      return;
    }

    if (confirmBtn) confirmBtn.disabled = false; // habilitado para exibir alerta se não houver seleção

    const rows = [
      [3, 7, 11, 15, 19, 23, 27, 31, 35, 39, null],
      [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, null],
      [null, null, null, null, null, null, null, null, null, null, null],
      [2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42],
      [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41],
    ];

    rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        const rowPos = r + 1;
        const colPos = c + 1;

        if (cell === null) {
          const walkway = document.createElement('div');
          walkway.className = 'walkway';
          walkway.style.gridRowStart = rowPos;
          walkway.style.gridColumnStart = colPos;
          seatMap.appendChild(walkway);
          return;
        }

        const seatDiv = document.createElement('div');
        seatDiv.className = 'seat';
        seatDiv.textContent = cell;
        seatDiv.dataset.seat = String(cell);
        seatDiv.style.gridRowStart = rowPos;
        seatDiv.style.gridColumnStart = colPos;

        if (selectedSeats.includes(cell)) seatDiv.classList.add('selected');

        const sData = schedule.seats.find(s => Number(s.number) === cell);
        const isForcedBlocked = (cell === 1 || cell === 2);
        const isInactive = sData?.situacao === 3;
        const isOccupied = !!sData?.occupied;
        const isMissing  = !sData;
        const isUnavailable = isForcedBlocked || isInactive || isOccupied || isMissing;

        if (isUnavailable) {
          seatDiv.classList.add('occupied');
          seatDiv.setAttribute('aria-disabled', 'true');
          seatMap.appendChild(seatDiv);
          return;
        }

        seatDiv.addEventListener('click', () => {
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
          updatePassengersUI();
        });

        seatMap.appendChild(seatDiv);
      });
    });
  }

  function updatePassengersUI() {
    if (!passengerContainer) return;
    passengerContainer.innerHTML = '';

    if (selectedSeatP) {
      selectedSeatP.textContent = selectedSeats.length
        ? `Poltronas selecionadas: ${selectedSeats.join(', ')}`
        : '';
    }

    selectedSeats.forEach((n) => {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'passenger-row';
      rowDiv.dataset.seatNumber = String(n);
      rowDiv.innerHTML = `
        <span class="seat-label">Pol ${n}:</span>
        <input type="text" name="name" placeholder="Nome" required>
        <input type="text" name="cpf" placeholder="CPF" required>
        <input type="tel"  name="phone" placeholder="Telefone" required>
      `;
      passengerContainer.appendChild(rowDiv);
    });
  }

  // ====== Handler único para pagar (click/submit) ======
  function handleCheckout(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    // 1) Sem seleção → alerta
    if (!Array.isArray(selectedSeats) || selectedSeats.length === 0) {
      alert('Primeiro selecione uma poltrona.');
      return false;
    }

    // 2) Validar campos dos passageiros (agora apenas Nome, CPF, Telefone)
    const rows = passengerContainer ? passengerContainer.querySelectorAll('.passenger-row') : [];
    let valid = true;
    const passengers = [];
    rows.forEach((rowDiv) => {
      const name   = rowDiv.querySelector('input[name="name"]')?.value.trim();
      const cpf    = rowDiv.querySelector('input[name="cpf"]')?.value.trim();
      const phone  = rowDiv.querySelector('input[name="phone"]')?.value.trim();
      const seatNumber = parseInt(rowDiv.dataset.seatNumber, 10);
      if (!name || !cpf || !phone) valid = false;
      passengers.push({ seatNumber, name, cpf, phone });
    });

    if (!valid) {
      alert('Preencha todos os dados dos passageiros.');
      return false;
    }

    // 3) Exigir login
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
      return false;
    }

    // 4) Persistir e ir ao pagamento
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
    return true;
  }

  // ====== Bind único (evita duplicidade de listeners) ======
  if (confirmBtn) {
    confirmBtn.setAttribute('type', 'button');  // evita submit mudo
    const clone = confirmBtn.cloneNode(true);   // remove listeners antigos
    confirmBtn.parentNode.replaceChild(clone, confirmBtn);
    confirmBtn = clone;
    confirmBtn.addEventListener('click', handleCheckout);
  }
  if (formEl) formEl.addEventListener('submit', handleCheckout);

  // ====== Inicializa ======
  render();
  backBtn?.addEventListener('click', () => window.history.back());
});
