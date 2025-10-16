// seats.js — Seleção de poltronas (1 tela), com encaixe no bus-blank e suporte ida/volta

(() => {
  // ====== Ajustes finos do posicionamento da grade dentro da carcaça ======
  // mexa 1–4px se quiser acertar milimetricamente no seu PNG (bus-blank.png)
  const TOP_OFFSET  = 28;   // px (sobe/desce a grade sobre a imagem)
  const LEFT_OFFSET = 192;  // px (empurra a grade para direita/esquerda)
  const CELL_W = 32;        // largura "visual" da célula (assento)
  const CELL_H = 22;        // altura "visual" da célula (assento)
  const GAP_X  = 10;        // espaço horizontal entre assentos
  const GAP_Y  = 6;         // espaço vertical entre assentos

  // malha que encaixa com o bus-blank.png (5 linhas x 11 colunas, corredor no meio)
  const GRID = [
    [ 3,  7, 11, 15, 19, 23, 27, 31, 35, 39, null],
    [ 4,  8, 12, 16, 20, 24, 28, 32, 36, 40, null],
    [null,null,null,null,null,null,null,null,null,null,null],
    [ 2,  6, 10, 14, 18, 22, 26, 30, 34, 38, 42],
    [ 1,  5,  9, 13, 17, 21, 25, 29, 33, 37, 41],
  ];

  const pick = (...v) => v.find(x => x !== undefined && x !== null && x !== '') ?? '';

  // ===== ida/volta snapshots =====
  function saveOutboundSnapshot(passengers) {
    localStorage.setItem('outboundPassengers', JSON.stringify(passengers));
    localStorage.setItem('outboundSeatCount', String(passengers.length));
  }
  function loadOutboundSnapshot() {
    const pax = JSON.parse(localStorage.getItem('outboundPassengers') || '[]');
    const cnt = Number(localStorage.getItem('outboundSeatCount') || 0) || pax.length;
    return { pax, cnt };
  }

  // ===== util de bloqueio =====
  function isExecutive(schedule){
    const t = (pick(schedule?.category, schedule?.tipo, schedule?.busType, '')+'').toLowerCase();
    if (t.includes('exec')) return true;
    if (t.includes('convenc')) return false;
    // tenta deduzir pelo que veio na lista (ex.: "Executivo" / "Convencional")
    const label = (schedule?.classLabel || schedule?.service || '')+'';
    if (label.toLowerCase().includes('exec')) return true;
    return false; // default: não executivo
  }

  // ===== API pública (usada pelo index/1-tela OU pelo seats.html) =====
  window.renderSeats = function renderSeats(container, schedule, wayType){
    if (!container) throw new Error('renderSeats: container inválido');

    // HTML esperados (como no seats.html que você mandou)
    const gridEl     = container.querySelector('#seats-grid') || container.querySelector('.bus-grid');
    const legendHost = container.querySelector('#legend-host') || container.querySelector('.legend-host');
    const countEl    = container.querySelector('#seats-count');
    const paxRow     = container.querySelector('#passengers-row');
    const curSeatEl  = container.querySelector('#current-seat');
    const nameI      = container.querySelector('#pax-name');
    const cpfI       = container.querySelector('#pax-cpf');
    const phoneI     = container.querySelector('#pax-phone');
    const btnConfirm = container.querySelector('#btn-confirm');
    const btnBack    = container.querySelector('#btn-back');

    // garante ordem dos botões (Confirmar à esq., Voltar à dir.)
    if (btnConfirm && btnBack && btnConfirm.nextElementSibling !== btnBack){
      btnConfirm.parentNode.insertBefore(btnBack, btnConfirm.nextSibling);
    }

    // legenda
    if (legendHost){
      legendHost.innerHTML = `
        <div class="seat-legend">
          <div class="item"><span class="swatch swatch--free"></span> Disponível</div>
          <div class="item"><span class="swatch swatch--selected"></span> Selecionado</div>
          <div class="item"><span class="swatch swatch--occupied"></span> Ocupado</div>
        </div>
      `;
    }

    // posiciona e dimensiona a grid exatamente sobre a imagem do ônibus
    Object.assign(gridEl.style, {
      position: 'absolute',
      top:  TOP_OFFSET  + 'px',
      left: LEFT_OFFSET + 'px',
      display: 'grid',
      gridTemplateColumns: `repeat(11, ${CELL_W}px)`,
      gridAutoRows: `${CELL_H}px`,
      columnGap: `${GAP_X}px`,
      rowGap: `${GAP_Y}px`,
    });

    const state = {
      type: (wayType || 'ida'),
      schedule: schedule || {},
      seats: [],
      pax: {} // seatNumber => {name, cpf, phone}
    };

    const notExec = !isExecutive(schedule);
    const seatData = Array.isArray(schedule?.seats) ? schedule.seats : [];

    const isSeatBlocked = (num) => {
      if (num === 1 || num === 2) return true;      // regra fixa
      if (notExec && num > 28) return true;         // não executivo: acima de 28 bloqueado
      const sd = seatData.find(s => Number(s.number) === num);
      if (!sd) return false;                        // sem dado => livre
      if (Number(sd.situacao) === 3) return true;   // inativo
      if (sd.occupied === true) return true;        // ocupado
      return false;
    };

    // Volta: trava quantidade e pré-preenche
    let maxSelectable = Infinity;
    let obPax = [];
    if (state.type === 'volta'){
      const snap = loadOutboundSnapshot();
      maxSelectable = snap.cnt || 0;
      obPax = snap.pax || [];
    }

    // desenha malha
    gridEl.innerHTML = '';
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
        const el = document.createElement('div');
        el.textContent = cell;
        el.className = 'seat';
        el.style.gridRowStart = rr;
        el.style.gridColumnStart = cc;

        if (isSeatBlocked(cell)){
          el.classList.add('disabled');
          el.setAttribute('aria-disabled','true');
          gridEl.appendChild(el);
          return;
        }

        el.addEventListener('click', () => {
          const i = state.seats.indexOf(cell);
          if (i >= 0){
            state.seats.splice(i,1);
            el.classList.remove('selected');
            delete state.pax[cell];
            updatePaxEditor();
          } else {
            if (state.type === 'volta' && state.seats.length >= maxSelectable){
              alert(`Para a volta selecione exatamente ${maxSelectable} poltronas (mesma quantidade da ida).`);
              return;
            }
            state.seats.push(cell);
            el.classList.add('selected');
            // pré-preenche (volta)
            if (state.type === 'volta' && obPax.length){
              const idx = state.seats.length - 1;
              const src = obPax[idx];
              if (src) state.pax[cell] = { name:src.name||'', cpf:src.cpf||'', phone:src.phone||'' };
            } else {
              state.pax[cell] = state.pax[cell] || { name:'', cpf:'', phone:'' };
            }
            updatePaxEditor();
          }
          if (countEl) countEl.textContent = String(state.seats.length);
        });

        gridEl.appendChild(el);
      });
    });

    // editor do passageiro
    function updatePaxEditor(){
      const last = state.seats[state.seats.length - 1];
      if (!paxRow) return;
      if (!last){
        paxRow.style.display = 'none';
        return;
      }
      paxRow.style.display = '';
      if (curSeatEl) curSeatEl.textContent = last;
      const data = state.pax[last] || {name:'', cpf:'', phone:''};
      if (nameI)  nameI.value  = data.name  || '';
      if (cpfI)   cpfI.value   = data.cpf   || '';
      if (phoneI) phoneI.value = data.phone || '';
    }
    function bindPaxInputs(){
      const write = () => {
        const last = state.seats[state.seats.length - 1];
        if (!last) return;
        (state.pax[last] ||= {}).name  = nameI?.value  || '';
        (state.pax[last] ||= {}).cpf   = cpfI?.value   || '';
        (state.pax[last] ||= {}).phone = phoneI?.value || '';
      };
      nameI && nameI.addEventListener('input', write);
      cpfI  &&  cpfI.addEventListener('input', write);
      phoneI&&phoneI.addEventListener('input', write);
    }
    bindPaxInputs();

    // botões externos (mantemos a ordem visual Confirmar, depois Voltar)
    btnConfirm && btnConfirm.addEventListener('click', () => {
      if (state.type === 'volta' && isFinite(maxSelectable) && state.seats.length !== maxSelectable){
        alert(`Selecione exatamente ${maxSelectable} poltronas para a volta.`);
        return;
      }
      // valida nome de todos
      const faltaNome = state.seats.some(n => !state.pax[n] || !state.pax[n].name);
      if (faltaNome){ alert('Preencha o nome de todos os passageiros.'); return; }

      const passengers = state.seats.map(n => ({
        seatNumber: n,
        ...(state.pax[n]||{})
      }));

      if (state.type === 'ida') saveOutboundSnapshot(passengers);

      // Notifica o host (main.js) para continuar o fluxo
      container.dispatchEvent(new CustomEvent('seats:confirm', {
        detail: { seats: state.seats.slice(), passengers, schedule: state.schedule, type: state.type }
      }));
    });

    btnBack && btnBack.addEventListener('click', () => {
      container.dispatchEvent(new CustomEvent('seats:back'));
    });
  };

  window.destroySeats = function(container){
    if (container) container.innerHTML = '';
  };
})();
