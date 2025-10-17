// seats.js — Seleção de poltronas (1 tela) AUTOSSUFICIENTE
(() => {
  // ===== Ajustes finos do encaixe (ajuste 1–3px se necessário) =====
  const TOP_OFFSET  = 22;   // px (sobe/desce a grade sobre o bus-blank)
  const LEFT_OFFSET = 105;  // px (empurra grade p/ direita/esquerda)
  const CELL_W = 45;        // largura da célula (assento)
  const CELL_H = 35;        // altura da célula
  const GAP_X  = 15;        // espaço horizontal entre assentos
  const GAP_Y  = 10;        // espaço vertical entre assentos

  // Malha (bus-blank.png) — 5 linhas x 11 colunas
  // *** IMPORTANTE: Estes números são justamente os "NumeroPoltrona" (índice de posição) ***
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
.seats-onepage .ghost{ opacity:0; pointer-events:none; } /* não existe (Situacao=3) */

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

  function isExecutive(schedule){
    const t = (pick(schedule?.category, schedule?.tipo, schedule?.busType, '')+'').toLowerCase();
    if (t.includes('exec')) return true;
    if (t.includes('convenc')) return false;
    const label = (schedule?.classLabel || schedule?.service || '')+'';
    if (label.toLowerCase().includes('exec')) return true;
    return false; // fallback: se nada indica "executivo", tratamos como convencional
  }

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
    container.innerHTML = '';
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
      exec: isExecutive(schedule),
      seats: [],
      pax: {}
    };

    // ===== Lê as poltronas segundo a documentação =====
    // Preferência pelo formato da API oficial: LaypoltronaXml.PoltronaXmlRetorno
    let apiSeats = [];
    if (Array.isArray(schedule?.LaypoltronaXml?.PoltronaXmlRetorno)) {
      apiSeats = schedule.LaypoltronaXml.PoltronaXmlRetorno;
    } else if (Array.isArray(schedule?.seats)) {
      // fallback se já tiver sido normalizado antes
      apiSeats = schedule.seats;
    }

    // Mapa: NumeroPoltrona -> registro (também guardamos Caption)
    const seatMap = new Map();
    apiSeats.forEach(s => {
      const pos = Number(
        s?.NumeroPoltrona ?? s?.numero ?? s?.number
      );
      if (!Number.isFinite(pos)) return;
      seatMap.set(pos, s);
    });

    // Helpers baseados na doc:
    //  - Situacao === 0 => disponível
    //  - Situacao === 3 => poltrona inexistente (não exibe)
    //  - qualquer outro => ocupado/bloqueado
    function getSituacao(pos) {
      const sd = seatMap.get(pos);
      if (!sd) return null; // sem dado
      const sit = Number(sd.Situacao ?? sd.situacao ?? sd.status ?? 0);
      return Number.isFinite(sit) ? sit : 0;
    }
    const isNotExists = (pos) => getSituacao(pos) === 3;
    const isAvailable = (pos) => getSituacao(pos) === 0;
    const isUnavailable = (pos) => {
      const sit = getSituacao(pos);
      if (sit === null) return false;     // sem dado -> tratamos como livre
      if (sit === 3)   return false;      // inexistente é tratado separado
      return sit !== 0;                   // qualquer valor diferente de 0 => ocupado/bloqueado
    };
    const getCaption = (pos, fallback) => {
      const sd = seatMap.get(pos);
      const cap = sd?.Caption ?? sd?.caption;
      if (cap !== undefined && cap !== null && String(cap).trim() !== '') {
        return String(cap).padStart(2,'0');
      }
      return String(fallback);
    };

    // Volta: trava qtde e preenche pax (somente leitura)
    let maxSelectable = Infinity;
    let obPax = [];
    const isReturn = state.type === 'volta';
    if (isReturn) {
      const snap = loadOutboundSnapshot();
      maxSelectable = snap.cnt || 0;
      obPax = snap.pax || [];
      paxBox.classList.add('readonly');
      [nameI, cpfI, phoneI].forEach(i => { i.readOnly = true; i.required = false; });
    }

    // Regras fixas e de classe
    function isSeatBlocked(num){
      if (num === 1 || num === 2) return true;          // bloqueadas no layout
      if (!state.exec && num > 28) return true;         // convencional tem 28 válidas
      if (isUnavailable(num)) return true;              // ocupado/bloqueado pela API
      return false;
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

        // Se a API disser que a poltrona não existe (Situacao = 3), não exibimos
        if (isNotExists(cell)) {
          const ghost = document.createElement('div');
          ghost.className = 'seat ghost';
          ghost.style.gridRowStart = rr;
          ghost.style.gridColumnStart = cc;
          gridEl.appendChild(ghost);
          return;
        }

        const seat = document.createElement('div');
        seat.className = 'seat';
        seat.textContent = getCaption(cell, cell); // mostra Caption se vier; senão o índice
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
