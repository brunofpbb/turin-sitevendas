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

const listEl = document.getElementById('trips-list'); // opcional; não bloquear se não existir


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

  // CORREÇÃO: somar o offset de −03:00 (180 min) para obter o instante correto
  return new Date(depUTC + TZ_OFFSET_MIN * 60 * 1000);
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

// <<< COLE AQUI
function hydrateUrlsByTicketNumber(localTickets) {
  const byNum = {};

  try {
    const last = JSON.parse(localStorage.getItem('lastTickets') || '[]');
    last.forEach(t => {
      const n = t.numPassagem || t.NumPassagem;
      if (n && (t.driveUrl || t.pdfLocal)) byNum[n] = t.driveUrl || t.pdfLocal;
    });
  } catch {}

  try {
    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    bookings.forEach(bk => {
      (bk.tickets || []).forEach(t => {
        const n = t.numPassagem || t.NumPassagem;
        const url = t.driveUrl || t.pdfLocal || t.url;
        if (n && url) byNum[n] = url;
      });
    });
  } catch {}

  localTickets.forEach(tk => {
    if (!tk.url && tk.ticketNumber && byNum[tk.ticketNumber]) {
      tk.url = byNum[tk.ticketNumber];
    }
  });
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
  const container =
    document.getElementById('reservas-list') ||
    document.querySelector('#reservas .list') ||
    document.getElementById('trips-list') ||
    document.querySelector('#reservas') ||
    document.querySelector('.reservas');

  if (!container) return;

  // 1) Carrega compras locais (apenas pagos)
  const all = JSON.parse(localStorage.getItem('bookings') || '[]');
  const paid = all.filter(b => b.paid === true);

  // 2) Explode cada compra em tickets individuais
  const localTickets = [];
  for (const bk of paid) {
    const s = bk.schedule || {};
    const paxArr = Array.isArray(bk.passengers) ? bk.passengers : [];
    const tArr  = Array.isArray(bk.tickets) ? bk.tickets : [{ /* vazio */ }];

    for (const t of tArr) {
      const seat = seatFromTicket(t) ||
                   (paxArr.find(p => (p?.seatNumber ?? p?.poltrona) != null)?.seatNumber ?? null);
      const pax  = paxArr.find(p => Number(p.seatNumber ?? p.poltrona) === seat) || paxArr[0] || {};

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
        idaVolta: bk.tripType || bk.idaVolta || null,
        price: Number.isFinite(unit) ? +unit.toFixed(2) : 0,
        _paidAt: bk.paidAt || bk.dataVenda || bk.vendaAt || bk.createdAt || null,
      });
    }
  }



  // 3) Buscar no Google Sheets por e-mail logado e mesclar
try {
  const email = (user?.email || '').trim();
  if (email) {
    const r = await fetch(`/api/sheets/bpe-by-email?email=${encodeURIComponent(email)}`);
    const j = await r.json();

    if (j.ok && Array.isArray(j.items)) {
      for (const s of j.items) {
        // hora preferencialmente da coluna Data_Hora; se não vier, usa departureTime
        const horaFromDateTime = (s.dateTime && s.dateTime.includes(' '))
          ? s.dateTime.split(' ')[1]
          : '';

        // status “Pago” quando statusPagamento = approved ou status = Emitido
        const st = (String(s.statusPagamento || '').toLowerCase() === 'approved' ||
                    String(s.status || '').toLowerCase() === 'emitido')
                    ? 'Pago' : (s.status || '—');

        localTickets.push({
          origem:      s.origin || s.origem || '',
          destino:     s.destination || s.destino || '',
          data:        s.date || s.data || '',
          hora:        horaFromDateTime || s.departureTime || s.hora || '',
          seat:        s.seatNumber || s.poltrona || '',     // não existe no Sheets; fica vazio
          passageiro:  s.name || s.nome || '',                         // se um dia você retornar “Nome”
          status:      st,
          ticketNumber:s.ticketNumber || s.numpassagem || '',
          url:         s.driveUrl || s.url || '',
          idaVolta:    (s.sentido || '').toLowerCase() || null, // “ida”/“volta”
          price:       Number(s.price || 0),
          _paidAt:     s.paidAt || null,                     // usado para ordenar quando existir
          // extras que você pode exibir depois se quiser:
          serie:       s.serie || '',
          paymentType: s.paymentType || '',
          referencia:  s.referencia || '',
          poltrona:  s.poltrona || '',
        });
      }
    }
  }
} catch (e) {
  console.warn('[profile] Falha ao buscar/mesclar do Sheets:', e);
}






  
  // 3.5) Preenche links de bilhete usando dados salvos no localStorage
  hydrateUrlsByTicketNumber(localTickets);


// 4) Heurística para marcar ida/volta quando vier nulo (data pode ser diferente)
localTickets.forEach((tk) => {
  if (tk.idaVolta) return;

  // procura par com origem/destino invertidos
  const pair = localTickets
    .filter(o =>
      o !== tk &&
      samePlace(o.origem, tk.destino) &&
      samePlace(o.destino, tk.origem)
    )
    .sort((a, b) => (Date.parse(a.data || '') || 0) - (Date.parse(b.data || '') || 0))[0];

  if (!pair) { tk.idaVolta = 'ida'; return; }

  const tTk   = Date.parse(tk.data || '')   || 0;
  const tPair = Date.parse(pair.data || '') || 0;

  // a viagem que ocorre depois é "Volta", a anterior é "Ida"
  tk.idaVolta = tTk > tPair ? 'volta' : 'ida';
});






  

// 5) Ordenação: mais recente primeiro
function parseTs(v) {
  if (!v) return NaN;
  const t = Date.parse(v);
  return Number.isNaN(t) ? NaN : t;
}
function toNumTicket(tk) {
  return parseInt(String(tk.ticketNumber || '').replace(/\D/g, ''), 10) || 0;
}

// regra:
// 1) usa _paidAt (quando veio do localStorage, temos isso)
// 2) se empatar/ausente, tenta ordenar por data/hora da viagem
// 3) por fim, usa número do bilhete desc
localTickets.sort((a, b) => {
  const ta = parseTs(a._paidAt);
  const tb = parseTs(b._paidAt);
  if (!Number.isNaN(ta) || !Number.isNaN(tb)) return (tb || 0) - (ta || 0);

  const ka = `${String(a.data||'').replaceAll('/', '-') } ${a.hora||''}`;
  const kb = `${String(b.data||'').replaceAll('/', '-') } ${b.hora||''}`;
  if (ka !== kb) return kb.localeCompare(ka);

  return toNumTicket(b) - toNumTicket(a);
});


// ===== Utilitários já existentes =====
// let previewId = null;  // garanta que isso continue declarado no topo
const fmtBRL = (n) => (Number(n)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

// 6) Monta HTML de cada TICKET (um card por bilhete) + preview de cancelamento
const lines = localTickets.map(tk => {
  const dataBR = (typeof formatDateBR === 'function') ? formatDateBR(tk.data) : tk.data;
  const way = tk.idaVolta === 'volta' ? 'Volta' : 'Ida';
  const idCard = String(tk.ticketNumber || `${tk.origem}-${tk.destino}-${tk.data}-${tk.hora}-${tk.seat}`);
  const showPreview = (previewId === idCard);

  const valor = Number(tk.price || 0);
  const multa = +(valor * 0.05).toFixed(2);
  const reembolso = +(valor - multa).toFixed(2);

  // regra de poder cancelar (12h antes) — usa seus helpers já presentes
  const podeCancelar = mayCancel({ date: tk.data, dataViagem: tk.data, departureTime: tk.hora, horaPartida: tk.hora });

  // botão Ver Bilhete (só se tiver url)
  const btnBilhete = tk.url
    ? `<button class="btn btn-success" onclick="window.open('${tk.url}','_blank')">Ver Bilhete</button>`
    : `<button class="btn btn-secondary" disabled>Ver Bilhete</button>`;

  return `
    <div class="reserva" data-id="${idCard}">
      <div><b>${tk.origem}</b> → <b>${tk.destino}</b> <span class="badge">${way}</span></div>
      <div>Data: <b>${dataBR}</b> &nbsp; Saída: <b>${tk.hora || '—'}</b> &nbsp; Total: <b>${fmtBRL(valor)}</b></div>
      <div>Poltronas: ${tk.seat || '—'} &nbsp;&nbsp; Passageiros: ${tk.passageiro || '—'} &nbsp;&nbsp; <b>Status:</b> ${tk.status}</div>
      <div>Bilhete nº: <b>${tk.ticketNumber || '—'}</b></div>

      ${showPreview ? `
        <div class="calc-box">
          <div class="calc-cols">
            <div class="calc-left">
              <div class="calc-row"><span>Origem:</span><b>${tk.origem}</b></div>
              <div class="calc-row"><span>Destino:</span><b>${tk.destino}</b></div>
              <div class="calc-row"><span>Data:</span><b>${dataBR}</b></div>
              <div class="calc-row"><span>Saída:</span><b>${tk.hora || '—'}</b></div>
            </div>
            <div class="calc-right">
              <div class="calc-row"><span>Valor pago:</span><b>${fmtBRL(valor)}</b></div>
              <div class="calc-row"><span>Multa (5%):</span><b>${fmtBRL(multa)}</b></div>
              <div class="calc-row total"><span>Valor a reembolsar:</span><b>${fmtBRL(reembolso)}</b></div>
            </div>
          </div>
          <div class="actions" style="margin-top:10px">
            <button class="btn btn-primary" data-act="do-cancel" data-id="${idCard}">Realizar cancelamento</button>
            <button class="btn btn-ghost" data-act="close-preview">Voltar</button>
          </div>
        </div>
      ` : ''}

      <div class="actions">
        ${!showPreview ? btnBilhete : ''}
        ${!showPreview ? `
          <button class="btn ${podeCancelar ? 'btn-danger' : 'btn-disabled'} btn-cancel"
                  data-id="${idCard}" ${podeCancelar ? '' : 'disabled title="Só é permitido até 12h antes da partida"'}>
            Cancelar
          </button>` : ''}
      </div>
    </div>
  `;
});

container.innerHTML = lines.join('') || '<p class="mute">Nenhuma reserva encontrada.</p>';

// 7) Handlers do preview e cancelamento
container.querySelectorAll('.btn-cancel').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    previewId = btn.getAttribute('data-id');
    renderReservations();
  });
});
container.querySelectorAll('[data-act="close-preview"]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    previewId = null;
    renderReservations();
  });
});
container.querySelectorAll('[data-act="do-cancel"]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const id = btn.getAttribute('data-id');
    if (!confirm('Confirmar cancelamento desta viagem?')) return;
    // marque localmente como cancelado se quiser (você já tem flagCancelled(id); caso deseje reusar):
    if (typeof flagCancelled === 'function') flagCancelled(id);
    previewId = null;
    renderReservations();
    alert('Cancelamento solicitado com sucesso. O reembolso será processado conforme as regras.');
  });
});
}

  // inicializa a tela
(async () => {
   try {
     await renderReservations();
   } catch (e) {
     console.error('[profile] renderReservations falhou:', e);
   }
 })();
});
