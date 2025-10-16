// seats.js — Seleção de poltronas (1 tela) autossuficiente
// Monta a UI inteira dentro do container, independentemente do HTML.

(() => {
  // ====== Ajustes finos do encaixe (ajuste 1–3px se necessário) ======
  const TOP_OFFSET  = 31;   // px (sobe/desce a grade sobre o bus-blank)
  const LEFT_OFFSET = 130;  // px (empurra grade p/ direita/esquerda)
  const CELL_W = 40;        // largura da célula (assento)
  const CELL_H = 30;        // altura da célula
  const GAP_X  = 15;        // espaço horizontal entre assentos
  const GAP_Y  = 10;        // espaço vertical entre assentos

  // malha que encaixa com o bus-blank.png (5 linhas x 11 colunas)
  const GRID = [
    [ 3,  7, 11, 15, 19, 23, 27, 31, 35, 39, null],
    [ 4,  8, 12, 16, 20, 24, 28, 32, 36, 40, null],
    [null,null,null,null,null,null,null,null,null,null,null],
    [ 2,  6, 10, 14, 18, 22, 26, 30, 34, 38, 42],
    [ 1,  5,  9, 13, 17, 21, 25, 29, 33, 37, 41],
  ];

  // ===== estilos mínimos do componente (isolados) =====
  const STYLE_ID = 'seats-onepage-style';
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
:root{ --brand:#0b5a2b; --brand-700:#094a24; }

.seats-onepage .bus-wrap{ position:relative; overflow:hidden; }
.seats-onepage .bus-img{ max-width:100%; height:auto; display:block; }

.seats-onepage .bus-grid{
  position:absolute;
  top:${TOP_OFFSET}px; left:${LEFT_OFFSET}px;
  display:grid;
  grid-template-columns: repeat(11, ${CELL_W}px);
  grid-auto-rows: ${CELL_H}px;
  column-gap:${GAP_X}px; row-gap:${GAP_Y}px;
  z-index: 2;
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

/* === LEGENDA (maior e centralizada) === */
.seats-onepage .legend{
  display:flex; justify-content:center; align-items:center;
  gap:24px; margin:14px 0 12px; color:#2a3b2a; font-size:1rem;
}
.seats-onepage .legend .dot{
  display:inline-block; width:20px; height:16px; border-radius:4px;
  border:1px solid #d8ead8; background:#eaf5ea; margin-right:8px;
}
.seats-onepage .legend .sel{ background:#0b5a2b; border-color:#094a24 }
.seats-onepage .legend .occ{ background:#cfd6cf; border-color:#cfd6cf }

/* info da viagem em negrito */
.seats-onepage .info-line{ margin:6px 0 4px; color:#2a3b2a; font-weight:700; }
/* contador em negrito também */
.seats-onepage .counter{ margin-bottom:10px; font-weight:700; }

.seats-onepage .actions{ display:flex; gap:10px; margin-top:12px; }
.seats-onepage .btn{ padding:8px 14px; border-radius:6px; border:1px solid transparent; cursor:pointer; }
.seats-onepage .btn-primary{ background:var(--brand); color:#fff; }
.seats-onepage .btn-ghost{ background:#e9ecef; color:#222; }

/* Seus elementos de passageiros (usa suas classes existentes) */
.seats-onepage .passenger-container{ margin-top:10px; }
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

  // ida/volta (snapshot de passageiros)
  function saveOutboundSnapshot(passengers) {
    localStorage.setItem('outboundPassengers', JSON.stringify(passengers));
    localStorage.setItem('outboundSeatCount', String(passengers.length));
  }
  function loadOutboundSnapshot() {
    const pax = JSON.parse(localStorage.getItem('outboundPassengers') || '[]');
    const cnt = Number(localStorage.getItem('outboundSeatCount') || 0) || pax.length;
    return { pax, cnt };
  }

  // >>> DETECÇÃO ROBUSTA DE EXECUTIVO <<<
  function isExecutive(schedule){
    // 1) Varre o objeto inteiro por palavras-chave (cobre variações de campos)
    const textAll = JSON.stringify(schedule ?? {}).toLowerCase();
    if (textAll.includes('executivo') || textAll.includes('semi') && textAll.includes('leito') || textAll.includes('leito')) return true;
    if (textAll.includes('convenc')) return false;

    // 2) Heurística com a lista de assentos (se houver)
    const toNum = (x) => {
      if (x == null) return 0;
      if (typeof x === 'object' && 'number' in x) return Number(x.number) || 0;
      return Number(x) || 0;
    };
    const maxSeat =
      Array.isArray(schedule?.seats) && schedule.seats.length
        ? Math.max(...schedule.seats.map(toNum), 0)
        : 0;

    if (maxSeat > 28) return true;
    if (maxSeat > 0 && maxSeat <= 28) return false;

    // 3) Fallback: se não dá pra inferir, NÃO limita por 28 (assume executivo)
    // Preferimos não bloquear indevidamente.
    return true;
  }

  // ===== API pública =====
  window.renderSeats = function renderSeats(container, schedule, wayType){
    ensureStyles();
    if (!container) throw new Error('renderSeats: container inválido');

    container.classList.add('seats-onepage');
    container.innerHTML = `
      <div class="bus-wrap">
        <img src="bus-blank.png" alt="Layout do ônibus" class="bus-img" />
        <div class="bus-grid" id="busGrid"></div>
      </div>

      <div class="legend">
        <div><span class="dot"></span> Disponível</div>
        <div><span class="dot sel"></span> Selecionado</div>
        <div><span class="dot occ"></span> Ocupado</div>
      </div>

      <div class="info-line"><span id="tripInfo"></span></div>
      <div class="counter"><b>Poltronas selecionadas:</b> <span id="selCount">0</span></div>

      <!-- usa as SUAS classes do CSS -->
      <div class="passenger-container" id="paxBox" style="display:none">
        <div class="pax-table" id="paxList"></div>
      </div>

      <div class="actions">
        <button class="btn btn-primary" id="btnConfirm">Confirmar seleção</button>
        <button class="btn btn-ghost"   id="btnBack">Voltar</button>
      </div>
    `;

    // refs
    const gridEl     = container.querySelector('#busGrid');
    const tripInfoEl = container.querySelector('#tripInfo');
    const selCountEl = container.querySelector('#selCount');
    const paxBox     = container.querySelector('#paxBox');
    const paxListEl  = container.querySelector('#paxList');
    const btnConfirm = container.querySelector('#btnConfirm');
    const btnBack    = container.querySelector('#btnBack');

    // cabeçalho (em negrito via CSS .info-line)
    const origin = pick(schedule.originName, schedule.origin, schedule.origem, '');
    const dest   = pick(schedule.destinationName, schedule.destination, schedule.destino, '');
    const dateBR = fmtDateBR(schedule.date || '');
    const time   = pick(schedule.departureTime, schedule.horaPartida, '');
    tripInfoEl.innerHTML = `<b>${origin} → ${dest} — ${dateBR} às ${time} (${wayType||'ida'})</b>`;

    // estado
    const state = {
      type: (wayType || 'ida'),
      schedule: schedule || {},
      exec: isExecutive(schedule),
      seats: [],
      pax: {}           // { poltrona: {name, cpf, phone} }
    };

    // dados opcionais de assento vindos da API (ocupado/ativo)
    const seatData = Array.isArray(schedule?.seats) ? schedule.seats : [];

    const isSeatBlocked = (num) => {
      if (num === 1 || num === 2) return true;            // regra fixa
      // >>> BLOQUEIA >28 APENAS SE NÃO FOR EXECUTIVO <<<
      if (!state.exec && num > 28) return true;

      const sd = seatData.find(s => {
        const n = (typeof s === 'object' && 'number' in s) ? Number(s.number) : Number(s);
        return n === num;
      });
      if (!sd) return false;                              // sem dado => livre
      if (typeof sd === 'object') {
        if (Number(sd.situacao) === 3) return true;       // inativo
        if (sd.occupied === true) return true;            // ocupado
      }
      return false;
    };

    // volta: trava quantidade e pré-preenche
    let maxSelectable = Infinity;
    let obPax = [];
    if (state.type === 'volta'){
      const snap = loadOutboundSnapshot();
      maxSelectable = snap.cnt || 0;
      obPax = snap.pax || [];
    }

    // ===== desenha grid de assentos
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
            // removendo
            state.seats.splice(i,1);
            seat.classList.remove('selected');
            delete state.pax[cell];
            renderPaxList();
          }else{
            // adicionando
            if (state.type==='volta' && state.seats.length >= maxSelectable){
              alert(`Para a volta selecione exatamente ${maxSelectable} poltronas.`);
              return;
            }
            state.seats.push(cell);
            seat.classList.add('selected');

            // pré-preenche na volta pela ordem
            if (state.type==='volta' && obPax.length){
              const idx = state.seats.length - 1;
              const src = obPax[idx];
              if (src) state.pax[cell] = { name:src.name||'', cpf:src.cpf||'', phone:src.phone||'' };
            } else {
              state.pax[cell] ||= { name:'', cpf:'', phone:'' };
            }
            renderPaxList();
          }
          selCountEl.textContent = String(state.seats.length);
        });

        gridEl.appendChild(seat);
      });
    });

    // ===== renderiza TODAS as linhas de passageiros (usa SUAS classes de CSS)
    function renderPaxList(){
      const show = state.seats.length > 0;
      paxBox.style.display = show ? 'block' : 'none'; // força visibilidade
      paxListEl.innerHTML = '';
      if (!show) return;

      // ordena poltronas para formulário ficar previsível
      const ordered = state.seats.slice().sort((a,b)=>a-b);

      ordered.forEach(num=>{
        const d = state.pax[num] || (state.pax[num] = { name:'', cpf:'', phone:'' });

        const row = document.createElement('div');
        row.className = 'passenger-row';
        row.innerHTML = `
          <span class="seat-label">Pol ${num}</span>
          <input type="text" name="name"  placeholder="Nome"     value="${d.name  || ''}" data-field="name"  data-seat="${num}" />
          <input type="text" name="cpf"   placeholder="CPF"      value="${d.cpf   || ''}" data-field="cpf"   data-seat="${num}" />
          <input type="text" name="phone" placeholder="Telefone" value="${d.phone || ''}" data-field="phone" data-seat="${num}" />
        `;

        row.querySelectorAll('input').forEach(inp=>{
          inp.addEventListener('input', (ev)=>{
            const seat  = Number(ev.target.getAttribute('data-seat'));
            const field = ev.target.getAttribute('data-field');
            (state.pax[seat] ||= {})[field] = ev.target.value;
          });
        });

        paxListEl.appendChild(row);
      });
    }

    // ===== ações
    btnConfirm.addEventListener('click', () => {
      if (state.type==='volta' && isFinite(maxSelectable) && state.seats.length !== maxSelectable){
        alert(`Selecione exatamente ${maxSelectable} poltronas para a volta.`);
        return;
      }
      if (!state.seats.length){
        alert('Selecione ao menos uma poltrona.');
        return;
      }
      const faltaNome = state.seats.some(n => !state.pax[n] || !state.pax[n].name);
      if (faltaNome){
        alert('Preencha o nome de todos os passageiros.');
        return;
      }

      const passengers = state.seats
        .slice()
        .sort((a,b)=>a-b)
        .map(n => ({ seatNumber:n, ...(state.pax[n]||{}) }));

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
