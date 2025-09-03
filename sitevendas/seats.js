// seats.js - exibe mapa de assentos e permite seleção
document.addEventListener('DOMContentLoaded', () => {
  updateUserNav();
  const schedule = JSON.parse(localStorage.getItem('selectedSchedule') || 'null');
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const tripInfo = document.getElementById('trip-info');
  // O container de assentos foi renomeado para seat-map e fica dentro do
  // layout do ônibus. Ele usa grid para posicionar as poltronas.
  const seatMap = document.getElementById('seat-map');
  const selectedSeatP = document.getElementById('selected-seat');
  const confirmBtn = document.getElementById('confirm-seat');
  const backBtn = document.getElementById('back-btn');
  if (!schedule) {
    tripInfo.textContent = 'Nenhuma viagem selecionada.';
    confirmBtn.disabled = true;
    return;
  }
  tripInfo.textContent = `${schedule.originName || schedule.origin} → ${schedule.destinationName || schedule.destination} em ${schedule.date} às ${schedule.departureTime}`;
  // Seleção de múltiplas poltronas (até 6)
  const passengerContainer = document.getElementById('passenger-container');
  let selectedSeats = [];

  // Carrega o mapa de poltronas a partir da API se ainda não estiver definido.
  async function ensureSeatMap() {
    if (schedule.seats && Array.isArray(schedule.seats) && schedule.seats.length > 0) {
      return;
    }
    try {
      const sessionInfo = JSON.parse(localStorage.getItem('sessionInfo') || 'null');
      if (!sessionInfo) throw new Error('Informações de sessão ausentes');
      const payload = {
        IdSessaoOp: sessionInfo.idSessaoOp,
        IdViagem: schedule.idViagem,
        IdTipoVeiculo: schedule.idTipoVeiculo,
        IdLocOrigem: schedule.originId,
        IdLocdestino: schedule.destinationId,
        Andar: 0,
        VerificarSugestao: 1
      };
      const res = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Poltrona/RetornaPoltronas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Falha ao obter poltronas');
      const data = await res.json();
      // Extrai a lista de poltronas retornadas. Dependendo da estrutura, pode estar em
      // data.LaypoltronaXml.PoltronaXmlRetorno ou data.LaypoltronaXml?.PoltronaXmlRetorno.
      const poltronas = data?.LaypoltronaXml?.PoltronaXmlRetorno || data?.LaypoltronaXml?.poltronaXmlRetorno || [];
      if (Array.isArray(poltronas) && poltronas.length > 0) {
        schedule.seats = poltronas.map(p => {
          const number = parseInt(p.Caption || p.caption || p.Numero || p.NumeroPoltrona);
          const situacao = parseInt(p.Situacao || p.situacao || 0);
          // Situação 0 é disponível; qualquer outro valor indica ocupada/reservada etc.
          return { number, occupied: situacao !== 0 };
        });
      }
    } catch (error) {
      console.error('Erro ao carregar mapa de poltronas:', error);
      // Caso a API falhe, gera um mapa estático com ocupação aleatória
      schedule.seats = generateSeatMapFallback();
    }
  }

  // Gera mapa de poltronas estático como fallback (apenas para demonstração)
  function generateSeatMapFallback() {
    const pattern = [
      [3, 7, 11, 15, 19, 23, 27, 31, 35, 39],
      [4, 8, 12, 16, 20, 24, 28, 32, 36, 40],
      [2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42],
      [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41]
    ];
    const seats = [];
    pattern.forEach(row => {
      row.forEach(num => {
        const occupied = num === 1 || num === 2 || Math.random() < 0.2;
        seats.push({ number: num, occupied });
      });
    });
    return seats;
  }

  // Função para renderizar o mapa de assentos com corredor
  async function renderSeatGrid() {
    // Garante que as poltronas estão carregadas
    await ensureSeatMap();
    seatMap.innerHTML = '';
    // Define o padrão de fileiras para renderizar as poltronas na ordem correta.
    // Define as fileiras e insere o corredor (representado como null) após o 5º assento
    const rows = [
      // Fileiras superiores (10 assentos cada)
      [3, 7, 11, 15, 19, 23, 27, 31, 35, 39, null],
      [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, null],
      // Corredor: linha vazia
      [null, null, null, null, null, null, null, null, null, null, null],
      // Fileiras inferiores (11 assentos cada)
      [2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42],
      [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41]
    ];
    rows.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        // Posição na grade: adicionamos 1 para indexação 1-based
        const rowPos = rowIndex + 1;
        const colPos = colIndex + 1;
        if (cell === null) {
          // Cria uma célula para o corredor
          const walkwayDiv = document.createElement('div');
          walkwayDiv.className = 'walkway';
          walkwayDiv.style.gridRowStart = rowPos;
          walkwayDiv.style.gridColumnStart = colPos;
          seatMap.appendChild(walkwayDiv);
        } else {
          // Cria a poltrona normal
          const seat = schedule.seats?.find((s) => s.number === cell);
          const div = document.createElement('div');
          div.className = 'seat';
          div.textContent = cell;
          div.style.gridRowStart = rowPos;
          div.style.gridColumnStart = colPos;
          if (seat && seat.occupied) div.classList.add('occupied');
          if (selectedSeats.includes(cell)) {
            div.classList.add('selected');
          }
          div.addEventListener('click', () => {
            if (seat && seat.occupied) return;
            const index = selectedSeats.indexOf(cell);
            if (index !== -1) {
              selectedSeats.splice(index, 1);
              updatePassengerForms();
              renderSeatGrid();
              return;
            }
            if (selectedSeats.length >= 6) {
              alert('É possível selecionar no máximo 6 poltronas por compra.');
              return;
            }
            selectedSeats.push(cell);
            updatePassengerForms();
            renderSeatGrid();
          });
          seatMap.appendChild(div);
        }
      });
    });
  }

  // Função para atualizar os formulários de passageiros
  function updatePassengerForms() {
    passengerContainer.innerHTML = '';
    if (selectedSeats.length === 0) {
      confirmBtn.disabled = true;
      selectedSeatP.textContent = '';
      return;
    }
    confirmBtn.disabled = false;
    selectedSeatP.textContent = `Poltronas selecionadas: ${selectedSeats.join(', ')}`;
    // Para cada poltrona, cria um formulário de passageiro
    selectedSeats.forEach((seatNumber) => {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'passenger-row';
      rowDiv.dataset.seatNumber = seatNumber;
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

  renderSeatGrid();
  updatePassengerForms();

  confirmBtn.addEventListener('click', () => {
    if (selectedSeats.length === 0) return;
    // Valida todos os formulários dos passageiros
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
      if (!name || !docType || !docNumber || !cpf || !phone) {
        valid = false;
        return;
      }
      passengers.push({ seatNumber, name, docType, docNumber, cpf, phone });
    });
    if (!valid) {
      alert('Preencha todos os dados dos passageiros.');
      return;
    }
    // Se o usuário não estiver logado, armazena a compra pendente e redireciona para login
    if (!user) {
      alert('Faça login para continuar.');
      // guarda a compra pendente (assentos, passageiros e horário) e o valor total
      const pending = {
        schedule: schedule,
        seats: selectedSeats.slice(),
        passengers: passengers,
        price: schedule.price * selectedSeats.length,
        date: schedule.date
      };
      localStorage.setItem('pendingPurchase', JSON.stringify(pending));
      // define a página de redirecionamento pós login como pagamento
      localStorage.setItem('postLoginRedirect', 'payment.html');
      window.location.href = 'login.html';
      return;
    }
    // Se o usuário está logado, cria a reserva imediatamente
    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    const newBooking = {
      id: Date.now(),
      schedule: schedule,
      seats: selectedSeats.slice(),
      passengers: passengers,
      price: schedule.price * selectedSeats.length,
      date: schedule.date,
      paid: false
    };
    bookings.push(newBooking);
    localStorage.setItem('bookings', JSON.stringify(bookings));
    // Limpa qualquer compra pendente
    localStorage.removeItem('pendingPurchase');
    // Redireciona para pagamento
    window.location.href = 'payment.html';
  });
  backBtn.addEventListener('click', () => {
    window.history.back();
  });
});