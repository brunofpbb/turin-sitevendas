// profile.js — lista compras pagas, botão cancelar com memória de cálculo e layout sem “folgas”
document.addEventListener('DOMContentLoaded', () => {
  if (typeof updateUserNav === 'function') updateUserNav();

  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) {
    alert('Você precisa estar logado para ver suas viagens.');
    localStorage.setItem('postLoginRedirect', 'profile.html');
    return location.replace('login.html');
  }

  const listEl = document.getElementById('trips-list');
  const fmtBRL = (n)=> (Number(n)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const pick   = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '') ?? '—';

  // regra: pode cancelar se faltarem >= 12h para a partida (hora São Paulo, UTC-3)
  const CAN_HOURS = 12;
  const ms12h = CAN_HOURS * 60 * 60 * 1000;

  function parseDeparture(schedule){
    const date = pick(schedule.date);
    const time = pick(schedule.departureTime, schedule.horaPartida, '00:00');
    // ISO com timezone fixo -03:00 (São Paulo)
    const s = `${date}T${String(time).padStart(5,'0')}:00-03:00`;
    const t = Date.parse(s);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  function mayCancel(schedule){
    const dep = parseDeparture(schedule);
    if (!dep) return false;
    const now = Date.now();
    return (dep.getTime() - now) >= ms12h;
  }

  function loadAll(){ return JSON.parse(localStorage.getItem('bookings') || '[]'); }
  function saveAll(next){ localStorage.setItem('bookings', JSON.stringify(next)); }

  function flagCancelled(id){
    const all = loadAll();
    const idx = all.findIndex(b => String(b.id) === String(id));
    if (idx === -1) return;
    all[idx].cancelledAt = new Date().toISOString();
    saveAll(all);
  }

  function render(){
    const all  = loadAll();
    const paid = all.filter(b => b.paid === true);

    if (!paid.length){
      listEl.innerHTML = '<p class="mute">Nenhuma compra finalizada encontrada.</p>';
      return;
    }

    listEl.innerHTML = paid.map(b=>{
      const s = b.schedule || {};
      const seats = (b.seats || []).join(', ');
      const paxList = Array.isArray(b.passengers) ? b.passengers.map(p => `Pol ${p.seatNumber}: ${p.name}`) : [];
      const cancelable = !b.cancelledAt && mayCancel(s);
      const statusText = b.cancelledAt ? 'Cancelada' : 'Pago';

      return `
        <div class="schedule-card card-grid" data-id="${b.id}">
          <div class="card-left">
            <div class="schedule-header">
              <div><b>${pick(s.originName, s.origin, s.origem)}</b> → <b>${pick(s.destinationName, s.destination, s.destino)}</b></div>
              <div><b>Data:</b> ${pick(s.date)}</div>
              <div><b>Saída:</b> ${pick(s.departureTime, s.horaPartida)}</div>
              <div><b>Total:</b> ${fmtBRL(b.price || 0)}</div>
            </div>
            <div class="schedule-body">
              <div><b>Poltronas:</b> ${seats || '—'}</div>
              ${paxList.length ? `<div><b>Passageiros:</b> ${paxList.join(', ')}</div>` : ''}
              <div><b>Status:</b> ${statusText}</div>
            </div>
            <!-- área onde entra o preview de cancelamento -->
            <div class="cancel-preview" hidden></div>
          </div>

          <div class="card-right">
            <button class="${cancelable ? 'btn btn-primary' : 'btn btn-disabled'} btn-cancel"
                    ${cancelable ? '' : 'disabled'}
                    data-id="${b.id}">
              Cancelar
            </button>
          </div>
        </div>
      `;
    }).join('');

    // binds
    listEl.querySelectorAll('.btn-cancel').forEach(btn=>{
      const id = btn.getAttribute('data-id');
      btn.addEventListener('click', ()=> openCancelPreview(id));
    });
  }

  function openCancelPreview(id){
    // pega card
    const card = listEl.querySelector(`.schedule-card[data-id="${id}"]`);
    if (!card) return;
    const left   = card.querySelector('.card-left');
    const body   = left.querySelector('.schedule-body');
    const right  = card.querySelector('.card-right');
    const btn    = right.querySelector('.btn-cancel');
    const prevEl = left.querySelector('.cancel-preview');

    // pega dados
    const item = loadAll().find(b => String(b.id) === String(id));
    if (!item) return;

    const s = item.schedule || {};
    const paid = Number(item.price || 0);
    const fee  = +(paid * 0.05).toFixed(2);
    const back = +(paid - fee).toFixed(2);

    // mostra preview (memória de cálculo)
    prevEl.innerHTML = `
      <div class="calc-box">
        <div class="calc-row"><span>Origem:</span><b>${s.originName || s.origin || s.origem || '—'}</b></div>
        <div class="calc-row"><span>Destino:</span><b>${s.destinationName || s.destination || s.destino || '—'}</b></div>
        <div class="calc-row"><span>Data:</span><b>${s.date || '—'}</b></div>
        <div class="calc-row"><span>Saída:</span><b>${s.departureTime || s.horaPartida || '—'}</b></div>
        <hr>
        <div class="calc-row"><span>Valor pago:</span><b>${fmtBRL(paid)}</b></div>
        <div class="calc-row"><span>Multa (5%):</span><b>${fmtBRL(fee)}</b></div>
        <div class="calc-row total"><span>Valor a reembolsar:</span><b>${fmtBRL(back)}</b></div>
        <div class="actions" style="margin-top:10px">
          <button class="btn btn-primary" data-act="do-cancel">Realizar cancelamento</button>
          <button class="btn btn-ghost" data-act="close-preview">Voltar</button>
        </div>
      </div>
    `;
    prevEl.hidden = false;

    // esconde linhas originais
    body.style.display = 'none';
    btn.disabled = true; btn.className = 'btn btn-disabled';

    // actions
    prevEl.querySelector('[data-act="close-preview"]').onclick = ()=>{
      prevEl.hidden = true;
      body.style.display = '';
      // reabilita o botão se ainda for cancelável
      const can = mayCancel(s) && !item.cancelledAt;
      btn.disabled = !can; btn.className = can ? 'btn btn-primary' : 'btn btn-disabled';
    };
    prevEl.querySelector('[data-act="do-cancel"]').onclick = ()=>{
      if (!confirm('Confirmar cancelamento desta viagem?')) return;
      flagCancelled(id);
      render();
      alert('Cancelamento realizado com sucesso. O valor a reembolsar será processado conforme as regras.');
    };
  }

  render();
});
