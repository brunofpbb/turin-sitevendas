// profile.js — mostra apenas compras finalizadas (pagas) em layout simples
document.addEventListener('DOMContentLoaded', () => {
  if (typeof updateUserNav === 'function') updateUserNav();

  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) {
    alert('Você precisa estar logado para ver suas viagens.');
    localStorage.setItem('postLoginRedirect', 'profile.html');
    window.location.href = 'login.html';
    return;
  }

  const box = document.getElementById('booking-list') || document.getElementById('trips-list');
  if (!box) return;

  const all = JSON.parse(localStorage.getItem('bookings') || '[]');
  const paid = all.filter(b => b.paid === true);

  const fmt = (n)=> (Number(n)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '') ?? '—';

  if (!paid.length){
    box.innerHTML = '<p class="mute">Nenhuma compra finalizada encontrada.</p>';
  } else {
    box.innerHTML = paid.map(it=>{
      const s = it.schedule || {};
      const origem  = pick(s.originName, s.origin, s.origem);
      const destino = pick(s.destinationName, s.destination, s.destino);
      const data    = pick(s.date);
      const hora    = pick(s.departureTime, s.horaPartida);
      const seats   = (it.seats||[]).join(', ');
      const paxList = Array.isArray(it.passengers) ? it.passengers.map(p=>`Pol ${p.seatNumber}: ${p.name}`) : [];
      return `
        <div class="schedule-card" style="margin-bottom:10px">
          <div class="schedule-header">
            <div><b>${origem}</b> → <b>${destino}</b></div>
            <div><b>Data:</b> ${data}</div>
            <div><b>Saída:</b> ${hora}</div>
            <div><b>Total:</b> ${fmt(it.price||0)}</div>
          </div>
          <div class="schedule-body">
            <div><b>Poltronas:</b> ${seats || '—'}</div>
            ${paxList.length ? `<div><b>Passageiros:</b> ${paxList.join(', ')}</div>` : ''}
            <div><b>Status:</b> Pago</div>
          </div>
        </div>
      `;
    }).join('');
  }

  const back = document.getElementById('back-btn');
  if (back) back.addEventListener('click', ()=> window.location.href = 'index.html');
});
