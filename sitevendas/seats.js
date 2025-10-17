// seats.js — Seleção de poltronas (1-tela) lendo disponibilidade da API Praxio (Situacao)

/* global window, localStorage */

(() => {
  // ====== Ajustes finos do encaixe (se quiser, mexa 1–3px) ======
  const TOP_OFFSET  = 22;   // px
  const LEFT_OFFSET = 105;  // px
  const CELL_W = 40;
  const CELL_H = 30;
  const GAP_X  = 16;
  const GAP_Y  = 12;

  // Malha (bus-blank.png) — 5 linhas x 11 colunas
  const GRID = [
    [ 3,  7, 11, 15, 19, 23, 27, 31, 35, 39, null],
    [ 4,  8, 12, 16, 20, 24, 28, 32, 36, 40, null],
    [null,null,null,null,null,null,null,null,null,null,null],
    [ 2,  6, 10, 14, 18, 22, 26, 30, 34, 38, 42],
    [ 1,  5,  9, 13, 17, 21, 25, 29, 33, 37, 41],
  ];

  // ===== estilos do componente =====
  const STYLE_ID = 'seats-onepage-style';
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
:root{ --brand:#0b5a2b; --brand-700:#094a24; --muted:#2a3b2a; }
.seats-onepage .bus-wrap{ position:relative; overflow:hidden; }
.seats-onepage .bus-img{ max-width:100%; height:auto; display:block; }
.seats-onepage .bus-grid{
  position:absolute; top:${TOP_OFFSET}px; left:${LEFT_OFFSET}px;
  display:grid;
  grid-template-columns: repeat(11, ${CELL_W}px);
  grid-auto-rows: ${CELL_H}px;
  column-gap:${GAP_X}px; row-gap:${GAP_Y}px;
}
.seats-onepage .seat{
  background:#eaf5ea; color:#1a301a;
  border:1px solid #d8ead8; border-radius:6px;
  min-width:${CELL_W}px; height:${CELL_H}px;
  line-height:${CELL_H-2}px; font-size:12px; text-align:center;
  user-select:none; cursor:pointer;
}
.seats-onepage .seat.selected{
  background:var(--brand)!important; color:#fff!important; border-color:var(--brand-700)!important;
}
.seats-onepage .seat.disabled{
  background:#cfd6cf!important; color:#666!important; border-color:#cfd6cf!important; cursor:not-allowed;
}
.seats-onepage .walkway{ width:${CELL_W}px; height:${CELL_H}px; opacity:0; }

.seats-onepage .legend{
  display:flex; justify-content:center; gap:28px; margin:18px 0 6px;
}
.seats-onepage .legend .i{ display:flex; align-items:center; gap:10px; font-size:1rem; color:var(--muted); }
.seats-onepage .legend .sw{ width:18px; height:18px; border-radius:4px; border:1px solid #d8ead8; }
.seats-onepage .sw.free{ background:#eaf5ea; }
.seats-onepage .sw.sel{  background:var(--brand); border-color:var(--brand-700); }
.seats-onepage .sw.occ{  background:#cfd6cf; border-color:#cfd6cf; }

.seats-onepage .info-line{ margin:8px 0 2px; color:var(--muted); font-weight:700; }
.seats-onepage .counter{ margin-bottom:12px; }

.seats-onepage .pax { display:none; margin-top:10px; }
.seats-onepage .pax-grid{ display:grid; grid-template-columns: 1.6fr 1fr 1fr; gap:10px; }
.seats-onepage .pax.readonly input{ background:#f7f7f7; color:#666; }

.seats-onepage .actions{ display:flex; gap:10px; margin-top:16px; }
.seats-onepage .btn{ padding:8px 14px; border-radius:6px; border:1px solid transparent; cursor:pointer; }
.seats-onepage .btn-primary{ background:var(--brand); color:#fff; }
.seats-onepage .btn-ghost{ background:#e9ecef; color:#222; }

/* respiro lateral/inferior alinhado ao card da esquerda */
.seats-onepage-root{ padding:0 16px 18px 16px; }
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

  // salva/recupera snapshot da ida (para travar quantidade e copiar pax para a volta)
  function saveOutboundSnapshot(passengers) {
    localStorage.setItem('outboundPassengers', JSON.stringify(passengers));
    localStorage.setItem('outboundSeatCount', String(passengers.length));
  }
  function loadOutboundSnapshot() {
    const pax = JSON.parse(localStorage.getItem('outboundPassengers') || '[]');
    const cnt = Number(localStorage.getItem('outboundSeatCount') || 0) || pax.length;
    return { pax, cnt };
  }

  // ===== API pública =====
  window.renderSeats = function renderSeats(container, schedule, wayType){
    ensureStyles();
    if (!container) throw new Error('renderSeats: container inválido');

    container.classList.add('seats-onepage-root');
    container.innerHTML = ''; // limpa para evitar UI antiga
    const root = document.createElement('div');
    root.className = 'seats-onepage';
    root.innerHTML = `
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
          <input id="paxName"  type="text" placeholder="Nome"     required />
          <input id="paxCpf"   type="text" placeholder="CPF"       required />
          <input id="paxPhone" type="text" placeholder="Telefone"  required />
        </div>
      </div>

      <div class="actions">
        <button class="btn btn-primary" id="btnConfirm">Confirmar seleção</button>
        <button class="btn btn-ghost"   id="btnBack">Voltar</button>
      </div>
    `;
    container.appendChild(root);

    // refs
    const gridEl   = root.querySelector('#busGrid');
    const tripInfo = root.querySelector('#tripInfo');
    const selCount = root.querySelector('#selCount');
    const paxBox   = root.querySelector('#paxBox');
    const curSeat  = root.querySelector('#curSeat');
    const nameI    = root.querySelector('#paxName');
    const cpfI     = root.querySelector('#paxCpf');
    const phoneI   = root.querySelector('#paxPhone');
    const btnConfirm = root.querySelector('#btnConfirm');
    const btnBack    = root.querySelector('#btnBack');

    // Cabeçalho
    const origin = pick(schedule?.originName, schedule?.origin, schedule?.origem, '');
    const dest   = pick(schedule?.destinationName, schedule?.destination, schedule?.destino, '');
    const dateBR = fmtDateBR(schedule?.date || '');
    const time   = pick(schedule?.departureTime, schedule?.horaPartida, '');
    tripInfo.textContent = `${origin} → ${dest} — ${dateBR} às ${time} (${wayType || 'ida'})`;

    const state = {
      type: (wayType || 'ida'),
      schedule: schedule || {},
      seats: [],
      pax: {}
    };

    // --- Mapa de assentos vindos da API (por Caption -> Situacao) ---
    // A API da Praxio retorna a disponibilidade no campo "Situacao".
    // Disponível = 0; qualquer outro valor => ocupado/bloqueado.
    const rawSeats = Array.isArray(schedule?.seats) ? schedule.seats : [];
    const seatStatusByCaption = new Map();
    rawSeats.forEach(s => {
      // Caption pode vir como string "28" etc.
      const captionNum = Number(
        s?.Caption ?? s?.caption ?? s?.IntCaption ?? s?.intCaption ?? s?.number ?? s?.NumeroPoltrona
      );
      if (!Number.isFinite(captionNum)) return;
      const situacao = Number(s?.Situacao ?? s?.situacao ?? s?.status ?? s?.Status);
      seatStatusByCaption.set(captionNum, isNaN(situacao) ? null : situacao);
    });

    // Função de indisponibilidade 100% baseada na API
    function isSeatUnavailableByAPI(caption) {
      if (!seatStatusByCaption.size) return false; // sem dados => não bloqueia
      const sit = seatStatusByCaption.get(caption);
      if (sit === null || sit === undefined) {
        // Se a API não trouxe este caption, tratamos como inexistente/ocupado?
        // Pela doc, poltronas "que não existem" vêm com Situacao=3 — mas se nem veio,
        // consideramos livre para não bloquear indevidamente.
        return false;
      }
      // Disponível somente quando 0
      return Number(sit) !== 0;
    }

    // Volta: trava qtde e preenche pax (somente leitura)
    let maxSelectable = Infinity;
    let obPax = [];
    const isReturn = state.type === 'volta';
    if (isReturn) {
      const snap = loadOutboundSnapshot();
      maxSelectable = snap.cnt || 0;
      obPax = snap.pax || [];
      // inputs readonly no modo volta
      paxBox.classList.add('readonly');
      [nameI, cpfI, phoneI].forEach(i => { i.readOnly = true; i.required = false; });
    }

    // Regras (agora só seguimos a API)
    function isSeatBlocked(num){
      return isSeatUnavailableByAPI(num);
    }

    // Desenha a malha
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
            if (isReturn && state.seats.length >= maxSelectable){
              alert(`Para a volta selecione exatamente ${maxSelectable} poltronas.`);
              return;
            }
            state.seats.push(cell);
            seat.classList.add('selected');

            if (isReturn && obPax.length){
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
        if (isReturn) return; // volta é somente leitura
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

    // Botões
    btnConfirm.addEventListener('click', () => {
      if (isReturn && isFinite(maxSelectable) && state.seats.length !== maxSelectable){
        alert(`Selecione exatamente ${maxSelectable} poltronas para a volta.`);
        return;
      }
      // validação somente na ida (na volta é readonly)
      if (!isReturn){
        for (const n of state.seats){
          const p = state.pax[n] || {};
          if (!p.name || !p.cpf || !p.phone){
            alert('Preencha nome, CPF e telefone para todas as poltronas selecionadas.');
            return;
          }
        }
      }
      const passengers = state.seats.map(n => ({ seatNumber:n, ...(state.pax[n]||{}) }));
      if (!isReturn) saveOutboundSnapshot(passengers);

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
