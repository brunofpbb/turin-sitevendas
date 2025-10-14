// Orquestra: sidebar sempre visível; painel da direita alterna entre LISTA e SEATS
import { renderSchedules } from './schedules.js';
import { renderSeats } from './seats.js';

/* ===== Usuário (mesmo comportamento anterior) ===== */
function updateUserNav() {
  const nav = document.getElementById('user-nav');
  if (!nav) return;
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  nav.innerHTML = '';
  if (user) {
    const a = document.createElement('a');
    a.href = 'profile.html';
    a.textContent = `Minhas viagens (${user.name || user.email})`;
    nav.appendChild(a);

    const s = document.createElement('a');
    s.href = '#';
    s.style.marginLeft = '12px';
    s.textContent = 'Sair';
    s.addEventListener('click', () => {
      localStorage.removeItem('user');
      updateUserNav();
      location.href = 'index.html';
    });
    nav.appendChild(s);
  } else {
    const a = document.createElement('a');
    a.href = 'login.html';
    a.textContent = 'Entrar';
    a.addEventListener('click', () => {
      const href = location.href;
      const path = href.substring(href.lastIndexOf('/') + 1);
      localStorage.setItem('postLoginRedirect', path);
    });
    nav.appendChild(a);
  }
}
updateUserNav();

/* ===== Localidades (iguais às que você já usa) ===== */
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

/* ===== Helpers ===== */
const $ = (q) => document.querySelector(q);
function setMinToday(input){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  input.min = `${yyyy}-${mm}-${dd}`;
}
function datalist(input, list){
  const update = () => {
    const s = input.value.toLowerCase();
    list.innerHTML = '';
    if (!s) return;
    localities.filter(l => l.descricao.toLowerCase().startsWith(s))
      .forEach(l => {
        const o = document.createElement('option');
        o.value = l.descricao; o.dataset.id = l.id; list.appendChild(o);
      });
  };
  input.addEventListener('input', update);
}

/* ===== Estado ===== */
const state = {
  leg: 'IDA',                 // 'IDA' ou 'VOLTA'
  search: null,               // ida
  searchReturn: null,         // volta (opcional)
  selected: []                // [{leg, schedule, seats, passengers}]
};

/* ===== Elementos da direita ===== */
const listPanel   = $('#panel-schedules');
const seatsPanel  = $('#panel-seats');
const listContainer  = $('#schedule-list');
const statusEl       = $('#no-results');
const seatsContainer = $('#seats-container');
const legendList  = $('#legend-list');
const legendSeats = $('#legend-seats');
const backBtn     = $('#btn-back');
const contentActions = $('#content-actions');

/* ===== Sidebar ===== */
const originInput = $('#origin');
const destInput   = $('#destination');
const dateInput   = $('#date');
const retInput    = $('#return-date');
datalist(originInput, $('#origin-suggestions'));
datalist(destInput,   $('#destination-suggestions'));
setMinToday(dateInput);
setMinToday(retInput);

/* ===== Navegação interna (só muda o painel da direita) ===== */
function showList(){
  listPanel.hidden  = false;
  seatsPanel.hidden = true;
  contentActions.hidden = false;
}
function showSeats(){
  listPanel.hidden  = true;
  seatsPanel.hidden = false;
  contentActions.hidden = false;
}

/* ===== Pesquisar (alimenta state e abre lista da IDA) ===== */
$('#search-form').addEventListener('submit', (e)=>{
  e.preventDefault();

  const originName = originInput.value.trim();
  const destName   = destInput.value.trim();
  const date       = dateInput.value;

  if (!originName || !destName || !date) {
    alert('Preencha origem, destino e data da ida.');
    return;
  }

  const o = localities.find(l => l.descricao.toLowerCase() === originName.toLowerCase());
  const d = localities.find(l => l.descricao.toLowerCase() === destName.toLowerCase());
  if (!o || !d) { alert('Origem/Destino inválidos. Selecione uma opção sugerida.'); return; }

  state.leg = 'IDA';
  state.selected = [];
  state.search = {
    originId: o.id, originName: o.descricao,
    destinationId: d.id, destinationName: d.descricao,
    date
  };

  state.searchReturn = retInput.value ? {
    originId: d.id, originName: d.descricao,
    destinationId: o.id, destinationName: o.descricao,
    date: retInput.value
  } : null;

  legendList.textContent = 'Viagens disponíveis (ida)';
  showList();
  renderLegSchedules();
});

/* ===== Voltar (da direita) ===== */
backBtn.addEventListener('click', ()=>{
  if (!seatsPanel.hidden) {
    // estava em SEATS → volta para lista do mesmo trecho
    showList();
    renderLegSchedules();
  } else {
    // estava em LIST → volta para permitir nova busca (opcional)
    statusEl.textContent = '';
    listContainer.innerHTML = '';
  }
});

/* ===== Render de LISTA por trecho ===== */
function renderLegSchedules(){
  const params = state.leg === 'IDA' ? state.search : state.searchReturn;
  listContainer.innerHTML = '';
  statusEl.textContent = 'Buscando viagens disponíveis...';
  renderSchedules(listContainer, statusEl, params, (schedule)=>{
    // ao selecionar uma viagem, abre o mapa
    state.selected = state.selected.filter(s => s.leg !== state.leg);
    state.selected.push({ leg: state.leg, schedule });
    legendSeats.textContent = `Escolha suas poltronas (${state.leg.toLowerCase()})`;
    showSeats();
    renderLegSeats(schedule);
  });
}

/* ===== Render do MAPA por trecho ===== */
function renderLegSeats(schedule){
  seatsContainer.innerHTML = '';
  renderSeats(seatsContainer, schedule, (payload)=>{
    const idx = state.selected.findIndex(s => s.leg === state.leg);
    if (idx >= 0) state.selected[idx] = { ...payload, leg: state.leg };

    // se tiver volta e acabamos a IDA, vamos para a VOLTA (lista)
    if (state.leg === 'IDA' && state.searchReturn){
      state.leg = 'VOLTA';
      legendList.textContent = 'Viagens disponíveis (volta)';
      showList();
      renderLegSchedules();
      return;
    }

    // fim: salva e vai para pagamento
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
