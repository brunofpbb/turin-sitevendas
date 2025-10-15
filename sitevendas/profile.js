// profile.js — lista compras pagas e mostra botão Cancelar quando possível
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
    const now = Date.now();        // epoch UTC
    return (dep.getTime() - now) >= ms12h;
  }

  function loadPaid(){
    const all = JSON.parse(localStorage.getItem('bookings') || '[]');
    // mantém itens pagos, mas mostra "Cancelada" quando tiver flag cancelledAt
    return all.filter(b => b.paid === true);
  }

  function saveBookings(next){
    localStorage.setItem('bookings', JSON.stringify(next));
  }

  function cancelBooking(id){
    const all = JSON.parse(localStorage.getItem('bookings') || '[]');
    const idx = all.findIndex(b => String(b.id) === String(id));
    if (idx === -1) return;
    all[idx].cancelledAt = new Date().toISOString();
    saveBookings(all);
  }

  function render(){
    const paid = loadPaid();

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

      // botão cancelar: verde quando ativo, cinza e desabilitado quando não for possível
      const btnClass = cancelable ? 'btn btn-primary btn-cancel'
                                  : 'btn btn-disabled btn-cancel';
      const btnAttr  = cancelable ? `data-id="${b.id}"` : 'disabled';

      return `
        <div class="schedule-card" style="margin-bottom:10px">
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

          <div class="actions" style="margin-top:10px">
            <button ${btnAttr} class="${btnClass}">Cancelar</button>
          </div>
        </div>
      `;
    }).join('');

    // bind cancelamento
    listEl.querySelectorAll('.btn-cancel[data-id]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.getAttribute('data-id');
        const ok = confirm('Confirmar cancelamento desta viagem?');
        if (!ok) return;
        cancelBooking(id);
        render(); // re-renderiza a lista (botão fica cinza e status "Cancelada")
      });
    });
  }

  render();
});
