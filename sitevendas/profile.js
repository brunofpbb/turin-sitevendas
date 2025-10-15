// profile.js — cancelamento com modo "preview" e render estável
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

  // Estado local: qual card está em "preview" (memória de cálculo)
  let previewId = null;

  // regra: pode cancelar se faltarem >= 12h para a partida (hora São Paulo, UTC-3)
  const CAN_HOURS = 12;
  const ms12h = CAN_HOURS * 60 * 60 * 1000;

  function parseDeparture(schedule){
    const date = pick(schedule.date);
    const time = pick(schedule.departureTime, schedule.horaPartida, '00:00');
    const s = `${date}T${String(time).padStart(5,'0')}:00-03:00`; // UTC−3
    const t = Date.parse(s);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  function mayCancel(schedule){
    const dep = parseDeparture(schedule);
    if (!dep) return false;
    return (dep.getTime() - Date.now()) >= ms12h;
  }

  const loadAll = ()=> JSON.parse(localStorage.getItem('bookings') || '[]');
  const saveAll = (arr)=> localStorage.setItem('bookings', JSON.stringify(arr));

  function flagCancelled(id){
    const all = loadAll();
    const i = all.findIndex(b => String(b.id) === String(id));
    if (i >= 0) {
      all[i].cancelledAt = new Date().toISOString();
      saveAll(all);
    }
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
      const pax   = Array.isArray(b.passengers) ? b.passengers.map(p => `Pol ${p.seatNumber}: ${p.name}`) : [];
      const cancelable = !b.cancelledAt && mayCancel(s);
      const statusText = b.cancelledAt ? 'Cancelada' : 'Pago';

      // ——— quando for o card em preview, não renderiza o botão Cancelar (ele some)
      const showPreview = previewId === String(b.id);

      const paidAmount = Number(b.price || 0);
      const fee  = +(paidAmount * 0.05).toFixed(2);
      const back = +(paidAmount - fee).toFixed(2);

      return `
        <div class="schedule-card card-grid" data-id="${b.id}">
          <div class="card-left">
            <div class="schedule-header">
              <div><b>${pick(s.originName, s.origin, s.origem)}</b> → <b>${pick(s.destinationName, s.destination, s.destino)}</b></div>
              <div><b>Data:</b> ${pick(s.date)}</div>
              <div><b>Saída:</b> ${pick(s.departureTime, s.horaPartida)}</div>
              <div><b>Total:</b> ${fmtBRL(b.price || 0)}</div>
            </div>
            <div class="schedule-body" ${showPreview ? 'style="display:none"' : ''}>
              <div><b>Poltronas:</b> ${seats || '—'}</div>
              ${pax.length ? `<div><b>Passageiros:</b> ${pax.join(', ')}</div>` : ''}
              <div><b>Status:</b> ${statusText}</div>
            </div>

            ${showPreview ? `
              <div class="calc-box">
                <div class="calc-cols">
                  <div class="calc-left">
                    <div class="calc-row"><span>Origem:</span><b>${pick(s.originName, s.origin, s.origem)}</b></div>
                    <div class="calc-row"><span>Destino:</span><b>${pick(s.destinationName, s.destination, s.destino)}</b></div>
                    <div class="calc-row"><span>Data:</span><b>${pick(s.date)}</b></div>
                    <div class="calc-row"><span>Saída:</span><b>${pick(s.departureTime, s.horaPartida)}</b></div>
                  </div>
                  <div class="calc-right">
                    <div class="calc-row"><span>Valor pago:</span><b>${fmtBRL(paidAmount)}</b></div>
                    <div class="calc-row"><span>Multa (5%):</span><b>${fmtBRL(fee)}</b></div>
                    <div class="calc-row total"><span>Valor a reembolsar:</span><b>${fmtBRL(back)}</b></div>
                  </div>
                </div>
                <div class="actions" style="margin-top:10px">
                  <button class="btn btn-primary" data-act="do-cancel" data-id="${b.id}">Realizar cancelamento</button>
                  <button class="btn btn-ghost" data-act="close-preview">Voltar</button>
                </div>
              </div>
            ` : ''}
          </div>

          <div class="card-right">
            ${(!showPreview && !b.cancelledAt)
              ? `<button class="${cancelable ? 'btn btn-primary' : 'btn btn-disabled'} btn-cancel"
                         ${cancelable ? '' : 'disabled'}
                         data-id="${b.id}">Cancelar</button>`
              : ''}
          </div>
        </div>
      `;
    }).join('');

    // Handlers — são recriados a cada render (evita “botões sem ação”)
    listEl.querySelectorAll('.btn-cancel').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.getAttribute('data-id');
        previewId = id;       // entra em modo preview
        render();             // refaz a lista (botão some, preview aparece)
      });
    });

    listEl.querySelectorAll('[data-act="close-preview"]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        previewId = null;     // sai do preview
        render();
      });
    });

    listEl.querySelectorAll('[data-act="do-cancel"]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.getAttribute('data-id');
        if (!confirm('Confirmar cancelamento desta viagem?')) return;
        flagCancelled(id);
        previewId = null;
        render();
        alert('Cancelamento realizado com sucesso. O reembolso será processado conforme as regras.');
      });
    });
  }

  render();
});
