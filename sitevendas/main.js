import { renderSchedules } from './schedules.js';
import { renderSeats } from './seats.js';

/* ===== Nav usuário ===== */
function updateUserNav(){
  const nav = document.getElementById('user-nav');
  if (!nav) return;
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  nav.innerHTML = '';
  if (user){
    const a = document.createElement('a'); a.href='profile.html';
    a.textContent = `Minhas viagens (${user.name || user.email})`;
    nav.appendChild(a);
    const s = document.createElement('a'); s.href='#'; s.style.marginLeft='12px'; s.textContent='Sair';
    s.onclick = ()=>{ localStorage.removeItem('user'); updateUserNav(); location.href='index.html'; };
    nav.appendChild(s);
  }else{
    const a = document.createElement('a'); a.href='login.html'; a.textContent='Entrar';
    a.onclick = ()=>{ localStorage.setItem('postLoginRedirect','index.html'); };
    nav.appendChild(a);
  }
}
updateUserNav();

/* ===== Localidades ===== */
const localities = [
  { id: 2,  descricao: 'Ouro Branco' },
  { id: 6,  descricao: 'Ouro Preto E/S' },
  { id: 24, descricao: 'Mariana' },
  { id: 23, descricao: 'Antonio Pereira – Ouro Preto E/S' },
  { id: 21, descricao: 'Mina Alegria' },
  { id: 20, descricao: 'Catas Altas E/S - Rua Felicio Alve' },
  { id: 19, descricao: 'Santa Bárbara E/S' },
  { id: 22, descricao: 'Cocais-Barão de Cocais' },
  { id: 26, descricao: 'Barão de Cocais E/S' },
  { id: 17, descricao: 'BR381/BR129–São Goncalo do R' },
  { id: 16, descricao: 'Joao Monlevade - Graal 5 Estrela' },
  { id: 28, descricao: 'BR381/AC.Nova Era–Nova Era' },
  { id: 15, descricao: 'Timoteo' },
  { id: 14, descricao: 'Coronel Fabriciano' },
  { id: 12, descricao: 'Ipatinga' }
];

/* ===== Sidebar refs ===== */
const $ = q => document.querySelector(q);
const originInput = $('#origin');
const destInput   = $('#destination');
const dateInput   = $('#date');
const retInput    = $('#return-date');
const datalistOrigin = $('#origin-suggestions');
const datalistDest   = $('#destination-suggestions');

/* Preenche os datalists (nativo) */
function fillDatalist(dl){
  dl.innerHTML = '';
  localities.forEach(l=>{
    const o = document.createElement('option');
    o.value = l.descricao; dl.appendChild(o);
  });
}
fillDatalist(datalistOrigin);
fillDatalist(datalistDest);

/* Datas mínimas = hoje */
function setMinToday(input){
  const d = new Date();
  const yyyy = d.getFullYear(), mm = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  input.min = `${yyyy}-${mm}-${dd}`;
}
setMinToday(dateInput); setMinToday(retInput);

/* ===== Estado & central root ===== */
const contentRoot = document.getElementById('content-root');
const state = { leg:'IDA', search:null, searchReturn:null, selected:[] };

/* Helpers de render no card central */
function clearCentral(){ contentRoot.innerHTML = ''; }                 // vazio (estado inicial)
function renderListShell(legend){
  contentRoot.innerHTML = `
    <h2 class="step-title">${legend}</h2>
    <div id="schedule-list"></div>
    <div id="no-results" class="mute"></div>
  `;
  return {
    list: document.getElementById('schedule-list'),
    status: document.getElementById('no-results')
  };
}
function renderSeatsShell(legend){
  contentRoot.innerHTML = `
    <h2 class="step-title">${legend}</h2>
    <div id="seats-container"></div>
    <div class="actions"><button id="btn-back" class="btn btn-ghost">Voltar</button></div>
  `;
  return {
    seats: document.getElementById('seats-container'),
    back:  document.getElementById('btn-back')
  };
}

/* Inicial: central vazio */
clearCentral();

/* ===== Submeter pesquisa ===== */
document.getElementById('search-form').addEventListener('submit', e=>{
  e.preventDefault();

  const originName = originInput.value.trim();
  const destName   = destInput.value.trim();
  const date       = dateInput.value;

  if (!originName || !destName || !date){ alert('Preencha origem, destino e data da ida.'); return; }

  const o = localities.find(x => x.descricao.toLowerCase() === originName.toLowerCase());
  const d = localities.find(x => x.descricao.toLowerCase() === destName.toLowerCase());
  if (!o || !d){ alert('Origem/Destino inválidos. Selecione uma opção sugerida.'); return; }

  state.leg = 'IDA';
  state.selected = [];
  state.search = { originId:o.id, originName:o.descricao, destinationId:d.id, destinationName:d.descricao, date };
  state.searchReturn = retInput.value ? { originId:d.id, originName:d.descricao, destinationId:o.id, destinationName:o.descricao, date: retInput.value } : null;

  // Render lista (IDA)
  const { list, status } = renderListShell('Viagens disponíveis (ida)');
  status.textContent = 'Buscando viagens disponíveis...';
  renderSchedules(list, status, state.search, (schedule)=>{
    state.selected = state.selected.filter(s => s.leg !== state.leg);
    state.selected.push({ leg: state.leg, schedule });

    // Abre poltronas (IDA)
    const { seats, back } = renderSeatsShell('Escolha suas poltronas (ida)');
    back.onclick = ()=> {
      const sh = renderListShell('Viagens disponíveis (ida)');
      renderSchedules(sh.list, sh.status, state.search, (s)=>{ // reabrir mapa ao re-selecionar
        state.selected = state.selected.filter(x=>x.leg!=='IDA'); state.selected.push({ leg:'IDA', schedule:s });
        const ss = renderSeatsShell('Escolha suas poltronas (ida)');
        drawSeats(ss.seats, s, 'IDA');
      });
    };
    drawSeats(seats, schedule, 'IDA');
  });
});

/* ===== Desenha mapa e fluxo ida/volta/pagamento ===== */
function drawSeats(container, schedule, legLabel){
  renderSeats(container, schedule, (payload)=>{
    const idx = state.selected.findIndex(s => s.leg === legLabel);
    if (idx >= 0) state.selected[idx] = { ...payload, leg: legLabel };

    // Se há volta e acabamos a ida → lista da VOLTA
    if (legLabel === 'IDA' && state.searchReturn){
      const { list, status } = renderListShell('Viagens disponíveis (volta)');
      status.textContent = 'Buscando viagens disponíveis...';
      state.leg = 'VOLTA';
      renderSchedules(list, status, state.searchReturn, (schedule2)=>{
        state.selected = state.selected.filter(s => s.leg !== 'VOLTA');
        state.selected.push({ leg: 'VOLTA', schedule: schedule2 });

        const { seats, back } = renderSeatsShell('Escolha suas poltronas (volta)');
        back.onclick = ()=> {
          const sh = renderListShell('Viagens disponíveis (volta)');
          renderSchedules(sh.list, sh.status, state.searchReturn, (s2)=>{
            state.selected = state.selected.filter(x=>x.leg!=='VOLTA'); state.selected.push({ leg:'VOLTA', schedule:s2 });
            const ss = renderSeatsShell('Escolha suas poltronas (volta)');
            drawSeats(ss.seats, s2, 'VOLTA');
          });
        };
        drawSeats(seats, schedule2, 'VOLTA');
      });
      return;
    }

    // Finaliza e vai para pagamento
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    const toSave = state.selected.map(s => ({
      id: Date.now() + Math.floor(Math.random()*1000),
      schedule: s.schedule,
      seats: s.seats,
      passengers: s.passengers,
      price: (Number(s.schedule.price)||0) * s.seats.length,
      date: s.schedule.date,
      paid: false
    }));

    if (!user){
      localStorage.setItem('pendingPurchase', JSON.stringify({ legs: toSave }));
      localStorage.setItem('postLoginRedirect', 'payment.html');
      location.href = 'login.html';
      return;
    }

    localStorage.setItem('bookings', JSON.stringify([...bookings, ...toSave]));
    localStorage.removeItem('pendingPurchase');
    location.href = 'payment.html';
  });
}
