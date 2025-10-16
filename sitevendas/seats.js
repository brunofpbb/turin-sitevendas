// seats.js — Seleção de poltronas (1 tela) autossuficiente
// Monta a UI inteira dentro do container, independentemente do HTML.

(() => {
  // ====== Ajustes finos do encaixe (se quiser, mexa 1–3px) ======
  const TOP_OFFSET  = 28;   // px (sobe/desce a grade sobre o bus-blank)
  const LEFT_OFFSET = 150;  // px (empurra grade p/ direita/esquerda)
  const CELL_W = 40;        // largura da célula (assento)
  const CELL_H = 30;        // altura da célula
  const GAP_X  = 15;        // espaço horizontal entre assentos
  const GAP_Y  = 10;         // espaço vertical entre assentos

  // malha que encaixa com o bus-blank.png (5 linhas x 11 colunas)
  const GRID = [
    [ 3,  7, 11, 15, 19, 23, 27, 31, 35, 39, null],
    [ 4,  8, 12, 16, 20, 24, 28, 32, 36, 40, null],
    [null,null,null,null,null,null,null,null,null,null,null],
    [ 2,  6, 10, 14, 18, 22, 26, 30, 34, 38, 42],
    [ 1,  5,  9, 13, 17, 21, 25, 29, 33, 37, 41],
  ];

  // ===== estilos isolados do componente =====
  const STYLE_ID = 'seats-onepage-style';
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
:root{ --brand:#0b5a2b; --brand-700:#094a24; }

.seats-onepage { }
.seats-onepage .bus-wrap{ position:relative; overflow:hidden; }
.seats-onepage .bus-img{ max-width:100%; height:auto; display:block; }

.seats-onepage .bus-grid{
  position:absolute;
  top:${TOP_OFFSET}px; left:${LEFT_OFFSET}px;
  display:grid;
  grid-template-columns: repeat(11, ${CELL_W}px);
  grid-auto-rows: ${CELL_H}px;
  column-gap:${GAP_X}px; row-gap:${GAP_Y}px;
}

.seats-onepage .seat{
  background:#eaf5ea; color:#1a301a;
  border:1px solid #d8ead8; border-radius:6px;
  min-width:${CELL_W}px; height:${CELL_H}px;
  line-height:${CELL_H-2}px;
  font-size:12px; text-align:center; user-select:none; cursor:pointer;
}
.seats-onepage .seat.selected{
  background:var(--brand) !important; color:#fff !important; border-color:var(--brand-700) !important;
}
.seats-onepage .seat.disabled{
  background:#cfd6cf !important; color:#666 !important; border-color:#cfd6cf !important; cursor:not-allowed;
}
.seats-onepage .walkway{ width:${CELL_W}px; height:${CELL_H}px; opacity:0; }

.seats-onepage .legend{ display:flex; align-items:center; gap:18px; margin:14px 0 6px; }
.seats-onepage .legend .i{ display:flex; align-items:center; gap:8px; font-size:.95rem; color:#2a3b2a; }
.seats-onepage .legend .sw{ width:16px; height:16px; border-radius:4px; border:1px solid #d8ead8; }
.seats-onepage .sw.free{ background:#eaf5ea; }
.seats-onepage .sw.sel{ background:var(--brand); border-color:var(--brand-700); }
.seats-onepage .sw.occ{ background:#cfd6cf; border-color:#cfd6cf; }

.seats-onepage .info-line{ margin:6px 0 4px; color:#2a3b2a; }
.seats-onepage .counter{ margin-bottom:8px; }

.seats-onepage .pax { display:none; margin-top:6px; }
.seats-onepage .pax-grid{ display:grid; grid-template-columns: 1.6fr 1fr 1fr; gap:10px; }

.seats-onepage .actions{ display:flex; gap:10px; margin-top:12px; }
.seats-onepage .btn{ padding:8px 14px; border-radius:6px; border:1px solid transparent; cursor:pointer; }
.seats-onepage .btn-primary{ background:var(--brand); color:#fff; }
.seats-onepage .btn-ghost{ background:#e9ecef; color:#222; }
    `.trim();
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  const pick = (...v) => v.find(x => x !== undefined && x !== null && x !== '') ?? '';
  const fmtDateBR = (iso) => {
    if (!iso || !iso.includes('-')) return iso || '';
    const [Y,M,D] = iso.split('-'); return `${D}/${M}/${Y}`;
  };

  // ida/volta
  function saveOutboundSnapshot(passengers) {
    localStorage.setItem('outboundPassengers', JSON.stringify(passengers));
    localStorage.setItem('outboundSeatCount', String(passengers.length));
  }
  function loadOutboundSnapshot() {
    const pax = JSON.parse(localStorage.getItem('outboundPassengers') || '[]');
    const cnt = Number(localStorage.getItem('outboundSeatCount') || 0) || pax.length;
    return { pax, cnt };
  }

  function isExecutive(schedule){
    const t = (pick(schedule?.category, schedule?.tipo, schedule?.busType, '')+'').toLowerCase();
    if (t.includes('exec')) return true;
    if (t.includes('convenc')) return false;
    const label = (schedule?.classLabel || schedule?.service || '')+'';
    if (label.toLowerCase().includes('exec')) return true;
    return false;
  }

  // ===== API pública =====
  window.renderSeats = function renderSeats(container, schedule, wayType){
    ensureStyles();
    if (!container) throw new Error('renderSeats: container inválido');

    // limpa e monta a estrutura completa
    container.classList.add('seats-onepage');
    container.innerHTML = `
      <div class="bus-wrap">
        <img src="bus-blank.png" alt="Layout do ônibus" class="bus-img" />
        <div class="bus-grid" id="busGrid"></div>
      </div>

      <div class="legend">
        <div class="i"><span class="sw free"></span> Disponível</div>
        <div class="i"><span class="sw sel"></span> Selecionado</div>
        <div class="i"><span class="sw occ"></span> Ocupado</div>
      </div>

      <div class="info-line" id="tripInfo"></div>
      <div class="counter">Poltronas selecionadas: <b id="selCount">0</b></div>

      <div class="pax" id="paxBox">
        <div style="margin-bottom:6px"><b>Pol <span id="curSeat">—</span>:</b></div>
        <div class="pax-grid">
          <input id="paxName"  type="text" placeholder="Nome" />
          <input id="paxCpf"   type="text" placeholder="CPF" />
          <input id="paxPhone" type="text" placeholder="Telefone" />
        </div>
      </div>

      <div class="actions">
        <button class="btn btn-primary" id="btnConfirm">Confirmar seleção</button>
        <button class="btn btn-ghost"   id="btnBack">Voltar</button>
      </div>
    `;

    // refs
    const gridEl   = container.querySelector('#busGrid');
    const tripInfo = container.querySelector('#tripInfo');
    const selCount = container.querySelector('#selCount');
    const paxBox   = container.querySelector('#paxBox');
    const curSeat  = container.querySelector('#curSeat');
    const nameI    = container.querySelector('#paxName');
    const cpfI     = container.querySelector('#paxCpf');
    const phoneI   = container.querySelector('#paxPhone');
    const btnConfirm = container.querySelector('#btnConfirm');
    const btnBack    = container.querySelector('#btnBack');

    // infos do topo
    const origin = pick(schedule.originName, schedule.origin, schedule.origem, '');
    const dest   = pick(schedule.destinationName, schedule.destination, schedule.destino, '');
    const dateBR = fmtDateBR(schedule.date || '');
    const time   = pick(schedule.departureTime, schedule.horaPartida, '');

    tripInfo.textContent = `${origin} → ${dest} — ${dateBR} às ${time} (${wayType||'ida'})`;

    const state = {
      type: (wayType || 'ida'),
      schedule: schedule || {},
      exec: isExecutive(schedule),
      seats: [],
      pax: {}
    };

    const seatData = Array.isArray(schedule?.seats) ? schedule.seats : [];

    const isSeatBlocked = (num) => {
      if (num === 1 || num === 2) return true;            // regra fixa
      if (!state.exec && num > 28) return true;           // convencional: >28 bloqueia
      const sd = seatData.find(s => Number(s.number) === num);
      if (!sd) return false;                              // sem dado => livre
      if (Number(sd.situacao) === 3) return true;         // inativo
      if (sd.occupied === true) return true;              // ocupado
      return false;
    };

    // volta: trava qte e pré-preenche
    let maxSelectable = Infinity;
    let obPax = [];
    if (state.type === 'volta'){
      const snap = loadOutboundSnapshot();
      maxSelectable = snap.cnt || 0;
      obPax = snap.pax || [];
    }

    // desenha grid
    GRID.forEach((row, r) => {
      row.forEach((cell, c) => {
        const rr = r+1, cc = c+1;
        if (cell === null){
          const w = document.createElement('div');
          w.className = 'walkway';
          w.style.gridRowStart = rr;
          w.style.gridColumnStart = cc;
          gridEl.appendChild(w);
          return;
        }
        const seat = document.createElement('div');
        seat.className = 'seat';
        seat.textContent = String(cell);
        seat.style.gridRowStart = rr;
        seat.style.gridColumnStart = cc;

        if (isSeatBlocked(cell)){
          seat.classList.add('disabled');
          seat.setAttribute('aria-disabled','true');
          gridEl.appendChild(seat);
          return;
        }

        seat.addEventListener('click', () => {
          const i = state.seats.indexOf(cell);
          if (i>=0){
            state.seats.splice(i,1);
            seat.classList.remove('selected');
            delete state.pax[cell];
            updatePax();
          }else{
            if (state.type==='volta' && state.seats.length >= maxSelectable){
              alert(`Para a volta selecione exatamente ${maxSelectable} poltronas.`);
              return;
            }
            state.seats.push(cell);
            seat.classList.add('selected');
            // pré-preenche na volta
            if (state.type==='volta' && obPax.length){
              const idx = state.seats.length - 1;
              const src = obPax[idx];
              if (src) state.pax[cell] = { name:src.name||'', cpf:src.cpf||'', phone:src.phone||'' };
            } else {
              state.pax[cell] ||= { name:'', cpf:'', phone:'' };
            }
            updatePax();
          }
          selCount.textContent = String(state.seats.length);
        });

        gridEl.appendChild(seat);
      });
    });

    function updatePax(){
      const last = state.seats[state.seats.length-1];
      if (!last){ paxBox.style.display='none'; return; }
      paxBox.style.display = '';
      curSeat.textContent = last;
      const d = state.pax[last] || {name:'', cpf:'', phone:''};
      nameI.value  = d.name  || '';
      cpfI.value   = d.cpf   || '';
      phoneI.value = d.phone || '';
    }
    function bindInputs(){
      const w = () => {
        const last = state.seats[state.seats.length-1];
        if (!last) return;
        (state.pax[last] ||= {}).name  = nameI.value;
        (state.pax[last] ||= {}).cpf   = cpfI.value;
        (state.pax[last] ||= {}).phone = phoneI.value;
      };
      nameI.addEventListener('input', w);
      cpfI.addEventListener('input', w);
      phoneI.addEventListener('input', w);
    }
    bindInputs();

    // botões na ordem correta
    btnConfirm.addEventListener('click', () => {
      if (state.type==='volta' && isFinite(maxSelectable) && state.seats.length !== maxSelectable){
        alert(`Selecione exatamente ${maxSelectable} poltronas para a volta.`);
        return;
      }
      const falta = state.seats.some(n => !state.pax[n] || !state.pax[n].name);
      if (falta){ alert('Preencha o nome de todos os passageiros.'); return; }
      const passengers = state.seats.map(n => ({ seatNumber:n, ...(state.pax[n]||{}) }));
      if (state.type==='ida') saveOutboundSnapshot(passengers);

      container.dispatchEvent(new CustomEvent('seats:confirm', {
        detail: { seats: state.seats.slice(), passengers, schedule: state.schedule, type: state.type }
      }));
    });

    btnBack.addEventListener('click', () => {
      container.dispatchEvent(new CustomEvent('seats:back'));
    });
  };

  window.destroySeats = function(container){
    if (container) container.innerHTML = '';
  };
})();
