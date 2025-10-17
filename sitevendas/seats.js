// seats.js — Seleção de poltronas (1-tela) com chamada da API, ocupação correta e grade responsiva
(() => {
  // ====== Dimensões-base do layout (ref. para escala) ======
  const BASE_IMG_WIDTH = 980;       // largura de referência do bus-blank.png
  const BASE_TOP       = 22;        // px
  const BASE_LEFT      = 105;       // px
  const BASE_CELL_W    = 40;        // px
  const BASE_CELL_H    = 30;        // px
  const BASE_GAP_X     = 16;        // px
  const BASE_GAP_Y     = 12;        // px

  // ====== Malha do ônibus (5x11) ======
  const GRID = [
    [ 3,  7, 11, 15, 19, 23, 27, 31, 35, 39, null],
    [ 4,  8, 12, 16, 20, 24, 28, 32, 36, 40, null],
    [null,null,null,null,null,null,null,null,null,null,null],
    [ 2,  6, 10, 14, 18, 22, 26, 30, 34, 38, 42],
    [ 1,  5,  9, 13, 17, 21, 25, 29, 33, 37, 41],
  ];

  // ===== estilos (usamos variáveis para escalar tudo) =====
  const STYLE_ID = 'seats-onepage-style';
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
:root{ --brand:#0b5a2b; --brand-700:#094a24; --muted:#2a3b2a; }
.seats-onepage-root{ padding:0 16px 18px 16px; }
.seats-onepage .bus-wrap{ position:relative; overflow:hidden; }
.seats-onepage .bus-img{ max-width:100%; height:auto; display:block; }

.seats-onepage .bus-grid{
  position:absolute;
  top:var(--grid-top, ${BASE_TOP}px);
  left:var(--grid-left, ${BASE_LEFT}px);
  display:grid;
  grid-template-columns: repeat(11, var(--cell-w, ${BASE_CELL_W}px));
  grid-auto-rows: var(--cell-h, ${BASE_CELL_H}px);
  column-gap: var(--gap-x, ${BASE_GAP_X}px);
  row-gap: var(--gap-y, ${BASE_GAP_Y}px);
}

.seats-onepage .seat{
  background:#eaf5ea; color:#1a301a;
  border:1px solid #d8ead8; border-radius:6px;
  min-width:var(--cell-w, ${BASE_CELL_W}px);
  height:var(--cell-h, ${BASE_CELL_H}px);
  line-height: calc(var(--cell-h, ${BASE_CELL_H}px) - 2px);
  font-size:12px; text-align:center; user-select:none; cursor:pointer;
}
.seats-onepage .seat.selected{
  background:var(--brand)!important; color:#fff!important; border-color:var(--brand-700)!important;
}
.seats-onepage .seat.disabled{
  background:#cfd6cf!important; color:#666!important; border-color:#cfd6cf!important; cursor:not-allowed;
}
.seats-onepage .walkway{ width:var(--cell-w, ${BASE_CELL_W}px); height:var(--cell-h, ${BASE_CELL_H}px); opacity:0; }

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

.seats-onepage .actions{ display:flex; gap:10px; margin-top:22px; } /* + respiro abaixo dos campos */
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
    return false; // default: convencional
  }

  // ===== snapshot ida (para volta) =====
  function saveOutboundSnapshot(passengers) {
    localStorage.setItem('outboundPassengers', JSON.stringify(passengers));
    localStorage.setItem('outboundSeatCount', String(passengers.length));
  }
  function loadOutboundSnapshot() {
    const pax = JSON.parse(localStorage.getItem('outboundPassengers') || '[]');
    const cnt = Number(localStorage.getItem('outboundSeatCount') || 0) || pax.length;
    return { pax, cnt };
  }

  // ====== Busca mapa de poltronas quando necessário ======
  async function ensureSeatMap(schedule){
    const seats = schedule?.seats;
    const looksReady = Array.isArray(seats) && seats.length > 0 &&
                       (('situacao' in (seats[0]||{})) || ('Situacao' in (seats[0]||{})) || ('occupied' in (seats[0]||{})));

    if (looksReady) return; // já temos mapa usable

    // monta payload conforme doc
    const payload = {
      idViagem:       pick(schedule?.idViagem, schedule?.idviagem, schedule?.viagemId),
      idTipoVeiculo:  pick(schedule?.idTipoVeiculo, schedule?.tipoVeiculoId),
      idLocOrigem:    pick(schedule?.originId, schedule?.origemId, schedule?.idOrigem, schedule?.idLocOrigem),
      idLocDestino:   pick(schedule?.destinationId, schedule?.destinoId, schedule?.idDestino, schedule?.idLocDestino),
      andar: 0,
      verificarSugestao: 1,
    };

    try {
      const resp = await fetch('/api/poltronas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const raw = await resp.json();

      // normaliza a raiz
      const data = Array.isArray(raw) ? (raw[0] || {}) : raw;

      // coleta PoltronaXmlRetorno
      let poltronas = [];
      if (data?.LaypoltronaXml?.PoltronaXmlRetorno) {
        poltronas = data.LaypoltronaXml.PoltronaXmlRetorno;
      } else if (data?.PoltronaXmlRetorno) { // fallback
        const p = data.PoltronaXmlRetorno;
        poltronas = Array.isArray(p) ? p : [p];
      }

      // mapeia para { number, situacao, occupied }
      const mapped = (poltronas || []).map(p => {
        // pela documentação: "Caption" é o número que o cliente vê; "NumeroPoltrona" é posição
        const caption  = p.Caption ?? p.caption;
        const number   = parseInt(caption || p.Numero || p.NumeroPoltrona, 10);
        const situacao = parseInt(p.Situacao ?? p.situacao ?? 0, 10);
        return { number, situacao, occupied: situacao !== 0 };
      }).filter(s => Number.isFinite(s.number) && s.number >= 1 && s.number <= 42);

      if (mapped.length) schedule.seats = mapped;
    } catch (e) {
      console.error('Erro ao carregar mapa de poltronas:', e);
      // se falhar, segue sem seats (aparecerá tudo como livre exceto 1/2 e >28 convencional)
    }
  }

  // ===== API pública =====
  window.renderSeats = async function renderSeats(container, schedule, wayType){
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
    const img      = root.querySelector('.bus-img');
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

    // Estado
    const state = {
      type: (wayType || 'ida'),
      schedule: schedule || {},
      exec: isExecutive(schedule),
      seats: [],   // números selecionados
      pax: {}      // { num: { name, cpf, phone } }
    };

    // Garante que temos o mapa de poltronas (busca do backend se necessário)
    await ensureSeatMap(schedule);

    // cria um Map por número para acesso rápido
    const seatMap = new Map();
    if (Array.isArray(schedule?.seats)) {
      schedule.seats.forEach(s => {
        if (Number.isFinite(Number(s.number))) seatMap.set(Number(s.number), s);
      });
    }

    const isReturn = state.type === 'volta';
    let maxSelectable = Infinity;
    let obPax = [];
    if (isReturn) {
      const snap = loadOutboundSnapshot();
      maxSelectable = snap.cnt || 0;
      obPax = snap.pax || [];
      paxBox.classList.add('readonly');
      [nameI, cpfI, phoneI].forEach(i => { i.readOnly = true; i.required = false; });
    }

    function isSeatBlocked(num){
      if (num === 1 || num === 2) return true;             // bloqueadas fixas
      // if (!state.exec && num > 28) return true;            // convencional com 28
      const sd = seatMap.get(num);
      if (!sd) return true;                                // não veio no mapa => não existe/indisp.
      if (Number(sd.situacao) === 3) return true;          // inativa
      if (sd.occupied === true || Number(sd.situacao) !== 0) return true; // ocupada
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

    nameI.addEventListener('input', () => {
      if (isReturn) return;
      const last = state.seats[state.seats.length-1]; if (!last) return;
      (state.pax[last] ||= {}).name = nameI.value;
    });
    cpfI.addEventListener('input', () => {
      if (isReturn) return;
      const last = state.seats[state.seats.length-1]; if (!last) return;
      (state.pax[last] ||= {}).cpf = cpfI.value;
    });
    phoneI.addEventListener('input', () => {
      if (isReturn) return;
      const last = state.seats[state.seats.length-1]; if (!last) return;
      (state.pax[last] ||= {}).phone = phoneI.value;
    });

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

    // ===== Responsividade: escala pela largura da imagem =====
    function applyScale() {
      const w = img?.getBoundingClientRect().width || BASE_IMG_WIDTH;
      const scale = Math.max(0.6, Math.min(1.5, w / BASE_IMG_WIDTH)); // limites suaves
      root.style.setProperty('--grid-top',  (BASE_TOP   * scale) + 'px');
      root.style.setProperty('--grid-left', (BASE_LEFT  * scale) + 'px');
      root.style.setProperty('--cell-w',    (BASE_CELL_W* scale) + 'px');
      root.style.setProperty('--cell-h',    (BASE_CELL_H* scale) + 'px');
      root.style.setProperty('--gap-x',     (BASE_GAP_X * scale) + 'px');
      root.style.setProperty('--gap-y',     (BASE_GAP_Y * scale) + 'px');
    }
    const ro = new ResizeObserver(applyScale);
    ro.observe(img);
    img.addEventListener('load', applyScale);
    applyScale();
  };

  window.destroySeats = function(container){
    if (container) container.innerHTML = '';
  };
})();
