// seats.js — componente embarcado com export window.renderSeats(container, schedule, type)
(() => {
  // ======= estilos mínimos (aplicados uma vez) =======
  const STYLE_ID = 'seats-component-style';
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
:root{ --brand:#0b5a2b; --brand-700:#094a24; }
.seat { background:#eaf5ea; color:#1a301a; border:1px solid #d8ead8; border-radius:6px; min-width:30px; height:22px; line-height:20px; font-size:12px; text-align:center; cursor:pointer; user-select:none; }
.seat:hover{ filter:brightness(.98); }
.seat.selected{ background:var(--brand) !important; color:#fff !important; border-color:var(--brand-700) !important; }
.seat.disabled{ background:#cfd6cf !important; color:#666 !important; border-color:#cfd6cf !important; cursor:not-allowed; }
.seat-legend{ display:flex; align-items:center; gap:18px; margin:10px 0 4px; }
.seat-legend .item{ display:flex; align-items:center; gap:8px; font-size:.95rem; color:#2a3b2a; }
.seat-legend .swatch{ width:16px; height:16px; border-radius:4px; border:1px solid #d8ead8; }
.swatch--free{ background:#eaf5ea; }
.swatch--selected{ background:var(--brand); border-color:var(--brand-700); }
.swatch--occupied{ background:#cfd6cf; border-color:#cfd6cf; }
.bus-grid{ display:grid; grid-template-columns: repeat(11, 36px); grid-auto-rows:26px; gap:8px 10px; margin:0 18px 0 140px; }
.seat-actions{ display:flex; gap:10px; margin-top:10px; }
.mute{ color:#667766; }
.auth-card .btn{ min-width: 140px; }
    `.trim();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ======= estado do componente (por instância) =======
  function createState(rootEl, schedule, tripType) {
    return {
      root: rootEl,
      schedule: schedule || {},
      type: (typeof tripType === 'string' ? tripType : (tripType && tripType.type)) || 'ida', // 'ida' | 'volta'
      seats: [],
      occupied: [],              // ajuste aqui se você trouxer do serviço
      passengers: {},            // { [seatNumber]: {name, cpf, phone} }
      maxSelectable: Infinity,   // limitado na volta
      passengersFromOutbound: [] // preenchidos da ida
    };
  }

  // ======= util =======
  const $  = (r) => (q) => r.querySelector(q);
  const $$ = (r) => (q) => Array.from(r.querySelectorAll(q));
  const fmtDateBR = (iso) => {
    if (!iso || !iso.includes('-')) return iso || '';
    const [Y,M,D] = iso.split('-');
    return `${D}/${M}/${Y}`;
  };

  // ======= carrega snapshot da ida para configurar a volta =======
  function loadOutboundDataForReturn(state){
    if (state.type !== 'volta') return;
    const ps = JSON.parse(localStorage.getItem('outboundPassengers') || '[]');
    const cnt = Number(localStorage.getItem('outboundSeatCount') || 0) || ps.length;
    state.passengersFromOutbound = ps;
    state.maxSelectable = Math.max(0, cnt) || ps.length || 0;
  }
  function saveOutboundSnapshotIfNeeded(state){
    if (state.type !== 'ida') return;
    const pax = Object.values(state.passengers).filter(p => p && p.name);
    if (!pax.length) return;
    localStorage.setItem('outboundPassengers', JSON.stringify(pax));
    localStorage.setItem('outboundSeatCount', String(pax.length));
  }

  // ======= grade de poltronas (exemplo 42 lugares) =======
  const TOTAL_SEATS = 42;

  function renderScaffold(state){
    const r$ = $(state.root);
    state.root.innerHTML = `
      <div class="bus-layout" style="position:relative; overflow:hidden;">
        <img src="bus-blank.png" alt="Layout do ônibus" class="bus-image" style="max-width:100%; height:auto;" />
        <div class="bus-grid" data-el="grid" style="position:absolute; top:0; left:0;"></div>
      </div>

      <div class="seat-legend" data-el="legend"></div>

      <p style="margin-top:10px">
        Poltronas selecionadas: <b data-el="count">0</b>
      </p>

      <div data-el="pax-row" style="display:none; margin-top:8px">
        <div style="margin-bottom:6px"><b>Pol <span data-el="current-seat">—</span>:</b></div>
        <div class="grid-row" style="display:grid; grid-template-columns: 1.5fr 1fr 1fr; gap:10px">
          <input data-el="pax-name"  type="text" placeholder="Nome" />
          <input data-el="pax-cpf"   type="text" placeholder="CPF" />
          <input data-el="pax-phone" type="text" placeholder="Telefone" />
        </div>
      </div>

      <div class="seat-actions" data-el="actions">
        <button data-el="confirm" class="btn btn-primary">Confirmar seleção</button>
        <button data-el="back"    class="btn btn-ghost">Voltar</button>
      </div>
    `;

    // legenda
    const legend = r$('[data-el="legend"]');
    legend.innerHTML = `
      <div class="item"><span class="swatch swatch--free"></span> Disponível</div>
      <div class="item"><span class="swatch swatch--selected"></span> Selecionado</div>
      <div class="item"><span class="swatch swatch--occupied"></span> Ocupado</div>
    `;
  }

  function renderGrid(state){
    const r$ = $(state.root);
    const grid = r$('[data-el="grid"]');
    grid.innerHTML = '';
    for (let n=1; n<=TOTAL_SEATS; n++){
      const d = document.createElement('div');
      d.className = 'seat';
      d.textContent = String(n);
      if (state.occupied.includes(n)) d.classList.add('disabled');
      if (!d.classList.contains('disabled')) {
        d.addEventListener('click', () => toggleSeat(state, n, d));
      }
      grid.appendChild(d);
    }
  }

  function toggleSeat(state, n, el){
    const r$ = $(state.root);
    const countEl = r$('[data-el="count"]');
    const paxRow  = r$('[data-el="pax-row"]');
    const curSeat = r$('[data-el="current-seat"]');
    const nameI   = r$('[data-el="pax-name"]');
    const cpfI    = r$('[data-el="pax-cpf"]');
    const telI    = r$('[data-el="pax-phone"]');

    const idx = state.seats.indexOf(n);
    if (idx >= 0){
      state.seats.splice(idx,1);
      el.classList.remove('selected');
      delete state.passengers[n];
      countEl.textContent = state.seats.length;
      // se removeu o último em edição, esconde linha
      const last = state.seats[state.seats.length - 1];
      if (!last) paxRow.style.display = 'none';
      else {
        curSeat.textContent = last;
        const data = state.passengers[last] || {name:'', cpf:'', phone:''};
        nameI.value = data.name || ''; cpfI.value = data.cpf || ''; telI.value = data.phone || '';
      }
      return;
    }
    // limite na volta
    if (state.type === 'volta' && state.seats.length >= state.maxSelectable){
      alert(`Para a volta, selecione no máximo ${state.maxSelectable} poltronas (mesma quantidade da ida).`);
      return;
    }
    state.seats.push(n);
    el.classList.add('selected');
    countEl.textContent = state.seats.length;

    // pré-preenche (volta)
    if (state.type === 'volta' && state.passengersFromOutbound.length){
      const i = state.seats.length - 1;
      const src = state.passengersFromOutbound[i];
      if (src){
        state.passengers[n] = { name: src.name || '', cpf: src.cpf || '', phone: src.phone || '' };
      }
    } else {
      state.passengers[n] = state.passengers[n] || { name:'', cpf:'', phone:'' };
    }

    paxRow.style.display = '';
    curSeat.textContent = n;
    const data = state.passengers[n] || {name:'', cpf:'', phone:''};
    nameI.value = data.name || ''; cpfI.value = data.cpf || ''; telI.value = data.phone || '';
  }

  function bindPassengerInputs(state){
    const r$ = $(state.root);
    const nameI = r$('[data-el="pax-name"]');
    const cpfI  = r$('[data-el="pax-cpf"]');
    const telI  = r$('[data-el="pax-phone"]');

    const write = () => {
      const current = state.seats[state.seats.length - 1];
      if (!current) return;
      (state.passengers[current] ||= {}).name  = nameI.value;
      (state.passengers[current] ||= {}).cpf   = cpfI.value;
      (state.passengers[current] ||= {}).phone = telI.value;
    };
    nameI.addEventListener('input', write);
    cpfI.addEventListener('input', write);
    telI.addEventListener('input', write);
  }

  function wireActions(state){
    const r$ = $(state.root);
    const btnConfirm = r$('[data-el="confirm"]');
    const btnBack    = r$('[data-el="back"]');

    btnConfirm.addEventListener('click', () => {
      if (state.type === 'volta' && state.seats.length !== state.maxSelectable){
        alert(`Selecione ${state.maxSelectable} poltronas para a volta.`);
        return;
      }
      const miss = state.seats.some(n => !state.passengers[n] || !state.passengers[n].name);
      if (miss){
        alert('Preencha o nome de todos os passageiros.');
        return;
      }

      // salva snapshot da ida p/ volta
      saveOutboundSnapshotIfNeeded(state);

      // emite evento para o host (main.js pode escutar)
      const detail = {
        seats: state.seats.slice(),
        passengers: state.seats.map(n => ({ seatNumber:n, ...(state.passengers[n]||{}) })),
        schedule: state.schedule,
        type: state.type
      };
      state.root.dispatchEvent(new CustomEvent('seats:confirm', { detail }));
    });

    btnBack.addEventListener('click', () => {
      state.root.dispatchEvent(new CustomEvent('seats:back'));
    });
  }

  // ======= API pública esperada pelo main.js =======
  // window.renderSeats(containerEl, schedule, type)
  window.renderSeats = function(container, schedule, type){
    ensureStyles();
    if (!container) throw new Error('renderSeats: container inválido');

    const state = createState(container, schedule, type);
    loadOutboundDataForReturn(state);

    renderScaffold(state);
    renderGrid(state);
    bindPassengerInputs(state);
    wireActions(state);

    // retorna uma mini API (opcional)
    return {
      getSelected: () => state.seats.slice(),
      getPassengers: () => state.seats.map(n => ({ seatNumber:n, ...(state.passengers[n]||{}) })),
      destroy(){ container.innerHTML = ''; }
    };
  };

  // opcional: permitir limpeza externa
  window.destroySeats = function(container){
    if (container) container.innerHTML = '';
  };
})();
