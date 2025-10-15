// seats.js — componente de poltronas usando a malha do backup (encaixe perfeito)
// Exporta window.renderSeats(container, schedule, type) + window.destroySeats(container)

(() => {
  const STYLE_ID = 'seats-component-style-v2';
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
:root{ --brand:#0b5a2b; --brand-700:#094a24; }
.seats-card .bus-wrap{ position:relative; overflow:hidden; }
.seats-card .bus-img{ max-width:100%; height:auto; display:block; }
.seats-card .grid{
  position:absolute; inset:0;
  display:grid;
  grid-template-columns: repeat(11, 36px);
  grid-auto-rows: 26px;
  gap: 8px 10px;
  /* offsets para encaixar na carcaça do bus-blank.png */
  margin: 46px 22px 0 140px;
}
.seats-card .seat{
  background:#eaf5ea; color:#1a301a;
  border:1px solid #d8ead8; border-radius:6px;
  min-width:30px; height:22px; line-height:20px; font-size:12px;
  text-align:center; user-select:none; cursor:pointer;
}
.seats-card .seat.selected{
  background:var(--brand) !important; color:#fff !important; border-color:var(--brand-700) !important;
}
.seats-card .seat.disabled, .seats-card .seat.occupied{
  background:#cfd6cf !important; color:#666 !important; border-color:#cfd6cf !important; cursor:not-allowed;
}
.seats-card .walkway{ width:36px; height:22px; opacity:0; }

.seats-card .legend{ display:flex; align-items:center; gap:18px; margin:14px 0 6px; }
.seats-card .legend .i{ display:flex; align-items:center; gap:8px; font-size:.95rem; color:#2a3b2a; }
.seats-card .legend .sw{ width:16px; height:16px; border-radius:4px; border:1px solid #d8ead8; }
.seats-card .sw.free{ background:#eaf5ea; }
.seats-card .sw.sel{ background:var(--brand); border-color:var(--brand-700); }
.seats-card .sw.occ{ background:#cfd6cf; border-color:#cfd6cf; }

.seats-card .pax-row{ display:none; margin-top:8px; }
.seats-card .pax-grid{ display:grid; grid-template-columns: 1.6fr 1fr 1fr; gap:10px; }
.seats-card .actions{ display:flex; gap:10px; margin-top:12px; }

.btn{ padding:8px 14px; border-radius:6px; border:1px solid transparent; cursor:pointer; }
.btn-primary{ background:var(--brand); color:#fff; }
.btn-ghost{ background:#e9ecef; color:#222; }
    `.trim();
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  // util
  const pick = (...v) => v.find(x => x !== undefined && x !== null && x !== '') ?? '';
  const fmtDateBR = (iso) => {
    if (!iso || !iso.includes('-')) return iso || '';
    const [Y,M,D] = iso.split('-'); return `${D}/${M}/${Y}`;
  };

  // carrega “snapshot” da ida para restringir a volta
  function loadOutboundSnapshot() {
    const pax = JSON.parse(localStorage.getItem('outboundPassengers') || '[]');
    const cnt = Number(localStorage.getItem('outboundSeatCount') || 0) || pax.length;
    return { pax, cnt };
  }
  function saveOutboundSnapshot(passengers) {
    localStorage.setItem('outboundPassengers', JSON.stringify(passengers));
    localStorage.setItem('outboundSeatCount', String(passengers.length));
  }

  // malha do backup: 5 linhas x 11 colunas com corredor
  // (estes números batem com o bus-blank.png)
  const GRID_ROWS = [
    [ 3,  7, 11, 15, 19, 23, 27, 31, 35, 39, null],
    [ 4,  8, 12, 16, 20, 24, 28, 32, 36, 40, null],
    [null,null,null,null,null,null,null,null,null,null,null],
    [ 2,  6, 10, 14, 18, 22, 26, 30, 34, 38, 42],
    [ 1,  5,  9, 13, 17, 21, 25, 29, 33, 37, 41],
  ];

  // API pública
  window.renderSeats = function renderSeats(container, schedule, type){
    ensureStyles();
    if (!container) throw new Error('renderSeats: container inválido');

    // estado por instância
    const state = {
      root: container, schedule: schedule || {}, type: (type || 'ida'),
      seats: [], passengers: {}, occupied: []
    };

    // header/infos (opcional)
    const origin = pick(schedule.originName, schedule.origin, schedule.origem, '');
    const dest   = pick(schedule.destinationName, schedule.destination, schedule.destino, '');
    const dataBR = fmtDateBR(schedule.date || '');
    const hora   = pick(schedule.departureTime, schedule.horaPartida, '');

    // ida/volta: restrições e auto-preenchimento
    let maxSelectable = Infinity;
    let paxFromOutbound = [];
    if (state.type === 'volta') {
      const snap = loadOutboundSnapshot();
      maxSelectable = snap.cnt || 0;
      paxFromOutbound = snap.pax || [];
    }

    // scaffold de UI
    state.root.classList.add('seats-card');
    state.root.innerHTML = `
      <div class="bus-wrap">
        <img src="bus-blank.png" alt="Layout do ônibus" class="bus-img" />
        <div class="grid" data-el="grid"></div>
      </div>

      <div class="legend">
        <div class="i"><span class="sw free"></span> Disponível</div>
        <div class="i"><span class="sw sel"></span> Selecionado</div>
        <div class="i"><span class="sw occ"></span> Ocupado</div>
      </div>

      <p class="mute" style="margin:6px 0 2px">
        <b>${origin}</b> → <b>${dest}</b> — ${dataBR} às ${hora} (${state.type})
      </p>
      <p style="margin-top:2px">Poltronas selecionadas: <b data-el="count">0</b></p>

      <div class="pax-row" data-el="pax-row">
        <div style="margin-bottom:6px"><b>Pol <span data-el="current-seat">—</span>:</b></div>
        <div class="pax-grid">
          <input data-el="pax-name"  type="text" placeholder="Nome" />
          <input data-el="pax-cpf"   type="text" placeholder="CPF" />
          <input data-el="pax-phone" type="text" placeholder="Telefone" />
        </div>
      </div>

      <div class="actions">
        <button class="btn btn-primary" data-el="confirm">Confirmar seleção</button>
        <button class="btn btn-ghost"   data-el="back">Voltar</button>
      </div>
    `;

    // refs rápidas
    const q = (sel) => state.root.querySelector(sel);
    const grid = q('[data-el="grid"]');
    const countEl = q('[data-el="count"]');
    const paxRow  = q('[data-el="pax-row"]');
    const curSeat = q('[data-el="current-seat"]');
    const nameI   = q('[data-el="pax-name"]');
    const cpfI    = q('[data-el="pax-cpf"]');
    const telI    = q('[data-el="pax-phone"]');
    const btnConfirm = q('[data-el="confirm"]');
    const btnBack    = q('[data-el="back"]');

    // ocupa/indisponível (usa dados do schedule.seats igual ao backup)
    const seatsApi = Array.isArray(schedule.seats) ? schedule.seats : [];
    const isUnavailable = (num) => {
      const sData = seatsApi.find(s => Number(s.number) === num);
      const isForcedBlocked = (num === 1 || num === 2);
      const isInactive = sData?.situacao === 3;
      const isOccupied = !!sData?.occupied;
      const isMissing  = !sData;
      return isForcedBlocked || isInactive || isOccupied || isMissing;
    };

    // monta malha com o mesmo mapeamento do backup
    GRID_ROWS.forEach((row, r) => {
      row.forEach((cell, c) => {
        const rowPos = r+1, colPos = c+1;
        if (cell === null) {
          const w = document.createElement('div');
          w.className = 'walkway';
          w.style.gridRowStart = rowPos;
          w.style.gridColumnStart = colPos;
          grid.appendChild(w);
          return;
        }
        const seat = document.createElement('div');
        seat.className = 'seat';
        seat.textContent = String(cell);
        seat.style.gridRowStart = rowPos;
        seat.style.gridColumnStart = colPos;
        if (isUnavailable(cell)) {
          seat.classList.add('occupied');
          seat.setAttribute('aria-disabled','true');
          grid.appendChild(seat);
          return;
        }
        seat.addEventListener('click', () => {
          const i = state.seats.indexOf(cell);
          if (i>=0){
            state.seats.splice(i,1);
            seat.classList.remove('selected');
            delete state.passengers[cell];
            updatePaxEditor();
          }else{
            if (state.type==='volta' && state.seats.length >= maxSelectable){
              alert(`Para a volta selecione no máximo ${maxSelectable} poltronas (mesma quantidade da ida).`);
              return;
            }
            state.seats.push(cell);
            seat.classList.add('selected');

            // pré-preenche (volta) na mesma ordem
            if (state.type==='volta' && paxFromOutbound.length){
              const idx = state.seats.length - 1;
              const src = paxFromOutbound[idx];
              if (src) state.passengers[cell] = {name:src.name||'', cpf:src.cpf||'', phone:src.phone||''};
            } else {
              state.passengers[cell] = state.passengers[cell] || {name:'', cpf:'', phone:''};
            }
            updatePaxEditor();
          }
          countEl.textContent = state.seats.length;
        });
        grid.appendChild(seat);
      });
    });

    function updatePaxEditor(){
      const last = state.seats[state.seats.length - 1];
      if (!last){ paxRow.style.display='none'; return; }
      paxRow.style.display='';
      curSeat.textContent = last;
      const data = state.passengers[last] || {name:'', cpf:'', phone:''};
      nameI.value = data.name || ''; cpfI.value = data.cpf || ''; telI.value = data.phone || '';
    }
    function bindPaxInputs(){
      const write = () => {
        const last = state.seats[state.seats.length-1];
        if (!last) return;
        (state.passengers[last] ||= {}).name  = nameI.value;
        (state.passengers[last] ||= {}).cpf   = cpfI.value;
        (state.passengers[last] ||= {}).phone = telI.value;
      };
      nameI.addEventListener('input', write);
      cpfI.addEventListener('input', write);
      telI.addEventListener('input', write);
    }
    bindPaxInputs();

    btnConfirm.addEventListener('click', () => {
      if (state.type==='volta' && state.seats.length !== maxSelectable){
        alert(`Selecione ${maxSelectable} poltronas para a volta.`);
        return;
      }
      const falta = state.seats.some(n => !state.passengers[n] || !state.passengers[n].name);
      if (falta){ alert('Preencha o nome de todos os passageiros.'); return; }

      const passengers = state.seats.map(n => ({ seatNumber:n, ...(state.passengers[n]||{}) }));

      // salva snapshot da ida (para usar na volta)
      if (state.type==='ida') saveOutboundSnapshot(passengers);

      // Emite evento para o host (main.js coleta e segue o fluxo)
      state.root.dispatchEvent(new CustomEvent('seats:confirm', {
        detail: { seats: state.seats.slice(), passengers, schedule: state.schedule, type: state.type }
      }));
    });

    btnBack.addEventListener('click', () => {
      state.root.dispatchEvent(new CustomEvent('seats:back'));
    });

    // retorna mini-API e facilita destruir
    return {
      getSelected: () => state.seats.slice(),
      getPassengers: () => state.seats.map(n => ({ seatNumber:n, ...(state.passengers[n]||{}) })),
      destroy(){ container.innerHTML=''; }
    };
  };

  window.destroySeats = function(container){
    if (container) container.innerHTML = '';
  };
})();
