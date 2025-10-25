// profile.js — Minhas viagens (link do Drive + regra de cancelamento 12h + dedup)
document.addEventListener('DOMContentLoaded', () => {
  if (typeof updateUserNav === 'function') updateUserNav();

  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) {
    alert('Você precisa estar logado para ver suas viagens.');
    localStorage.setItem('postLoginRedirect', 'profile.html');
    location.replace('login.html');
    return;
  }

  const listEl = document.getElementById('trips-list');
  if (!listEl) {
    console.warn('[profile] #trips-list não encontrado.');
    return;
  }

  // usado para abrir/fechar o preview de cancelamento
  let previewId = null;

  const fmtBRL = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '') ?? '—';

  // ===== Helpers de data/hora (fuso −03:00) =====
  const TZ_OFFSET_MIN = 180; // -03:00
  const MS_12H = 12 * 60 * 60 * 1000;

  function parseISOorBR(dateStr) {
    if (!dateStr) return null;
    // "YYYY-MM-DD"
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    }
    // "DD/MM/YYYY"
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
      const [d, m, y] = dateStr.split('/').map(Number);
      return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    }
    const t = Date.parse(dateStr);
    return Number.isFinite(t) ? new Date(t) : null;
  }

  function parseTimeHHMM(hhmm) {
    if (!hhmm) return { h: 0, m: 0 };
    const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
    return m ? { h: +m[1], m: +m[2] } : { h: 0, m: 0 };
  }

  /** Date de partida no fuso −03:00 */
  function getDepartureDate(s) {
    const d = parseISOorBR(s?.date || s?.dataViagem);
    const { h, m } = parseTimeHHMM(s?.departureTime || s?.horaPartida);
    if (!d) return null;
    const depUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0);
    // aplica o offset -03:00
    return new Date(depUTC + TZ_OFFSET_MIN * -60 * 1000);
  }

  /** Pode cancelar apenas se faltarem >= 12 horas para a partida */
  function mayCancel(schedule) {
    const dep = getDepartureDate(schedule);
    if (!dep) return false; // sem data/hora válidas => não permite
    const msUntil = dep.getTime() - Date.now();
    return msUntil >= MS_12H;
  }

  // ===== Storage helpers =====
  const loadAll = () => JSON.parse(localStorage.getItem('bookings') || '[]');
  const saveAll = (arr) => localStorage.setItem('bookings', JSON.stringify(arr));

  // marcar cancelado localmente
  function flagCancelled(id) {
    const all = loadAll();
    const i = all.findIndex(b => String(b.id) === String(id));
    if (i >= 0) {
      all[i].cancelledAt = new Date().toISOString();
      saveAll(all);
    }
  }

  // ===== Ordenação (mais recente primeiro) =====
  const parseTs = (v) => {
    if (!v) return NaN;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) return t;
    }
    return NaN;
  };

  function sortPaidDesc(paid, originalAll) {
    const withIdx = paid.map((b) => {
      const idxInAll = originalAll.findIndex(x => x === b);
      const ts =
        parseTs(b.paidAt) ??
        parseTs(b.dataVenda) ??
        parseTs(b.vendaAt) ??
        parseTs(b.createdAt) ??
        parseTs(b.created_at);
      return { b, ts: Number.isNaN(ts) ? -1 : ts, idxInAll };
    });
    withIdx.sort((a, c) => (c.ts - a.ts) || (c.idxInAll - a.idxInAll));
    return withIdx.map(x => x.b);
  }

  // ===== Deduplicação básica (por ticketNumber ou chave composta) =====
  function uniqBy(arr, keyFn) {
    const seen = new Set();
    return arr.filter(x => {
      const k = keyFn(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // ---- Normaliza "paid" em cartões unitários (1 bilhete por card) ----
  function explodePaidIntoTickets(paid) {
    const out = [];

    for (const b of paid) {
      const s = b.schedule || {};
      const seats = Array.isArray(b.seats) ? b.seats : [];
      const pax   = Array.isArray(b.passengers) ? b.passengers : [];
      const tickets = Array.isArray(b.tickets) ? b.tickets : [];

      // 1) Quando já temos tickets (drive/pdf) – usar 1 por card
      if (tickets.length) {
        // tentar achar preço unitário
        const unit = seats.length > 1 ? Number(b.price || 0) / seats.length : Number(b.price || 0);

        tickets.forEach((t, idx) => {
          const seatNumber = (seats[idx] ?? pax[idx]?.seatNumber ?? null);
          const passenger  = pax[idx] || null;

          out.push({
            ...b,
            // sobrescreve por-bilhete
            seats: seatNumber ? [seatNumber] : [],
            passengers: passenger ? [passenger] : [],
            price: Number.isFinite(unit) ? +unit.toFixed(2) : (b.price || 0),

            // “fixa” o link/numero nesse card
            ticketNumber: t.numPassagem || t.NumPassagem || b.ticketNumber || null,
            driveUrl: t.driveUrl || b.driveUrl || null,
            pdfLocal: t.pdfLocal || b.pdfLocal || null,

            // só para o template saber que veio de “explosão”
            _ticket: t
          });
        });
        continue;
      }

      // 2) Sem tickets ainda: abrir 1 card por poltrona
      if (seats.length > 1) {
        const unit = Number(b.price || 0) / seats.length;

        seats.forEach((seat, idx) => {
          const passenger = pax[idx] || null;
          out.push({
            ...b,
            seats: [seat],
            passengers: passenger ? [passenger] : [],
            price: Number.isFinite(unit) ? +unit.toFixed(2) : (b.price || 0),
            _ticket: null,
          });
        });
        continue;
      }

      // 3) Caso normal (já é unitário)
      out.push(b);
    }

    return out;
  }





  
  function render() {
        let all = loadAll();

    // mantém apenas pagos
    let paid = all.filter(b => b.paid === true);

    // explode em itens unitários (1 bilhete / 1 poltrona por card)
    paid = explodePaidIntoTickets(paid);

    // dedup tenta usar ticketNumber; se não tiver, usa chave composta “unitária”
    paid = uniqBy(paid, b => {
      const s = b.schedule || {};
      const seat = (b.seats || [])[0] || '';
      return String(b.ticketNumber || `${s.date}|${s.originId || s.idOrigem}|${s.destinationId || s.idDestino}|${seat}|${b.price}`);
    });


    paid = sortPaidDesc(paid, all);

    if (!paid.length) {
      listEl.innerHTML = '<p class="mute">Nenhuma compra finalizada encontrada.</p>';
      return;
    }

    listEl.innerHTML = paid.map(b => {
      const s = b.schedule || {};
      const seats = (b.seats || []).join(', ');
      const pax = Array.isArray(b.passengers) ? b.passengers.map(p => `Pol ${p.seatNumber}: ${p.name}`) : [];
      const cancelable = !b.cancelledAt && mayCancel(s);
      const statusText = b.cancelledAt ? 'Cancelada' : 'Pago';
      const showPreview = previewId === String(b.id);

      const paidAmount = Number(b.price || 0);
      const fee = +(paidAmount * 0.05).toFixed(2);
      const back = +(paidAmount - fee).toFixed(2);

      // Link do bilhete salvo no booking (preferência: Drive)
      const bookingTicketUrl = b.driveUrl || b.pdfLocal || b.ticketUrl || null;
      const bookingTicketNum = b.ticketNumber || b.numPassagem || (b._ticket?.numPassagem) || null;

      const cancelBtnHtml = `
        <button class="btn btn-danger btn-cancel"
                data-id="${b.id}"
                ${cancelable ? '' : 'disabled aria-disabled="true" style="opacity:.5;cursor:not-allowed"'}
        >Cancelar</button>
      `;

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
              <div class="bilhete-num" style="margin-top:6px;">${bookingTicketNum ? `<b>Bilhete nº:</b> ${bookingTicketNum}` : ''}</div>
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
            <div class="reserva-actions">
              ${ bookingTicketUrl && !showPreview
                  ? `<a class="btn btn-success" href="${bookingTicketUrl}" target="_blank" rel="noopener">Ver Bilhete</a>`
                  : ''
              }
              ${ !showPreview ? cancelBtnHtml : '' }
            </div>
          </div>
        </div>
      `;
    }).join('');

    // ===== Handlers =====
    // Cancelar (mostra preview) — ignora se desabilitado
    listEl.querySelectorAll('.btn-cancel').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.hasAttribute('disabled')) return;
        const id = btn.getAttribute('data-id');
        previewId = id;
        render();
      });
    });

    // Fechar preview
    listEl.querySelectorAll('[data-act="close-preview"]').forEach(btn => {
      btn.addEventListener('click', () => {
        previewId = null;
        render();
      });
    });

    // Confirmar cancelamento (efeito local)
    listEl.querySelectorAll('[data-act="do-cancel"]').forEach(btn => {
      btn.addEventListener('click', () => {
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
