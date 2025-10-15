// seats.js — seleção de poltronas (ida/volta) com sincronização de passageiros
(function(){
  // Utils
  const $  = (q, r=document) => r.querySelector(q);
  const $$ = (q, r=document) => Array.from(r.querySelectorAll(q));
  const fmtDateBR = (iso) => {
    if (!iso || !iso.includes('-')) return iso || '';
    const [Y,M,D] = iso.split('-');
    return `${D}/${M}/${Y}`;
  };

  // Estado geral
  const state = {
    schedule: JSON.parse(sessionStorage.getItem('currentSchedule') || 'null'), // preencha isso na navegação
    type:     sessionStorage.getItem('tripType') || detectTripTypeFromTitle(), // 'ida' | 'volta'
    seats: [],            // lista de números selecionados
    occupied: [],         // vindo do backend
    passengers: {},       // { [seatNumber]: {name, cpf, phone} }
    maxSelectable: Infinity,
    passengersFromOutbound: [] // quando for volta
  };

  function detectTripTypeFromTitle(){
    const h2 = $('.step-title, h2');
    if (h2 && /volta/i.test(h2.textContent)) return 'volta';
    return 'ida';
  }

  // Carrega info de ida para a volta
  function loadOutboundDataForReturn(){
    if (state.type !== 'volta') return;

    // guardamos na ida:
    // localStorage.setItem('outboundPassengers', JSON.stringify(passengersArray));
    // localStorage.setItem('outboundSeatCount', String(passengersArray.length));
    const ps = JSON.parse(localStorage.getItem('outboundPassengers') || '[]');
    const cnt = Number(localStorage.getItem('outboundSeatCount') || 0) || ps.length;

    state.passengersFromOutbound = ps;
    state.maxSelectable = Math.max(0, cnt) || ps.length || 0;
  }

  // Na ida, quando confirmar, salve passageiros/quantidade
  function saveOutboundSnapshotIfNeeded(){
    if (state.type !== 'ida') return;
    const pax = Object.values(state.passengers).filter(p => p && p.name);
    if (!pax.length) return;
    localStorage.setItem('outboundPassengers', JSON.stringify(pax));
    localStorage.setItem('outboundSeatCount', String(pax.length));
  }

  // --- Montagem da grade (use sua fonte de layout real; aqui usamos 42 poltronas padrão 2+2) ---
  const totalSeats = 42;
  function renderGrid(container){
    container.innerHTML = '';
    for (let n=1; n<=totalSeats; n++){
      const div = document.createElement('div');
      div.className = 'seat';
      div.textContent = n;
      if (state.occupied.includes(n)) div.classList.add('disabled');

      if (!div.classList.contains('disabled')){
        div.addEventListener('click', () => toggleSeat(n, div));
      }
      container.appendChild(div);
    }
    // aplica classe selected para já selecionados
    $$(':scope > .seat', container).forEach(el => {
      const num = Number(el.textContent);
      if (state.seats.includes(num)) el.classList.add('selected');
    });
  }

  // Alterna seleção respeitando limite na volta
  function toggleSeat(n, el){
    const idx = state.seats.indexOf(n);
    if (idx >= 0){
      state.seats.splice(idx,1);
      el.classList.remove('selected');
      delete state.passengers[n];
      updatePassengersRow();
      updateCounter();
      return;
    }
    // limite na volta
    if (state.type === 'volta' && state.seats.length >= state.maxSelectable){
      alert(`Para a volta, selecione no máximo ${state.maxSelectable} poltronas (mesma quantidade da ida).`);
      return;
    }
    state.seats.push(n);
    el.classList.add('selected');

    // Pré-preenche passageiros na volta, na ordem
    if (state.type === 'volta' && state.passengersFromOutbound.length){
      const i = state.seats.length - 1;
      const src = state.passengersFromOutbound[i];
      if (src){
        state.passengers[n] = { name: src.name || '', cpf: src.cpf || '', phone: src.phone || '' };
      }
    } else {
      // cria slot vazio; usuário preenche
      state.passengers[n] = state.passengers[n] || { name:'', cpf:'', phone:'' };
    }

    updatePassengersRow();
    updateCounter();
  }

  // UI: contador + legenda
  function renderLegend(){
    const legend = $('.seat-legend') || document.createElement('div');
    legend.className = 'seat-legend';
    legend.innerHTML = `
      <div class="item"><span class="swatch swatch--free"></span> Disponível</div>
      <div class="item"><span class="swatch swatch--selected"></span> Selecionado</div>
      <div class="item"><span class="swatch swatch--occupied"></span> Ocupado</div>
    `;
    const host = $('#legend-host') || $('.legend-host') || $('.legend') || $('.step-title')?.parentElement;
    if (host && !host.querySelector('.seat-legend')) host.appendChild(legend);
  }

  function updateCounter(){
    const el = $('#seats-count');
    if (el) el.textContent = state.seats.length;
  }

  // UI: linha de dados do passageiro (um por vez — como está na sua tela)
  function updatePassengersRow(){
    const wrap = $('#passengers-row');
    const seatSpan = $('#current-seat');
    const nameI = $('#pax-name');
    const cpfI  = $('#pax-cpf');
    const telI  = $('#pax-phone');

    if (!wrap) return;
    // pega o último seat selecionado para edição rápida
    const current = state.seats[state.seats.length - 1];
    if (!current){
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    seatSpan.textContent = current;

    const data = state.passengers[current] || {name:'', cpf:'', phone:''};
    nameI.value = data.name || '';
    cpfI.value  = data.cpf || '';
    telI.value  = data.phone || '';
  }

  function bindPassengerInputs(){
    const nameI = $('#pax-name');
    const cpfI  = $('#pax-cpf');
    const telI  = $('#pax-phone');

    nameI.addEventListener('input', ()=>{
      const current = state.seats[state.seats.length - 1];
      if (current) (state.passengers[current] ||= {}).name = nameI.value;
    });
    cpfI.addEventListener('input', ()=>{
      const current = state.seats[state.seats.length - 1];
      if (current) (state.passengers[current] ||= {}).cpf = cpfI.value;
    });
    telI.addEventListener('input', ()=>{
      const current = state.seats[state.seats.length - 1];
      if (current) (state.passengers[current] ||= {}).phone = telI.value;
    });
  }

  // Confirmação
  function handleConfirm(){
    // valida limite na volta: precisa ser igual à ida
    if (state.type === 'volta' && state.seats.length !== state.maxSelectable){
      alert(`Selecione ${state.maxSelectable} poltronas para a volta.`);
      return;
    }
    // valida nomes pelo menos
    const miss = state.seats.some(n => !state.passengers[n] || !state.passengers[n].name);
    if (miss){
      alert('Preencha o nome de todos os passageiros.');
      return;
    }

    // aqui você integra com a sua estrutura de "bookings" / "pendingPurchase"
    // exemplo: empurra para localStorage.bookings como item não pago
    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    const schedule = state.schedule || {};
    const passengers = state.seats.map(n => ({ seatNumber: n, ...(state.passengers[n] || {}) }));
    bookings.push({
      id: 'b' + Date.now(),
      schedule,
      seats: state.seats.slice(),
      passengers,
      price: schedule.price,
      paid: false,
      direction: state.type // 'ida' | 'volta'
    });
    localStorage.setItem('bookings', JSON.stringify(bookings));

    // snapshot da ida (para usar na volta)
    saveOutboundSnapshotIfNeeded();

    // redirecione para a próxima etapa (seu fluxo existente)
    location.href = 'payment.html';
  }

  // Voltar
  function handleBack(){
    history.back();
  }

  // =============== Boot ===============
  document.addEventListener('DOMContentLoaded', init); // se estiver carregando via defer, opcional

  function init(){
    // título/infos topo
    const title = $('.step-title') || $('h2');
    if (title && state.type) {
      title.textContent = `Escolha suas poltronas (${state.type})`;
    }
    // contador
    const counterEl = $('#seats-count');
    if (counterEl) counterEl.textContent = '0';

    // limite para volta + carregar passageiros de ida
    loadOutboundDataForReturn();

    // render legenda
    renderLegend();

    // render grade
    const grid = $('.bus-grid') || $('#bus-grid') || $('#seats-grid');
    if (grid) renderGrid(grid);

    bindPassengerInputs();

    // Botões – ordem: Confirmar (verde) à esquerda e Voltar (cinza) depois
    const confirmBtn = $('#btn-confirm') || $('#confirm-btn');
    const backBtn    = $('#btn-back')    || $('#back-btn');
    if (confirmBtn) confirmBtn.addEventListener('click', handleConfirm);
    if (backBtn)    backBtn.addEventListener('click', handleBack);
  }
})();
