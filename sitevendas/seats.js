// seats.js – componente sem botão próprio; preserva dados ao alternar poltronas
(function(){
  function renderSeats(container, schedule /* onConfirm não é usado aqui */){
    container.innerHTML = '';

    // Cabeçalho
    const info = document.createElement('div');
    info.style.marginBottom = '8px';
    const [y,m,d] = String(schedule.date||'').split('-');
    const dataBR = (d&&m&&y) ? `${d}/${m}/${y}` : (schedule.date||'');
    info.innerHTML = `<strong>${schedule.originName||''}</strong> &rarr; <strong>${schedule.destinationName||''}</strong> — ${dataBR} às ${schedule.departureTime||''}`;
    container.appendChild(info);

    // Estrutura do ônibus
    const wrap = document.createElement('div'); wrap.className = 'bus-wrap';
    const bus  = document.createElement('div'); bus.className  = 'bus-bg';
    const grid = document.createElement('div'); grid.className = 'seat-grid';
    bus.appendChild(grid); wrap.appendChild(bus);

    const legend = document.createElement('div'); legend.className='legend';
    legend.innerHTML = `
      <span><i class="dot"></i>Disponível</span>
      <span><i class="dot sel"></i>Selecionado</span>
      <span><i class="dot occ"></i>Ocupado</span>
    `;
    wrap.appendChild(legend);

    const selectedP = document.createElement('p'); selectedP.style.margin='6px 0 10px';
    const paxBox = document.createElement('div'); paxBox.className='passenger-container';

    container.appendChild(wrap);
    container.appendChild(selectedP);
    container.appendChild(paxBox);

    // ===== Estado
    const maxSelected = 6;
    let selectedSeats = [];                   // [36, 14, ...]
    const passengersBySeat = new Map();       // 36 -> {name, cpf, phone}

    // ===== Carrega poltronas
    async function loadSeats() {
      if (Array.isArray(schedule.seats) && schedule.seats.length) return true;
      try {
        const resp = await fetch('/api/poltronas', {
          method: 'POST', headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({
            idViagem: schedule.idViagem,
            idTipoVeiculo: schedule.idTipoVeiculo,
            idLocOrigem: schedule.originId,
            idLocDestino: schedule.destinationId
          })
        });
        const raw = await resp.json();
        const data = Array.isArray(raw) ? (raw[0]||{}) : raw;

        let poltronas = [];
        if (data?.PoltronaXmlRetorno) {
          const p = data.PoltronaXmlRetorno;
          poltronas = Array.isArray(p) ? p : (Array.isArray(p?.Poltrona) ? p.Poltrona : [p]);
        } else if (data?.LaypoltronaXml?.PoltronaXmlRetorno) {
          poltronas = data.LaypoltronaXml.PoltronaXmlRetorno;
        }

        schedule.seats = (poltronas||[]).map(p=>{
          const number   = parseInt(p.Caption || p.caption || p.Numero || p.NumeroPoltrona || p.Poltrona, 10);
          const situacao = parseInt(p.Situacao ?? p.situacao ?? 0, 10); // 0 livre, 3 inativo
          return { number, situacao, occupied: situacao !== 0 };
        }).filter(s => Number.isFinite(s.number) && s.number>=1 && s.number<=42);

        return true;
      } catch(e){ console.error('poltronas:', e); return false; }
    }

    // ===== Desenho
    const rows = [
      [3,7,11,15,19,23,27,31,35,39,null],
      [4,8,12,16,20,24,28,32,36,40,null],
      [null,null,null,null,null,null,null,null,null,null,null],
      [2,6,10,14,18,22,26,30,34,38,42],
      [1,5,9,13,17,21,25,29,33,37,41]
    ];

    function draw(){
      grid.innerHTML = '';
      selectedP.textContent = selectedSeats.length ? `Poltronas selecionadas: ${selectedSeats.join(', ')}` : '';
      // NÃO limpa paxBox aqui – ele será re-renderizado preservando valores
      drawPassengers(); // inicial

      rows.forEach(row=>{
        row.forEach(cell=>{
          const div = document.createElement('div');
          if (cell===null){ div.className='walkway'; grid.appendChild(div); return; }

          div.className = 'seat';
          div.textContent = cell;
          const seatData = (schedule.seats||[]).find(s => Number(s.number)===cell);
          const forced = (cell===1 || cell===2);
          const inativo = seatData?.situacao===3;
          const ocupado = !!seatData?.occupied;

          if (forced || inativo || ocupado || !seatData){
            div.classList.add('occupied');
            div.setAttribute('aria-disabled','true');
          } else {
            if (selectedSeats.includes(cell)) div.classList.add('selected');
            div.addEventListener('click', ()=>{
              toggleSeat(cell, div);
            });
          }
          grid.appendChild(div);
        });
      });
    }

    function toggleSeat(n, div){
      const already = selectedSeats.includes(n);
      if (!already){
        if (selectedSeats.length>=maxSelected){ alert(`Máximo ${maxSelected} poltronas.`); return; }
        selectedSeats.push(n);
        // inicia com valores já existentes (se houver) ou vazios
        if (!passengersBySeat.has(n)) passengersBySeat.set(n, { name:'', cpf:'', phone:'' });
        div.classList.add('selected');
      }else{
        selectedSeats = selectedSeats.filter(x=>x!==n);
        passengersBySeat.delete(n);
        div.classList.remove('selected');
      }
      selectedP.textContent = selectedSeats.length ? `Poltronas selecionadas: ${selectedSeats.join(', ')}` : '';
      drawPassengers(); // re-renderiza, mas PRESERVANDO os valores em passengersBySeat
    }

    function drawPassengers(){
      // salva os valores digitados ANTES de redesenhar
      for (const row of paxBox.querySelectorAll('.passenger-row')) {
        const seatNumber = parseInt(row.dataset.seatNumber,10);
        const name  = row.querySelector('input[name="name"]')?.value || '';
        const cpf   = row.querySelector('input[name="cpf"]')?.value || '';
        const phone = row.querySelector('input[name="phone"]')?.value || '';
        if (!passengersBySeat.has(seatNumber)) passengersBySeat.set(seatNumber, { name, cpf, phone });
        else passengersBySeat.set(seatNumber, { ...passengersBySeat.get(seatNumber), name, cpf, phone });
      }

      paxBox.innerHTML = '';
      selectedSeats.forEach(n=>{
        const vals = passengersBySeat.get(n) || { name:'', cpf:'', phone:'' };
        const row = document.createElement('div');
        row.className = 'passenger-row';
        row.dataset.seatNumber = String(n);
        row.innerHTML = `
          <span class="seat-label">Pol ${n}:</span>
          <input type="text" name="name"  placeholder="Nome"    value="${vals.name||''}" />
          <input type="text" name="cpf"   placeholder="CPF"     value="${vals.cpf||''}" />
          <input type="tel"  name="phone" placeholder="Telefone" value="${vals.phone||''}" />
        `;
        // atualiza o map a cada digitação
        row.querySelectorAll('input').forEach(inp=>{
          inp.addEventListener('input', ()=>{
            const n2 = parseInt(row.dataset.seatNumber,10);
            const v  = {
              name:  row.querySelector('input[name="name"]').value,
              cpf:   row.querySelector('input[name="cpf"]').value,
              phone: row.querySelector('input[name="phone"]').value
            };
            passengersBySeat.set(n2, v);
          });
        });
        paxBox.appendChild(row);
      });
    }

    // ===== Coletor para o botão externo
    container.__sv_collect = function(){
      if (!selectedSeats.length) return { ok:false, error:'Selecione ao menos 1 poltrona.' };
      const passengers = selectedSeats.map(n=>{
        const v = passengersBySeat.get(n) || {name:'',cpf:'',phone:''};
        return { seatNumber:n, name:v.name?.trim(), cpf:v.cpf?.trim(), phone:v.phone?.trim() };
      });
      const incompleto = passengers.some(p => !p.name || !p.cpf || !p.phone);
      if (incompleto) return { ok:false, error:'Preencha todos os dados dos passageiros.' };
      return { ok:true, payload:{ schedule, seats:selectedSeats.slice(), passengers } };
    };

    // ===== Inicializa
    (async ()=>{ await loadSeats(); draw(); })();
  }

  window.renderSeats = renderSeats;
})();
