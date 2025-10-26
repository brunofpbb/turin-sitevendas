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

  // ===== utils extras (usar onde renderiza a lista) =====
function seatFromTicket(t) {
  // aceita t.Poltrona / t.poltrona / t.seatNumber
  return Number(t?.Poltrona ?? t?.poltrona ?? t?.seatNumber ?? 0) || 0;
}
function ticketNumberOf(t) {
  return t?.numPassagem ?? t?.NumPassagem ?? t?.numero ?? null;
}
function driveUrlOf(t) {
  return t?.driveUrl ?? t?.url ?? t?.pdfLocal ?? null;
}
function samePlace(a, b) {
  if (!a || !b) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
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

// ===== Render: 1 card por BILHETE =====
async function renderReservations() {
  const container = document.getElementById('reservas-list') 
                 || document.querySelector('#reservas .list')
                 || document.querySelector('#reservas'); // último fallback

  if (!container) return;

  // 1) Carrega compras locais (apenas pagos) — o que o payment grava
  const all = JSON.parse(localStorage.getItem('bookings') || '[]');
  const paid = all.filter(b => b.paid === true);

  // 2) Explode cada compra em tickets individuais
  //    (se ainda não tiver tickets salvos, cria um “ticket” vazio para manter compatível)
  const localTickets = [];
  for (const bk of paid) {
    const s = bk.schedule || {};
    const paxArr = Array.isArray(bk.passengers) ? bk.passengers : [];
    const tArr  = Array.isArray(bk.tickets) ? bk.tickets : [{ /* vazio */ }];

for (const t of tArr) {
  const seat = seatFromTicket(t) ||
               (paxArr.find(p => (p?.seatNumber ?? p?.poltrona) != null)?.seatNumber ?? null);
  const pax  = paxArr.find(p => Number(p.seatNumber ?? p.poltrona) === seat) || paxArr[0] || {};

  // preço unitário (se b.price for total do trecho com várias poltronas)
  const seatsCount = Array.isArray(bk.seats) ? bk.seats.length : 1;
  const unit = seatsCount > 0 ? (Number(bk.price || 0) / seatsCount) : 0;

  localTickets.push({
    origem:  s.originName || s.origin || s.origem || '',
    destino: s.destinationName || s.destination || s.destino || '',
    data:    s.date || s.dataViagem || s.DataViagem || '',
    hora:    s.departureTime || s.horaPartida || '',
    seat,
    passageiro: pax.name || pax.nome || '',
    status: 'Pago',
    ticketNumber: ticketNumberOf(t),
    url: driveUrlOf(t),
    idaVolta: bk.tripType || bk.idaVolta || null, // pode vir do fluxo novo
    price: Number.isFinite(unit) ? +unit.toFixed(2) : 0
  });
}

  }

  // 3) (Opcional) Consultar o Sheets também e mesclar aqui se quiser.
  //    Se já estiver buscando do Sheets em outro ponto, mantenha seu fetch
  //    e converta cada linha do Sheets para este mesmo shape e concatene em `localTickets`.

  // 4) Heurística simples para marcar ida/volta quando vier nulo
  localTickets.forEach((tk, i) => {
    if (tk.idaVolta) return;
    // se existir outro ticket com origem/destino invertidos no mesmo dia, marca como 'volta'
    const inv = localTickets.find(o =>
      o !== tk &&
      tk.data && samePlace(o.data, tk.data) &&
      samePlace(o.origem, tk.destino) &&
      samePlace(o.destino, tk.origem)
    );
    tk.idaVolta = inv ? 'volta' : 'ida';
  });

  // 5) Ordenação: por data/hora
  const toKey = (d, h) => `${String(d||'').replaceAll('/','-')} ${h||''}`;
  localTickets.sort((a,b) => toKey(a.data,a.hora).localeCompare(toKey(b.data,b.hora)));

  // 6) Monta HTML de cada TICKET (um card por bilhete)
  const lines = localTickets.map(tk => {
    const dataBR = (typeof formatDateBR === 'function') ? formatDateBR(tk.data) : tk.data;
    const btnBilhete = tk.url
      ? `<button class="btn btn-success" onclick="window.open('${tk.url}','_blank')">Ver Bilhete</button>`
      : `<button class="btn btn-secondary" disabled>Ver Bilhete</button>`;

    // rótulo ida/volta apenas informativo
    const way = tk.idaVolta === 'volta' ? 'Volta' : 'Ida';

    return `
      <div class="reserva">
        <div><b>${tk.origem}</b> → <b>${tk.destino}</b>  <span class="badge">${way}</span></div>
        <div>Data: <b>${dataBR}</b> &nbsp; Saída: <b>${tk.hora || '—'}</b> &nbsp; Total: <b>${fmtBRL(tk.price || 0)}</b></div>
        <div>Poltronas: ${tk.seat || '—'} &nbsp;&nbsp; Passageiros: ${tk.passageiro || '—'} &nbsp;&nbsp; <b>Status:</b> ${tk.status}</div>
        <div>Bilhete nº: <b>${tk.ticketNumber || '—'}</b></div>
        <div class="actions" style="margin-top:8px; display:flex; gap:10px">
          ${btnBilhete}
          <button class="btn btn-danger" data-action="cancel" data-seat="${tk.seat}">Cancelar</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = lines.join('') || '<p class="mute">Nenhuma reserva encontrada.</p>';

  // 7) (Opcional) wire de “Cancelar”
  container.querySelectorAll('[data-action="cancel"]').forEach(btn => {
    btn.addEventListener('click', () => {
      alert('Cancelar por bilhete ainda não implementado aqui.'); 
      // Se você já tem a lógica, chame-a passando o seat/ticket.
    });
  });
}

  // inicializa a tela
  await renderReservations();
});
