// seats.js — Seleção de poltronas (1 tela) AUTOSSUFICIENTE
(() => {
  // ===== Ajustes finos do encaixe (ajuste 1–3px se necessário) =====
  const TOP_OFFSET  = 22;   // px (sobe/desce a grade sobre o bus-blank)
  const LEFT_OFFSET = 105;  // px (empurra grade p/ direita/esquerda)
  const CELL_W = 45;        // largura da célula (assento)
  const CELL_H = 35;        // altura da célula
  const GAP_X  = 15;        // espaço horizontal entre assentos
  const GAP_Y  = 10;        // espaço vertical entre assentos

  const GRID = [
    [ 3,  7, 11, 15, 19, 23, 27, 31, 35, 39, null],
    [ 4,  8, 12, 16, 20, 24, 28, 32, 36, 40, null],
    [null,null,null,null,null,null,null,null,null,null,null],
    [ 2,  6, 10, 14, 18, 22, 26, 30, 34, 38, 42],
    [ 1,  5,  9, 13, 17, 21, 25, 29, 33, 37, 41],
  ];

  const STYLE_ID = 'seats-onepage-style';
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
:root{ --brand:#0b5a2b; --brand-700:#094a24; }
.seats-onepage .bus-wrap{ position:relative; overflow:hidden; }
.seats-onepage .bus-img{ max-width:100%; height:auto; display:block; }
.seats-onepage .bus-grid{
  position:absolute; top:${TOP_OFFSET}px; left:${LEFT_OFFSET}px;
  display:grid; grid-template-columns: repeat(11, ${CELL_W}px);
  grid-auto-rows: ${CELL_H}px; column-gap:${GAP_X}px; row-gap:${GAP_Y}px; z-index:2;
}
.seats-onepage .seat{
  background:#eaf5ea; color:#1a301a; border:1px solid #d8ead8; border-radius:6px;
  min-width:${CELL_W}px; height:${CELL_H}px; line-height:${CELL_H-2}px;
  font-size:12px; text-align:center; user-select:none; cursor:pointer;
}
.seats-onepage .seat.selected{ background:var(--brand)!important; color:#fff!important; border-color:var(--brand-700)!important; }
.seats-onepage .seat.disabled{ background:#cfd6cf!important; color:#666!important; border-color:#cfd6cf!important; cursor:not-allowed; }
.seats-onepage .walkway{ width:${CELL_W}px; height:${CELL_H}px; opacity:0; }

/* Legenda */
.seats-onepage .legend{ display:flex; justify-content:center; align-items:center; gap:24px; margin:14px 0 12px; color:#2a3b2a; font-size:1rem; }
.seats-onepage .legend .dot{ display:inline-block; width:20px; height:16px; border-radius:4px; border:1px solid #d8ead8; background:#eaf5ea; margin-right:8px; }
.seats-onepage .legend .sel{ background:#0b5a2b; border-color:#094a24 }
.seats-onepage .legend .occ{ background:#cfd6cf; border-color:#cfd6cf }

/* Info/contador em negrito */
.seats-onepage .info-line{ margin:6px 0 4px; color:#2a3b2a; font-weight:700; }
.seats-onepage .counter{ margin-bottom:10px; font-weight:700; }

/* Passageiros */
.seats-onepage .passenger-container{ margin-top:12px; margin-bottom:18px; }
.seats-onepage .pax-table{ display:block; }
.seats-onepage .passenger-row{ display:grid; grid-template-columns: 80px 1fr 1fr 1fr; gap:10px; margin-bottom:6px; align-items:center; }
.seats-onepage .passenger-row .seat-label{ font-weight:600; }
.seats-onepage .passenger-row.readonly span.value{ padding:8px 10px; background:#f7f8f8; border:1px solid #e1e4e8; border-radius:6px; }

/* Botões */
.seats-onepage .actions{ display:flex; gap:10px; margin-top:18px; }
.seats-onepage .btn{ padding:8px 14px; border-radius:6px; border:1px solid transparent; cursor:pointer; }
.seats-onepage .btn-primary{ background:var(--brand); color:#fff; }
.seats-onepage .btn-ghost{ background:#e9ecef; color:#222; }
    `.trim();
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ===== helpers =====
  const pick = (...v) => v.find(x => x !== undefined && x !== null && x !== '') ?? '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmtDateBR = (iso) => (!iso || !iso.includes('-')) ? (iso||'') : iso.split('-').reverse().join('/');

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
    const textAll = JSON.stringify(schedule ?? {}).toLowerCase();
    if (textAll.includes('executivo') || textAll.includes('leito')) return true;
    if (textAll.includes('convenc')) return false;

    const toNum = (x) => {
      if (x == null) return 0;
      if (typeof x === 'object' && 'number' in x) return Number(x.number) || 0;
      return Number(x) || 0;
    };
    const arr = Array.isArray(schedule?.seats) ? schedule.seats : [];
    const maxSeat = arr.length ? Math.max(...arr.map(toNum), 0) : 0;
    if (maxSeat > 28) return true;
    if (maxSeat > 0 && maxSeat <= 28) return false;
    return true; // fallback
  }

  // ---------- NORMALIZAÇÃO E DETECÇÃO DO MODO ----------
  const OCC_KEYS_TRUE = ['occupied','ocupado','inuse','reserved','reservado','indisponivel'];
  const DISP_KEYS_BOOL = ['disponivel','available','isavailable','livre','ativo','ativo'];
  const STATUS_KEYS = ['status','situacao','situação','situacaoid','situacaopoltrona'];

  function toLowerNoAcc(x){ return String(x||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase(); }

  function extractNum(o){
    if (typeof o !== 'object') return Number(o) || 0;
    return (
      Number(o.number) || Number(o.Numero) || Number(o.NumeroPoltrona) ||
      Number(o.Poltrona) || Number(o.Caption) || Number(o.caption) || 0
    );
  }

  function inferOccupiedFromObject(o){
    // 1) campos booleanos típicos
    for (const k of Object.keys(o||{})){
      const lk = toLowerNoAcc(k);
      const val = o[k];

      // occupied-like
      if (OCC_KEYS_TRUE.includes(lk) && (val === true || val === 1 || String(val).toLowerCase() === 'true')) return true;

      // disponivel / available
      if (DISP_KEYS_BOOL.includes(lk)){
        if (val === false || val === 0 || String(val).toLowerCase() === 'false') return true;   // não disponível => ocupado
        if (val === true || val === 1 || String(val).toLowerCase() === 'true') return false;     // disponível => livre
      }

      // status/situacao textual/numérica
      if (STATUS_KEYS.includes(lk)){
        if (typeof val === 'number'){
          // Muitas APIs: 0 livre, 1 ocupado, 2/3 reservado/inativo
          if (val !== 0) return true;
          return false;
        } else {
          const txt = toLowerNoAcc(val);
          if (txt.includes('ocup') || txt.includes('reserv') || txt.includes('indisp') || txt.includes('inativ')) return true;
          if (txt.includes('livre') || txt.includes('dispon')) return false;
        }
      }
    }
    return undefined; // não deu pra saber
  }

  function normalizeSeatList(raw){
    if (!Array.isArray(raw)) return { mode:'none', list:[] };

    // Tem “pistas” de status?
    let hasStatusHints = false;
    for (const it of raw){
      if (typeof it === 'object'){
        const ks = Object.keys(it).map(toLowerNoAcc);
        if (ks.some(k => OCC_KEYS_TRUE.includes(k) || DISP_KEYS_BOOL.includes(k) || STATUS_KEYS.includes(k))){
          hasStatusHints = true; break;
        }
      }
    }

    // Se NÃO houver pistas de status e os itens forem números/objetos sem status,
    // vamos assumir que a API mandou **apenas as poltronas LIVRES** (modo 'available-only').
    const normalized = raw.map(it => {
      const number = extractNum(it);
      let occupied;
      if (hasStatusHints) occupied = inferOccupiedFromObject(it);
      return { number, occupied };
    });

    const mode = hasStatusHints ? 'full' : 'available-only'; // full = mapa completo; available-only = só livres
    return { mode, list: normalized.filter(x => Number.isFinite(x.number) && x.number > 0) };
  }

  // ------------------------------------------------------
  window.renderSeats = function renderSeats(container, schedule, wayType){
    ensureStyles();
    if (!container) throw new Error('renderSeats: container inválido');

    // UI base
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

      <div class="passenger-container" id="paxBox" style="display:none">
        <div class="pax-table" id="paxList"></div>
      </div>

      <div class="actions">
        <button class="btn btn-primary" id="btnConfirm">Confirmar seleção</button>
        <button class="btn btn-ghost"   id="btnBack">Voltar</button>
      </div>
    `;

    const gridEl     = container.querySelector('#busGrid');
    const tripInfoEl = container.querySelector('#tripInfo');
    const selCountEl = container.querySelector('#selCount');
    const paxBox     = container.querySelector('#paxBox');
    const paxListEl  = container.querySelector('#paxList');
    const btnConfirm = container.querySelector('#btnConfirm');
    const btnBack    = container.querySelector('#btnBack');

    // Cabeçalho
    const origin = pick(schedule.originName, schedule.origin, schedule.origem, '');
    const dest   = pick(schedule.destinationName, schedule.destination, schedule.destino, '');
    const dateBR = fmtDateBR(schedule.date || '');
    const time   = pick(schedule.departureTime, schedule.horaPartida, '');
    tripInfoEl.innerHTML = `<b>${esc(origin)} → ${esc(dest)} — ${esc(dateBR)} às ${esc(time)} (${esc(wayType||'ida')})</b>`;

    // Estado
    const state = {
      type: (wayType || 'ida'),
      schedule: schedule || {},
      exec: isExecutive(schedule),
      seats: [],
      pax: {}
    };

    const rawSeats = Array.isArray(schedule?.seats) ? schedule.seats : [];
    const { mode, list } = normalizeSeatList(rawSeats);

    // DEBUG útil (pode deixar por enquanto)
    console.log('[SEATS] modo:', mode, 'exec:', state.exec, 'amostra:', list.slice(0,5));

    const TOTAL_SEATS = state.exec ? 42 : 28;
    const availableOnlySet = new Set(list.map(x => x.number)); // se modo 'available-only', esses são os LIVRES

    function isSeatBlocked(num){
      if (num === 1 || num === 2) return true;
      if (!state.exec && num > 28) return true;

      // Quando vier só a lista de livres => o que NÃO está nela é ocupado
      if (mode === 'available-only') {
        return !availableOnlySet.has(num);
      }

      // Mapa completo com hints de status
      const sd = list.find(s => s.number === num);
      if (!sd) return false;              // sem dado => assume livre
      if (sd.occupied === true) return true;
      return false;
    }

    // Volta: mesma quantidade de assentos e passageiros pré-preenchidos
    let maxSelectable = Infinity;
    let obPax = [];
    if (state.type === 'volta'){
      const snap = loadOutboundSnapshot();
      maxSelectable = snap.cnt || 0;
      obPax = snap.pax || [];
    }

    // Grid
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
        if (cell > TOTAL_SEATS){ // oculta posições fora do range do veículo
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
            renderPaxList();
          }else{
            if (state.type==='volta' && state.seats.length >= maxSelectable){
              alert(`Para a volta selecione exatamente ${maxSelectable} poltronas.`);
              return;
            }
            state.seats.push(cell);
            seat.classList.add('selected');

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

    function renderPaxList(){
      const show = state.seats.length > 0;
      paxBox.style.display = show ? 'block' : 'none';
      paxListEl.innerHTML = '';
      if (!show) return;

      const readonly = (state.type === 'volta');
      const ordered = state.seats.slice().sort((a,b)=>a-b);

      ordered.forEach(num=>{
        const d = state.pax[num] || (state.pax[num] = { name:'', cpf:'', phone:'' });
        const row = document.createElement('div');
        row.className = 'passenger-row' + (readonly ? ' readonly' : '');

        if (readonly){
          row.innerHTML = `
            <span class="seat-label">Pol ${num}</span>
            <span class="value">${esc(d.name || '')}</span>
            <span class="value">${esc(d.cpf || '')}</span>
            <span class="value">${esc(d.phone || '')}</span>
          `;
        } else {
          row.innerHTML = `
            <span class="seat-label">Pol ${num}</span>
            <input type="text" name="name"  placeholder="Nome"     value="${esc(d.name  || '')}" data-field="name"  data-seat="${num}" required />
            <input type="text" name="cpf"   placeholder="CPF"      value="${esc(d.cpf   || '')}" data-field="cpf"   data-seat="${num}" required />
            <input type="text" name="phone" placeholder="Telefone" value="${esc(d.phone || '')}" data-field="phone" data-seat="${num}" required />
          `;
          row.querySelectorAll('input').forEach(inp=>{
            inp.addEventListener('input', (ev)=>{
              const seat  = Number(ev.target.getAttribute('data-seat'));
              const field = ev.target.getAttribute('data-field');
              (state.pax[seat] ||= {})[field] = ev.target.value;
            });
          });
        }

        paxListEl.appendChild(row);
      });
    }

    // Ações
    btnConfirm.addEventListener('click', () => {
      if (state.type==='volta' && isFinite(maxSelectable) && state.seats.length !== maxSelectable){
        alert(`Selecione exatamente ${maxSelectable} poltronas para a volta.`);
        return;
      }
      if (!state.seats.length){
        alert('Selecione ao menos uma poltrona.');
        return;
      }
      if (state.type === 'ida') {
        for (const n of state.seats) {
          const p = state.pax[n] || {};
          if (!p.name || !p.cpf || !p.phone) {
            alert(`Preencha Nome, CPF e Telefone da poltrona ${n}.`);
            return;
          }
        }
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
