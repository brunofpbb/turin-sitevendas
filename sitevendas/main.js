// main.js (módulo) – Orquestra busca → lista (ida/volta) → poltronas (ida/volta)
import { renderSchedules } from './schedules.js';
import { renderSeats } from './seats.js';

// ====== util navegação do usuário (mesmo comportamento do seu arquivo atual)
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

// ====== dataset de localidades (igual ao seu)
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

// ====== helpers UI
const $ = (sel) => document.querySelector(sel);
function setMinToday(input){
  if (!input) return;
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

// ====== estados
const state = {
  search: null,                // params da ida
  searchReturn: null,          // params da volta (se houver)
  selected: [],                // [{leg: 'IDA'|'VOLTA', schedule, seats[], passengers[]}]
  leg: 'IDA'                   // ou 'VOLTA'
};

// ====== elementos
const stepSearch    = $('#step-search');
const stepSchedules = $('#step-schedules');
const stepSeats     = $('#step-seats');

const legendList = $('#legenda-lista');
const legendSeats = $('#legenda-seats');

const listContainer  = $('#schedule-list');
const noResultsEl    = $('#no-results');
const seatsContainer = $('#seats-container');

// ====== inicialização busca
const originInput = $('#origin');
const destInput   = $('#destination');
const dateInput   = $('#date');
const retInput    = $('#return-date');
datalist(originInput, $('#origin-suggestions'));
datalist(destInput,   $('#destination-suggestions'));
setMinToday(dateInput);
setMinToday(retInput);

// ====== fluxo
function showStep(which){
  stepSearch.hidden = which !== 'search';
  stepSchedules.hidden = which !== 'schedules';
  stepSeats.hidden = which !== 'seats';
}
showStep('search');

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

  state.search = {
    originId: o.id, originName: o.descricao,
    destinationId: d.id, destinationName: d.descricao,
    date
  };

  // retorno opcional
  state.searchReturn = null;
  if (retInput.value) {
    state.searchReturn = {
      originId: d.id, originName: d.descricao,
      destinationId: o.id, destinationName: o.descricao,
      date: retInput.value
    };
  }

  state.leg = 'IDA';
  legendList.textContent = 'Viagens disponíveis (ida)';
  showStep('schedules');
  renderLegSchedules();
});

$('#back-to-search').addEventListener('click', ()=> showStep('search'));
$('#cancel-seats').addEventListener('click', ()=> {
  // volta para a lista da perna atual
  showStep('schedules');
  renderLegSchedules();
});

function renderLegSchedules(){
  const params = state.leg === 'IDA' ? state.search : state.searchReturn;
  listContainer.innerHTML = '';
  noResultsEl.textContent = 'Buscando viagens disponíveis...';
  renderSchedules(listContainer, noResultsEl, params, (schedule)=>{
    // onSelect
    state.selected = state.selected.filter(s => s.leg !== state.leg); // limpa escolha anterior da mesma perna
    state.selected.push({ leg: state.leg, schedule });
    legendSeats.textContent = `Escolha suas poltronas (${state.leg.toLowerCase()})`;
    showStep('seats');
    renderLegSeats(schedule);
  });
}

function renderLegSeats(schedule){
  seatsContainer.innerHTML = '';
  renderSeats(seatsContainer, schedule, (payload)=>{
    // payload = { schedule, seats:[n], passengers:[{...}] }
    const idx = state.selected.findIndex(s => s.leg === state.leg);
    if (idx >= 0) state.selected[idx] = { ...payload, leg: state.leg };

    // Próximo passo: se tem volta e ainda estamos na ida → ir para volta
    if (state.leg === 'IDA' && state.searchReturn){
      state.leg = 'VOLTA';
      legendList.textContent = 'Viagens disponíveis (volta)';
      legendSeats.textContent = 'Escolha suas poltronas (volta)';
      showStep('schedules');
      renderLegSchedules();
      return;
    }

    // Finalizar → exigir login e gravar bookings como antes
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
      // pendente para depois do login
      localStorage.setItem('pendingPurchase', JSON.stringify({
        legs: toSave
      }));
      localStorage.setItem('postLoginRedirect', 'payment.html');
      location.href = 'login.html';
      return;
    }

    localStorage.setItem('bookings', JSON.stringify([...bookings, ...toSave]));
    localStorage.removeItem('pendingPurchase');
    location.href = 'payment.html';
  });
}
