// payment.js — Resumo + Bricks + PIX (QR + copia-e-cola + polling)
document.addEventListener('DOMContentLoaded', async () => {
  // ——— login obrigatório
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) {
    localStorage.setItem('postLoginRedirect', 'payment.html');
    location.href = 'login.html';
    return;
  }
  if (typeof updateUserNav === 'function') updateUserNav();

  // ——— DOM
  const summaryBodyEl  = document.getElementById('summary-body');
  const summaryTotalEl = document.getElementById('summary-total');
  const legacySummaryEl = document.getElementById('order-summary');
  const cancelBtn = document.getElementById('btn-cancel') || document.getElementById('cancel-order');

  // PIX UI
  const pixBox   = document.getElementById('pix-box');
  const pixQR    = document.getElementById('pix-qr');
  const pixCode  = document.getElementById('pix-code');
  const pixCopy  = document.getElementById('pix-copy');
  const pixStatus= document.getElementById('pix-status');

  // ——— utils
  const fmtBRL = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '') ?? '';
  const formatDateBR = (iso) => {
    if (typeof iso !== 'string' || !iso.includes('-')) return iso || '';
    const [y, m, d] = iso.split('-');
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  };

    // normaliza "DD/MM/YYYY" -> "YYYY-MM-DD" (ou mantém se já vier ISO)
  function toYMD(dateStr) {
    if (!dateStr) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    const m = String(dateStr).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    const t = Date.parse(dateStr);
    if (!Number.isNaN(t)) {
      const z = new Date(t);
      const yyyy = z.getFullYear();
      const mm = String(z.getMonth()+1).padStart(2,'0');
      const dd = String(z.getDate()).padStart(2,'0');
      return `${yyyy}-${mm}-${dd}`;
    }
    return '';
  }


  // ====== PIX polling
  const POLL_MS = 5000;                   // 5s entre consultas
  const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 min máximo
  let pixPollTimer = null;

  async function fetchPaymentStatus(paymentId) {
    // tenta /payment-status?id=... e /payment/:id (use o que seu backend expõe)
    let r = await fetch(`/api/mp/payment-status?id=${paymentId}`).catch(()=>null);
    if (!r || !r.ok) r = await fetch(`/api/mp/payment/${paymentId}`).catch(()=>null);
    if (!r || !r.ok) throw new Error('Falha ao consultar status do pagamento');
    return r.json();
  }
  function setPixStatus(msg) {
    if (pixStatus) pixStatus.textContent = msg;
  }

  // ===== Overlay (mostra uma vez durante a emissão)
  let overlayShown = false;
  function showOverlayOnce(
    title = 'Pagamento confirmado!',
    subtitle = 'Emitindo bilhete, por favor aguarde!'
  ) {
    if (overlayShown) return;
    overlayShown = true;

    if (typeof showIssuanceOverlay === 'function') {
      showIssuanceOverlay(title);
      const subEl = document.querySelector('#issuance-overlay .io-sub');
      if (subEl) subEl.textContent = subtitle;
    }
  }
  function hideOverlayIfShown() {
    if (!overlayShown) return;
    overlayShown = false;
    if (typeof hideIssuanceOverlay === 'function') hideIssuanceOverlay();
  }

  // === helper: salva links do bilhete no booking/localStorage ===
  function mergeDriveLinksIntoBookings(arquivos) {
    if (!Array.isArray(arquivos) || !arquivos.length) return;
    const all = JSON.parse(localStorage.getItem('bookings') || '[]');
    if (!all.length) return;
    const last = all[all.length - 1];

    last.paid = true;
    last.paidAt = new Date().toISOString();
    last.tickets = arquivos.map(a => ({
      numPassagem: a.numPassagem || a.NumPassagem || null,
      driveUrl: a.driveUrl || null,
      pdfLocal: a.pdfLocal || null,
      url: a.driveUrl || a.pdfLocal || null
    }));

    const first = last.tickets[0] || {};
    last.ticketUrl = first.url || null;
    last.driveUrl  = first.driveUrl || null;
    last.pdfLocal  = first.pdfLocal || null;
    last.ticketNumber = first.numPassagem || null;

    localStorage.setItem('bookings', JSON.stringify(all));
    localStorage.setItem('lastTickets', JSON.stringify(
      arquivos.map(a => ({
        numPassagem: a.numPassagem || a.NumPassagem || null,
        driveUrl: a.driveUrl || null,
        pdfLocal: a.pdfLocal || null
      }))
    ));
  }

  // ——— carrinho
  function readCart() {
    const b = JSON.parse(localStorage.getItem('bookings') || '[]');
    const open = b.filter(x => x.paid !== true);
    if (open.length) return open;
    const p = JSON.parse(localStorage.getItem('pendingPurchase') || 'null');
    return p && Array.isArray(p.legs) ? p.legs : [];
  }

// explode um booking em N itens (um por poltrona) e guarda ponteiros do item original
function expandCartItems(raw) {
  const out = [];
  (raw || []).forEach((it, openIdx) => {
    const seats = Array.isArray(it.seats) ? it.seats : [];
    const pax   = Array.isArray(it.passengers) ? it.passengers : [];
    // se já está unitário, só garante ponteiros
    if (seats.length <= 1) {
      out.push({ ...it, _srcOpenIdx: openIdx, _seat: seats[0] ?? null });
      return;
    }
    seats.forEach(seat => {
      const p = pax.find(x => Number(x.seatNumber || x.poltrona) === Number(seat));
      out.push({
        ...it,
        seats: [seat],
        passengers: p ? [{ ...p, seatNumber: seat }] : [],
        _srcOpenIdx: openIdx,
        _seat: seat
      });
    });
  });
  return out;
}


// let order = readCart();
let order = expandCartItems(readCart());


  // tenta inferir ida/volta a partir dos dois primeiros trechos
  function inferTripTypeForOrder(order) {
    if (!Array.isArray(order) || order.length === 0) return 'ida';

    // respeito a marcação explícita, se já existir
    if (order.some(it => it.isReturn === true || it.tripType === 'volta')) return 'volta';

    if (order.length >= 2) {
      const getIds = (it) => {
        const s = it?.schedule || {};
        return {
          o: s.originId || s.idOrigem || s.CodigoOrigem || s.origemId || s.origem,
          d: s.destinationId || s.idDestino || s.CodigoDestino || s.destinoId || s.destino,
          date: s.date || s.dataViagem,
        };
      };
      const a = getIds(order[0]);
      const b = getIds(order[1]);
      const swapped = a.o && a.d && b.o && b.d && (a.o === b.d && a.d === b.o);
      const sameDate = a.date && b.date ? String(a.date) === String(b.date) : true;
      if (swapped && sameDate) return 'volta';
    }
    return 'ida';
  }





  

  // ===== valores
  const itemSubtotal = (it) => {
    const s = it.schedule || {};
    const unit = Number(String(s.price || 0).replace(',', '.')) || 0;
    return unit * ((it.seats || []).length || 0);
  };
  const cartTotal = () => order.reduce((acc, it) => acc + itemSubtotal(it), 0);

  // ===== helpers Praxio
  function getScheduleFromItem(it) {
    const s = it.schedule || {};
    return {
      idViagem: s.idViagem || s.IdViagem || s.id || s.Id || s.viagemId,
      horaPartida: s.horaPartida || s.departureTime,
      idOrigem: s.idOrigem || s.IdOrigem || s.originId || s.CodigoOrigem,
      idDestino: s.idDestino || s.IdDestino || s.destinationId || s.CodigoDestino,
      agencia: s.agencia || s.IdEstabelecimento || s.IdEstabelecimentoVenda || '93',
      date: toYMD(s.date || s.dataViagem || s.DataViagem || s.data || '')
    };
  }
  function getPassengersFromItem(it) {
    const pax = [];
    const seats = Array.isArray(it.seats) ? it.seats : [];
    const passengers = Array.isArray(it.passengers) ? it.passengers : [];
    if (passengers.length) {
      for (const p of passengers) {
        pax.push({
          seatNumber: p.seatNumber || p.poltrona || seats[0],
          name: p.name || p.nome || '',
          document: (p.document || p.cpf || '').toString()
        });
      }
    } else {
      for (const seat of seats) {
        pax.push({ seatNumber: seat, name: (user.name || user.email || ''), document: '' });
      }
    }
    return pax;
  }


  // helper: tenta inferir ida/volta do item
function inferLegType(it, idx, order) {
  if (it.isReturn === true || it.tripType === 'volta') return 'volta';
  if (it.tripType === 'ida') return 'ida';

  // fallback: se houver 2 trechos invertidos, o 2º é volta
  if (order.length >= 2 && idx === 1) {
    const getIds = (x) => {
      const s = x?.schedule || {};
      return {
        o: s.originId || s.idOrigem || s.CodigoOrigem,
        d: s.destinationId || s.idDestino || s.CodigoDestino
      };
    };
    const a = getIds(order[0]);
    const b = getIds(order[1]);
    if (a.o && a.d && b.o && b.d && a.o === b.d && a.d === b.o) return 'volta';
  }
  return 'ida';
}

// atualiza UM booking (por índice) com os arquivos gerados
function mergeFilesIntoBookingAtIndex(openIdx, arquivos) {
  if (!Array.isArray(arquivos) || !arquivos.length) return;
  const all = JSON.parse(localStorage.getItem('bookings') || '[]');
  const paid = all.filter(b => b.paid === true);
  const open = all.filter(b => b.paid !== true);

  if (openIdx < 0 || openIdx >= open.length) return;

  const bk = open[openIdx];
  bk.paid = true;
  bk.paidAt = new Date().toISOString();
  bk.tickets = arquivos.map(a => ({
    numPassagem: a.numPassagem || a.NumPassagem || null,
    driveUrl: a.driveUrl || null,
    pdfLocal: a.pdfLocal || null,
    url: a.driveUrl || a.pdfLocal || null
  }));
  const first = bk.tickets[0] || {};
  bk.ticketUrl = first.url || null;
  bk.driveUrl  = first.driveUrl || null;
  bk.pdfLocal  = first.pdfLocal || null;
  bk.ticketNumber = first.numPassagem || null;

  // regrava mantendo a ordem original: [paid..., open...]
  localStorage.setItem('bookings', JSON.stringify([...paid, ...open]));
}

// === emite UMA venda por item ===
async function venderPraxioApósAprovado(paymentId) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const results = [];


  

  // === TOTAL de bilhetes desta compra (soma de todos os passageiros de todos os trechos)
const totalDeBilhetesDaCompra = (order || []).reduce((acc, it) => {
  const pax = getPassengersFromItem(it) || [];
  return acc + pax.length;
}, 0);




  
  for (let i = 0; i < order.length; i++) {
    const it = order[i];
    const schedule   = getScheduleFromItem(it);
    const passengers = getPassengersFromItem(it);
    const totalAmount = itemSubtotal(it);                 // valor só daquele trecho
    const idaVolta   = inferLegType(it, i, order);        // 'ida' | 'volta'
    const userEmail  = (user.email || '').toString();
    const userPhone  = (user.phone || user.telefone || '').toString();

    const r = await fetch('/api/praxio/vender', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        mpPaymentId: paymentId,
        schedule,
        passengers,
        totalAmount,
        idEstabelecimentoVenda: '1',
        idEstabelecimentoTicket: schedule.agencia || '93',
        serieBloco: '93',
        userEmail,
        userPhone,
        idaVolta,
        expectedTotalTickets: totalDeBilhetesDaCompra // exemplo: 7 (4 ida + 3 volta)
      })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Falha ao emitir bilhete (item)');

    const arquivos = j.arquivos || j.Arquivos || [];
    mergeFilesIntoBookingAtIndex(i, arquivos);            // marca ESTE item como pago
    results.push(j);
  }

  // monta um agregado para o restante do fluxo
  const arquivosAll = results.flatMap(x => x.arquivos || x.Arquivos || []);
  const vendasAll   = results.map(x => x.venda || x.Venda);
  localStorage.setItem('lastTickets', JSON.stringify(
    arquivosAll.map(a => ({
      numPassagem: a.numPassagem || a.NumPassagem || null,
      driveUrl: a.driveUrl || null,
      pdfLocal: a.pdfLocal || null
    }))
  ));

  return { ok: true, vendas: vendasAll, arquivos: arquivosAll };
}



  // ===== storage remove
// remove uma poltrona específica do booking "aberto" original
function removeFromStorageBySeatPointer(srcOpenIdx, seatNumber) {
  const all  = JSON.parse(localStorage.getItem('bookings') || '[]');
  const paid = all.filter(b => b.paid === true);
  const open = all.filter(b => b.paid !== true);

  // nada a fazer
  if (srcOpenIdx < 0 || srcOpenIdx >= open.length) {
    localStorage.setItem('bookings', JSON.stringify([...paid, ...open]));
    return;
  }

  const it = open[srcOpenIdx];

  // tira do array seats
  if (Array.isArray(it.seats)) {
    it.seats = it.seats.filter(n => Number(n) !== Number(seatNumber));
  }
  // tira do array passengers
  if (Array.isArray(it.passengers)) {
    it.passengers = it.passengers.filter(p =>
      Number(p.seatNumber || p.poltrona) !== Number(seatNumber)
    );
  }

  // se esvaziou, remove o booking aberto por completo
  if (!it.seats?.length) {
    open.splice(srcOpenIdx, 1);
  }

  localStorage.setItem('bookings', JSON.stringify([...paid, ...open]));
}


  // ===== resumo
  function renderSummary() {
    const lines = [];
    let total = 0;

    order.forEach((it, idx) => {
      const s = it.schedule || {};
      const origem = pick(s.originName, s.origin, s.origem, '—');
      const destino = pick(s.destinationName, s.destination, s.destino, '—');
      const dataV = formatDateBR(s.date);
      const hora = pick(s.departureTime, s.horaPartida, '—');
      const seats = (it.seats || []).join(', ');
      const paxList = Array.isArray(it.passengers) ? it.passengers.map(p => `Pol ${p.seatNumber}: ${p.name}`) : [];
      const sub = itemSubtotal(it);
      total += sub;

      lines.push(`
        <div class="order-item" data-open-index="${idx}">
          <button class="item-remove" title="Remover" aria-label="Remover">×</button>
          <div class="title">
            <span>${origem} → ${destino}</span>
            <span class="price">${fmtBRL(sub)}</span>
          </div>
          <div class="meta">
            ${dataV} • ${hora} • Poltronas: ${seats || '—'}
            ${paxList.length ? `<br/>Passageiros: ${paxList.join(', ')}` : ''}
          </div>
        </div>
      `);
    });

    const html = lines.join('') + `<div class="summary-total"><span>Total</span><span>${fmtBRL(total)}</span></div>`;
    if (summaryBodyEl) {
      summaryBodyEl.innerHTML = html;
      if (summaryTotalEl) summaryTotalEl.textContent = fmtBRL(total);
    } else if (legacySummaryEl) {
      legacySummaryEl.innerHTML = html;
    }

    const container = summaryBodyEl || legacySummaryEl;
    if (container) {
container.querySelectorAll('.order-item .item-remove').forEach(btn => {
  btn.addEventListener('click', async () => {
    const wrap = btn.closest('.order-item');
    const openIdx = Number(wrap.getAttribute('data-open-index'));

    // pega os ponteiros do item expandido
    const item = order[openIdx];
    const srcIdx = Number(item?._srcOpenIdx ?? -1);
    const seat   = item?._seat;

    // remove no storage (apenas aquela poltrona do booking original)
    removeFromStorageBySeatPointer(srcIdx, seat);

    // remove do array expandido atual e re-renderiza
    order.splice(openIdx, 1);
    const newTotal = cartTotal();
    renderSummary();
    await awaitMountBricks(newTotal);
  });
});

    }
    return total;
  }

  // ======= Bricks
  let publicKey = '';
  try {
    const r = await fetch('/api/mp/pubkey');
    const j = await r.json();
    publicKey = j.publicKey || '';
  } catch (e) { console.error('Erro /api/mp/pubkey', e); }
  if (!publicKey) { alert('Chave pública do Mercado Pago não configurada.'); return; }

  const mp = new MercadoPago(publicKey, { locale: 'pt-BR' });
  const bricks = mp.bricks();

  const brickContainerId =
    document.getElementById('payment-bricks') ? 'payment-bricks' :
    (document.getElementById('payment-brick-container') ? 'payment-brick-container' : null);

  if (!brickContainerId) { console.error('Container do Bricks não encontrado.'); return; }

  let brickController = null;
  let currentTotal = 0;

  // ——— exibição do PIX
  function showPixBox({ qr_b64, qr_text }) {
    if (!pixBox) return;
    pixBox.style.display = 'block';
    pixQR.innerHTML = qr_b64 ? `<img src="data:image/png;base64,${qr_b64}" alt="QR Pix">` : '<p class="mute">QR não disponível.</p>';
    pixCode.value = qr_text || '';
    setPixStatus('Aguardando pagamento…');

    if (pixCopy && qr_text) {
      pixCopy.onclick = () => {
        pixCode.select();
        document.execCommand('copy');
        alert('Código Pix copiado!');
      };
    }
    pixBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function genIdem() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    // fallback simples
    const a = Array.from({length:32},()=>Math.floor(Math.random()*16).toString(16)).join('');
    return `${a.slice(0,8)}-${a.slice(8,12)}-${a.slice(12,16)}-${a.slice(16,20)}-${a.slice(20)}`;
  }

  async function mountBricks(amount) {
    try { await brickController?.unmount?.(); } catch(_) {}
    currentTotal = Number((amount || 0).toFixed(2));
    if (currentTotal <= 0) currentTotal = 1.00; // evita rejeição em sandbox

    brickController = await bricks.create('payment', brickContainerId, {
      initialization: { amount: currentTotal, payer: { email: user.email || '' } },
      customization: {
        paymentMethods: {
          creditCard: 'all',
          debitCard: 'all',
          bankTransfer: ['pix'],
          minInstallments: 1, maxInstallments: 1
        },
        visual: { showInstallmentsSelector: false }
      },
      callbacks: {
        onReady: () => console.log('[MP] Brick pronto'),
        onError: (e) => { console.error('[MP] Brick error:', e); alert('Erro ao iniciar o pagamento.'); },
        onSubmit: async ({ selectedPaymentMethod, formData }) => {
          try {
            const method = String(selectedPaymentMethod || '').toLowerCase();
            const isPix = method === 'bank_transfer' ||
                          String(formData?.payment_method_id || '').toLowerCase() === 'pix';

            const idem = genIdem();

            const body = {
              transaction_amount: Number(currentTotal.toFixed(2)),
              description: 'Compra Turin Transportes',
              external_reference: idem,
              payer: {
                email: user.email || '',
                identification: formData?.payer?.identification ? {
                  type: formData.payer.identification.type || 'CPF',
                  number: String(formData.payer.identification.number || '').replace(/\D/g, '')
                } : undefined,
                entity_type: (formData?.payer?.identification?.type || 'CPF').toUpperCase() === 'CNPJ'
                  ? 'association' : 'individual'
              }
            };

            if (isPix) {
              body.payment_method_id = 'pix';
            } else {
              if (!formData?.token) { alert('Não foi possível tokenizar o cartão.'); return; }
              body.token = formData.token;
              body.payment_method_id = formData.payment_method_id;
              body.installments = 1;
              if (formData.issuer_id) body.issuer_id = formData.issuer_id;
            }

            Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
            if (body.payer && body.payer.identification === undefined) delete body.payer.identification;

            const resp = await fetch('/api/mp/pay', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idem },
              body: JSON.stringify(body)
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data?.message || 'Falha ao processar pagamento');

            // === CARTÃO APROVADO ===
            if (data.status === 'approved') {
              showOverlayOnce('Pagamento confirmado!', 'Gerando o BPe…');

              try {
                const venda = await venderPraxioApósAprovado(data.id || data?.payment?.id);
                const arquivos = venda?.arquivos || venda?.Arquivos || [];
                if (arquivos.length) {
                  mergeDriveLinksIntoBookings(arquivos);
                  location.href = 'profile.html';
                  return;
                }
                hideOverlayIfShown();
                alert('Pagamento aprovado, mas não foi possível gerar o bilhete. Suporte notificado.');
              } catch (e) {
                console.error('Falha na emissão pós-aprovação (cartão):', e);
                hideOverlayIfShown();
                alert('Pagamento aprovado, mas houve um problema ao emitir o bilhete. Tente novamente ou fale com o suporte.');
              }
              return;
            }

            // === PIX (gera QR; aprovação é posterior) ===
            const pix = data?.point_of_interaction?.transaction_data;
            if (pix?.qr_code || pix?.qr_code_base64) {
              showPixBox({ qr_b64: pix.qr_code_base64, qr_text: pix.qr_code });
              alert('Pix gerado! Conclua o pagamento no seu banco.');
              const paymentId = data.id || data?.payment?.id;
              if (paymentId) startPixPolling(paymentId); // <<<<<< POLLING AQUI
              return;
            }

            if (data?.id && data?.status === 'in_process') {
              alert('Pagamento em análise. Acompanhe em Minhas viagens.');
              return;
            }

            alert(`Pagamento: ${data.status} - ${data.status_detail || ''}`);
          } catch (err) {
            console.error('Pagamento falhou:', err);
            alert('Pagamento falhou: ' + (err?.message || 'erro'));
          }
        }
      }
    });
  }

  // === Polling do PIX (aprovado -> emitir e salvar links)
  async function startPixPolling(paymentId) {
    clearInterval(pixPollTimer);
    const t0 = Date.now();
    setPixStatus('Aguardando pagamento…');

    pixPollTimer = setInterval(async () => {
      try {
        const data = await fetchPaymentStatus(paymentId);
        const st = String(data?.status || '').toLowerCase();
        const detail = String(data?.status_detail || '').toLowerCase();

        if (st === 'approved') {
          clearInterval(pixPollTimer);
          showOverlayOnce('Pagamento confirmado!', 'Gerando o BPe…');

          try {
            const venda = await venderPraxioApósAprovado(paymentId);
            const arquivos = venda?.arquivos || venda?.Arquivos || [];
            if (arquivos.length) {
              mergeDriveLinksIntoBookings(arquivos);
              location.href = 'profile.html';
              return;
            }
            hideOverlayIfShown();
            alert('Pagamento aprovado, mas não foi possível gerar o bilhete. Suporte notificado.');
          } catch (e) {
            console.error('Erro ao emitir bilhete após aprovação:', e);
            hideOverlayIfShown();
            alert('Pagamento aprovado, mas houve erro ao emitir o bilhete. Suporte notificado.');
          }
        } else if (st === 'rejected' || st === 'cancelled' || st === 'refunded' || detail.includes('expired')) {
          clearInterval(pixPollTimer);
          setPixStatus('Pagamento não confirmado (expirado/cancelado). Gere um novo Pix.');
        } else {
          setPixStatus('Aguardando pagamento…');
        }

        if (Date.now() - t0 > POLL_TIMEOUT_MS) {
          clearInterval(pixPollTimer);
          setPixStatus('Tempo esgotado. Gere um novo Pix se necessário.');
        }
      } catch (e) {
        console.warn('Falha no polling Pix:', e);
        // continua tentando até timeout
      }
    }, POLL_MS);
  }

  async function awaitMountBricks(total) {
    if (!order.length) {
      try { await brickController?.unmount?.(); } catch(_) {}
      const container = document.getElementById(brickContainerId);
      if (container) container.innerHTML = '<p class="mute">Seu carrinho está vazio.</p>';
      return;
    }
    await mountBricks(total);
  }

  // ===== inicialização
  const firstTotal = renderSummary();
  await awaitMountBricks(firstTotal);

  // ===== Botões

cancelBtn?.addEventListener('click', () => {
  const ok = confirm('Cancelar este pedido? Os itens do carrinho serão removidos.');
  if (!ok) return;
  const all = JSON.parse(localStorage.getItem('bookings') || '[]');
  const paid = all.filter(b => b.paid === true);
  localStorage.setItem('bookings', JSON.stringify(paid));
  // volta para a tela anterior (ou para a busca, se não houver histórico)
  history.length > 1 ? history.back() : (location.href = 'index.html');
});

});

