// seats.js - exibe mapa de assentos e permite seleção
// Esta versão consulta o mapa de assentos através do backend (/api/poltronas)
// em vez de acessar diretamente a API da Praxio. Isso evita problemas de CORS
// e mantém as credenciais fora do frontend. Também filtra poltronas de
// corredor (situacao 3 ou 7) e garante que apenas assentos reais (1-42)
// sejam exibidos.

document.addEventListener('DOMContentLoaded', () => {
  // Atualiza a navegação do usuário se a função existir
  if (typeof updateUserNav === 'function') {
    updateUserNav();
  }
  const schedule = JSON.parse(localStorage.getItem('selectedSchedule') || 'null');
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const tripInfo = document.getElementById('trip-info');
  const seatMap = document.getElementById('seat-map');
  const selectedSeatP = document.getElementById('selected-seat');
  const confirmBtn = document.getElementById('confirm-seat');
  const backBtn = document.getElementById('back-btn');
  const passengerContainer = document.getElementById('passenger-container');
  const maxSelected = 6;
  let selectedSeats = [];

  if (!schedule) {
    if (tripInfo) tripInfo.textContent = 'Nenhuma viagem selecionada.';
    if (confirmBtn) confirmBtn.disabled = true;
    return;
  }

  // Exibe a rota e o horário selecionados
  if (tripInfo) {
    /*
    const origin = schedule.originName || schedule.origin;
    const dest = schedule.destinationName || schedule.destination;
    tripInfo.textContent = `${origin} → ${dest} em ${schedule.date} às ${schedule.departureTime}`;
    */

    const [ano, mes, dia] = schedule.date.split('-');
    const dataBR = `${dia}/${mes}/${ano}`;
    const horaBR = schedule.departureTime; // já no formato HH:MM 24h
    tripInfo.innerHTML = `<strong>${origin}</strong> &rarr; <strong>${dest}</strong> – ${dataBR} às ${horaBR}`;

  }

  /**
   * Carrega o mapa de assentos se ainda não estiver em schedule.seats.
   * Filtra assentos com situation 3 ou 7 (corredor ou inexistente) e
   * mantém apenas poltronas numeradas de 1 a 42.
   */
  async function ensureSeatMap() {
    if (schedule.seats && Array.isArray(schedule.seats) && schedule.seats.length > 0) {
      return;
    }
    try {
      const payload = {
        idViagem: schedule.idViagem,
        idTipoVeiculo: schedule.idTipoVeiculo,
        idLocOrigem: schedule.originId,
        idLocDestino: schedule.destinationId,
      };
      const response = await fetch('/api/poltronas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Falha ao obter poltronas');
      const rawData = await response.json();
      // Loga a resposta bruta para depuração
      console.log('Poltronas API response:', rawData);
      const data = Array.isArray(rawData) ? rawData[0] || {} : rawData;
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
        // Loga a lista de poltronas para depuração
        console.log('Lista de poltronas recebidas:', poltronas);
        schedule.seats = poltronas
          .map((p) => {
            const number = parseInt(
              p.Caption || p.caption || p.Numero || p.NumeroPoltrona || p.Poltrona,
              10,
            );
            const situacao = parseInt(p.Situacao || p.situacao || 0, 10);
            return {
              number,
              situacao,
              occupied: situacao !== 0,
            };
          })
          // Mantém apenas poltronas entre 1 e 42 e descarta corredores (situação 3 ou 7)
          .filter(
            (s) =>
              s.number &&
              s.number >= 1 &&
              s.number <= 42 &&
              s.situacao !== 3 &&
              s.situacao !== 7,
          );
      }
    } catch (err) {
      console.error('Erro ao carregar mapa de poltronas:', err);
      schedule.seats = generateSeatMapFallback();
    }
  }

  /**
   * Gera um mapa de assentos estático de fallback (para erro na API).
   * Mantém o mesmo padrão de numeração usado pelo layout.
   */
  function generateSeatMapFallback() {
    const pattern = [
      [3, 7, 11, 15, 19, 23, 27, 31, 35, 39],
      [4, 8, 12, 16, 20, 24, 28, 32, 36, 40],
      [2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42],
      [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41],
    ];
    const seats = [];
    pattern.forEach((row) => {
      row.forEach((num) => {
        const occupied = num === 1 || num === 2 || Math.random() < 0.2;
        seats.push({ number: num, occupied, situacao: occupied ? 1 : 0 });
      });
    });
    return seats;
  }

  /**
   * Renderiza o mapa de assentos usando grade com corredor horizontal.
   * Assentos ocupados ganham classe 'occupied'; selecionados, 'selected'.
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
            if (seatData && seatData.occupied) return;
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
  }

  /**
   * Atualiza os formulários de passageiros conforme seleção de assentos.
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

  // Renderiza mapa e formulários ao carregar
  renderSeatGrid();
  updatePassengerForms();

  // Confirmação de assentos
  confirmBtn.addEventListener('click', () => {
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
        schedule: schedule,
        seats: selectedSeats.slice(),
        passengers: passengers,
        price: schedule.price * selectedSeats.length,
        date: schedule.date,
      };
      localStorage.setItem('pendingPurchase', JSON.stringify(pending));
      localStorage.setItem('postLoginRedirect', 'payment.html');
      window.location.href = 'login.html';
      return;
    }
    // Cria reserva
    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    const newBooking = {
      id: Date.now(),
      schedule: schedule,
      seats: selectedSeats.slice(),
      passengers: passengers,
      price: schedule.price * selectedSeats.length,
      date: schedule.date,
      paid: false,
    };
    bookings.push(newBooking);
    localStorage.setItem('bookings', JSON.stringify(bookings));
    localStorage.removeItem('pendingPurchase');
    window.location.href = 'payment.html';
  });

  // Botão voltar
  backBtn.addEventListener('click', () => {
    window.history.back();
  });
});
