// seats.js — componente em função única para usar no card da direita
// Usa bus-blank.png como fundo e a matriz 1..42 (1 e 2 bloqueadas)
// Assinatura: window.renderSeats(container, schedule, onConfirm)

(function(){
  function renderSeats(container, schedule, onConfirm){
    container.innerHTML = '';

    // Cabeçalho compacto com rota + data/hora
    const info = document.createElement('div');
    info.style.marginBottom = '8px';
    const origin = schedule.originName || schedule.origin || schedule.origem || '';
    const dest   = schedule.destinationName || schedule.destination || schedule.destino || '';
    const [y,m,d] = String(schedule.date||'').split('-');
    const dataBR = (d && m && y) ? `${d}/${m}/${y}` : (schedule.date || '');
    info.innerHTML = `<strong>${origin}</strong> &rarr; <strong>${dest}</strong> — ${dataBR} às ${schedule.departureTime || ''}`;
    container.appendChild(info);

    // Estrutura visual (ônibus + grade + legenda)
    const wrap = document.createElement('div');
    wrap.className = 'bus-wrap';

    const bus = document.createElement('div');
    bus.className = 'bus-bg'; // CSS usa bus-blank.png
    const grid = document.createElement('div');
    grid.className = 'seat-grid';
    bus.appendChild(grid);
    wrap.appendChild(bus);

    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML = `
      <span><i class="dot"></i>Disponível</span>
      <span><i class="dot sel"></i>Selecionado</span>
      <span><i class="dot occ"></i>Ocupado</span>
    `;
    wrap.appendChild(legend);

    const selectedP = document.createElement('p');
    selectedP.id = 'selected-seat';
    selectedP.style.margin = '6px 0 10px';

    const paxBox = document.createElement('div');
    paxBox.className = 'passenger-container';
    paxBox.id = 'passenger-container';

    const actions = document.createElement('div');
    actions.className = 'actions';
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.textContent = 'Confirmar seleção';
    actions.appendChild(confirmBtn);

    container.appendChild(wrap);
    container.appendChild(selectedP);
    container.appendChild(paxBox);
    container.appendChild(actions);

    // Estado
    const maxSelected = 6;
    let selectedSeats = [];

    // Carrega poltronas da API (ou reaproveita se já vieram no schedule)
    async function loadSeats() {
      if (Array.isArray(schedule.seats) && schedule.seats.length > 0) return true;
      try {
        const resp = await fetch('/api/poltronas', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({
            idViagem:      schedule.idViagem,
            idTipoVeiculo: schedule.idTipoVeiculo,
            idLocOrigem:   schedule.originId,
            idLocDestino:  schedule.destinationId
          })
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const raw = await resp.json();
        const data = Array.isArray(raw) ? (raw[0]||{}) : raw;

        let poltronas = [];
        if (data?.PoltronaXmlRetorno) {
          const p = data.PoltronaXmlRetorno;
          poltronas = Array.isArray(p) ? p : (Array.isArray(p?.Poltrona) ? p.Poltrona : [p]);
        } else if (data?.LaypoltronaXml?.PoltronaXmlRetorno) {
          poltronas = data.LaypoltronaXml.PoltronaXmlRetorno;
        }

        const seats = (poltronas||[]).map(p=>{
          const number   = parseInt(p.Caption || p.caption || p.Numero || p.NumeroPoltrona || p.Poltrona, 10);
          const situacao = parseInt(p.Situacao ?? p.situacao ?? 0, 10);
          return { number, situacao, occupied: situacao !== 0 };
        }).filter(s => Number.isFinite(s.number) && s.number >= 1 && s.number <= 42);

        if (!seats.length) throw new Error('Mapa vazio');
        schedule.seats = seats;
        return true;
      } catch (e){
        console.error('Erro poltronas:', e);
        schedule.seats = null;
        return false;
      }
    }

    function draw(){
      grid.innerHTML = '';
      paxBox.innerHTML = '';
      selectedP.textContent = '';

      // Matriz do seu layout
      const rows = [
        [3,7,11,15,19,23,27,31,35,39,null],
        [4,8,12,16,20,24,28,32,36,40,null],
        [null,null,null,null,null,null,null,null,null,null,null],
        [2,6,10,14,18,22,26,30,34,38,42],
        [1,5,9,13,17,21,25,29,33,37,41]
      ];

      rows.forEach((row)=>{
        row.forEach((cell)=>{
          if (cell === null){
            const w = document.createElement('div');
            w.className = 'walkway';
            grid.appendChild(w);
            return;
          }

          const seatDiv = document.createElement('div');
          seatDiv.className = 'seat';
          seatDiv.textContent = cell;
          seatDiv.dataset.seat = String(cell);

          const sData = (schedule.seats||[]).find(s => Number(s.number) === cell);
          const isForcedBlocked = (cell === 1 || cell === 2);
          const isInactive = sData?.situacao === 3;
          const isOccupied = !!sData?.occupied;
          const isMissing  = !sData;
          const isUnavailable = isForcedBlocked || isInactive || isOccupied || isMissing;

          if (isUnavailable){
            seatDiv.classList.add('occupied');
            seatDiv.setAttribute('aria-disabled','true');
          } else {
            seatDiv.addEventListener('click', ()=>{
              seatDiv.classList.toggle('selected');
              if (selectedSeats.includes(cell)) {
                selectedSeats = selectedSeats.filter(x => x !== cell);
              } else {
                if (selectedSeats.length >= maxSelected){
                  alert(`É possível selecionar no máximo ${maxSelected} poltronas por compra.`);
                  seatDiv.classList.remove('selected');
                  return;
                }
                selectedSeats.push(cell);
              }
              renderPassengers();
            });
          }

          grid.appendChild(seatDiv);
        });
      });
    }

    function renderPassengers(){
      paxBox.innerHTML = '';
      selectedP.textContent = selectedSeats.length ? `Poltronas selecionadas: ${selectedSeats.join(', ')}` : '';
      selectedSeats.forEach(n=>{
        const row = document.createElement('div');
        row.className = 'passenger-row';
        row.dataset.seatNumber = String(n);
        row.innerHTML = `
          <span class="seat-label">Pol ${n}:</span>
          <input type="text" name="name"  placeholder="Nome" required />
          <input type="text" name="cpf"   placeholder="CPF" required />
          <input type="tel"  name="phone" placeholder="Telefone" required />
        `;
        paxBox.appendChild(row);
      });
    }

    // Confirmar: valida e devolve para o main.js
    confirmBtn.addEventListener('click', ()=>{
      if (!selectedSeats.length){
        alert('Primeiro selecione uma poltrona.');
        return;
      }
      const rows = paxBox.querySelectorAll('.passenger-row');
      const passengers = [];
      let ok = true;
      rows.forEach(r=>{
        const name  = r.querySelector('input[name="name"]')?.value.trim();
        const cpf   = r.querySelector('input[name="cpf"]')?.value.trim();
        const phone = r.querySelector('input[name="phone"]')?.value.trim();
        const seatNumber = parseInt(r.dataset.seatNumber,10);
        if (!name || !cpf || !phone) ok = false;
        passengers.push({ seatNumber, name, cpf, phone });
      });
      if (!ok){
        alert('Preencha todos os dados dos passageiros.');
        return;
      }
      onConfirm && onConfirm({ schedule, seats: selectedSeats.slice(), passengers });
    });

    // Inicializa
    (async ()=>{ const ok = await loadSeats(); if (ok) draw(); })();
  }

  // expõe global
  window.renderSeats = renderSeats;
})();
