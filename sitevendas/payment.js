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

  // ====== PIX polling
  const POLL_MS = 5000;                 // 5s entre consultas
  const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 min máximo
  let pixPollTimer = null;

  async function fetchPaymentStatus(paymentId) {
    const r = await fetch(`/api/mp/payments/${paymentId}`);
    if (!r.ok) throw new Error('Falha ao consultar status do pagamento');
    return r.json();
  }
  function setPixStatus(msg) {
    if (pixStatus) pixStatus.textContent = msg;
  }


 // Overlay: mostra só uma vez e esconde em caso de erro
/*let overlayShown = false;
function showOverlayOnce(msg = 'Pagamento confirmado!\nEmitindo bilhete, por favor aguarde!') {
  if (overlayShown) return;
  overlayShown = true;
  if (typeof showIssuanceOverlay === 'function') showIssuanceOverlay(msg);
}*/


// Overlay: mostra só uma vez e esconde em caso de erro
let overlayShown = false;

function showOverlayOnce(
  title = 'Pagamento confirmado!',
  subtitle = 'Emitindo bilhete, por favor aguarde!'
) {
  if (overlayShown) return;
  overlayShown = true;

  if (typeof showIssuanceOverlay === 'function') {
    // mostra o overlay já com o título
    showIssuanceOverlay(title);
    // preenche o subtítulo, se existir no DOM
    const subEl = document.querySelector('#issuance-overlay .io-sub');
    if (subEl) subEl.textContent = subtitle;
  }
}

function hideOverlayIfShown() {
  if (!overlayShown) return;
  overlayShown = false;
  if (typeof hideIssuanceOverlay === 'function') hideIssuanceOverlay();
}

  // ====== storage / carrinho
  function getOpenOrders() {
    try {
      return JSON.parse(localStorage.getItem('openOrders') || '[]') || [];
    } catch { return []; }
  }
  function getPaidOrders() {
    try {
      return JSON.parse(localStorage.getItem('bookings') || '[]')?.filter(b => b.paid) || [];
    } catch { return []; }
  }
  function setPaidOrders(list) {
    localStorage.setItem('bookings', JSON.stringify(list || []));
  }
  function removeFromStorageByOpenIndex(openIdx) {
    const all = JSON.parse(localStorage.getItem('bookings') || '[]') || [];
    const paid = all.filter(b => b.paid === true);
    const open = (all.filter(b => !b.paid) || []).filter((_,i) => i !== openIdx);
    localStorage.setItem('bookings', JSON.stringify([...paid, ...open]));
  }

  // ===== dados base
  let order = getOpenOrders();
  const firstTotal = (order || []).reduce((acc, it) => acc + Number(it.total || 0), 0);

  // ===== helpers do pedido
  function cartTotal() {
    try { return order.reduce((acc, it) => acc + Number(it.total || 0), 0); } catch { return 0; }
  }
  function getScheduleFromItem(it) {
    const s = it && it.schedule;
    if (!s) return null;
    return {
      idViagem: s.idViagem || s.IdViagem || '',
      horaPartida: s.horaPartida || s.HoraPartida || '',
      origem: s.origem || s.Origem || '',
      destino: s.destino || s.Destino || '',
      data: s.data || s.Data || '',
      agencia: s.agencia || s.Agencia || '93',
      codigoLinha: s.codigoLinha || s.CodigoLinha || '',
      nomeLinha: s.nomeLinha || s.NomeLinha || ''
    };
  }
  function getPassengersFromItem(it) {
    const pax = [];
    const seats = it?.seats || [];
    if (Array.isArray(it?.passengers) && it.passengers.length) {
      for (const p of it.passengers) {
        pax.push({
          seatNumber: p.seatNumber || p.poltrona || '',
          name: (p.name || p.nome || '').toString(),
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
  async function venderPraxioApósAprovado(paymentId) {
    const first = order[0];
    const schedule = getScheduleFromItem(first);
    let passengers = [];
    order.forEach(it => { passengers = passengers.concat(getPassengersFromItem(it)); });
    const totalAmount = cartTotal();

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
        serieBloco: '93'
      })
    });
    if (!r.ok) throw new Error('Falha na emissão do bilhete');
    return r.json();
  }

  // ===== resumo
  function renderSummary() {
    const total = cartTotal();
    const lines = [];

    order.forEach((it, idx) => {
      const s = it.schedule || {};
      const origem  = pick(s.origem, it.origem, '—');
      const destino = pick(s.destino, it.destino, '—');
      const dataV   = formatDateBR(pick(s.data, it.data, ''));
      const hora    = pick(s.horaPartida, it.hora, it.saida, '—');
      const seats   = (it.seats || []).join(', ');
      const paxList = (it.passengers || []).map(p => (p.name || p.nome)).filter(Boolean);

      const sub = Number(it.total || 0);
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
          order.splice(openIdx, 1);
          removeFromStorageByOpenIndex(openIdx);
          renderSummary();
          awaitMountBricks(cartTotal());
        });
      });
    }
  }

  // ===== PIX box
  function showPixBox({ qr_b64, qr_text }) {
    if (!pixBox) return;
    pixBox.style.display = 'block';
    if (pixQR) {
      pixQR.innerHTML = '';
      if (qr_b64) {
        const img = document.createElement('img');
        img.src = `data:image/png;base64,${qr_b64}`;
        img.alt = 'QR Code PIX';
        img.width = 220;
        pixQR.appendChild(img);
      }
    }
    if (pixCode) {
      pixCode.value = qr_text || '';
      if (pixCopy) {
        pixCopy.onclick = () => {
          pixCode.select();
          document.execCommand('copy');
          alert('Código Pix copiado!');
        };
      }
    }
    pixBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function mountBricks(amount) {
    try { await brickController?.unmount?.(); } catch(_) {}
    currentTotal = Number((amount || 0).toFixed(2));

    brickController = await bricks.create('payment', brickContainerId, {
      initialization: { amount: currentTotal, payer: { email: user.email || '', entityType: 'individual' } },
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
        onError: async (e) => {
          console.error('[MP] Brick error:', e);
          const msg = String(e?.message || '').toLowerCase();
          if (msg.includes('installments') || msg.includes('identification') || msg.includes('503')) {
            setTimeout(() => awaitMountBricks(currentTotal), 3000);
            return;
          }
          alert('Erro ao iniciar o pagamento. Tente novamente em instantes.');
        },
        onSubmit: async ({ selectedPaymentMethod, formData }) => {

          const idem = crypto.getRandomValues(new Uint32Array(4)).join('-');
          const isPix = (selectedPaymentMethod === 'bank_transfer' || formData.payment_method_id === 'pix');

          try {
            const body = {
              amount: currentTotal,
              description: 'Compra de passagem Turin',
              payer: {
                email: (/*user?.email*/ 'teste@teste.com' || ''),
                identification: formData?.payer?.identification
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
              method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idem },
              body: JSON.stringify(body)
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data?.message || 'Falha ao processar pagamento');

            // === CARTÃO APROVADO ===
            if (data.status === 'approved') {
              showOverlayOnce('Pagamento confirmado!', 'Emitindo bilhete, por favor aguarde!');

              try {
                const venda = await venderPraxioApósAprovado(data.id || data?.payment?.id);
                if (venda && Array.isArray(venda.arquivos) && venda.arquivos.length) {
                  const bookings = (JSON.parse(localStorage.getItem('bookings') || '[]') || [])
                    .map(b => ({ ...b, paid: true }));
                  localStorage.setItem('bookings', JSON.stringify(bookings));
                  localStorage.setItem('lastTickets', JSON.stringify(venda.arquivos));
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
              return;
            }

            // === PIX GERADO ===
            const pix = data?.point_of_interaction?.transaction_data || data;
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

  async function awaitMountBricks(total) {
    if (!order.length) {
      try { await brickController?.unmount?.(); } catch(_) {}
      const container = document.getElementById(brickContainerId);
      if (container) container.innerHTML = '<p class="mute">Seu carrinho está vazio.</p>';
      return;
    }

    // Mercado Pago SDK
    const mp = new MercadoPago(window.MP_PUBLIC_KEY, { locale: 'pt-BR' });
    window.bricks = mp.bricks();

    window.brickContainerId = 'payment-bricks';
    window.brickController = null;
    window.currentTotal = Number((total || 0).toFixed(2));

    await mountBricks(window.currentTotal);
  }

  function startPixPolling(paymentId) {
    setPixStatus('Aguardando pagamento…');
    const t0 = Date.now();
    clearInterval(pixPollTimer);
    pixPollTimer = setInterval(async () => {
      try {
        const info = await fetchPaymentStatus(paymentId);
        const st = (info?.status || '').toLowerCase();
        const detail = (info?.status_detail || '').toLowerCase();

        if (st === 'approved') {
          clearInterval(pixPollTimer);
          setPixStatus('Pagamento aprovado! Emitindo bilhete…');

          showOverlayOnce('Pagamento confirmado!', 'Emitindo bilhete, por favor aguarde!');

          try {
            const venda = await venderPraxioApósAprovado(paymentId);
            if (venda && Array.isArray(venda.arquivos) && venda.arquivos.length) {
              const bookings = (JSON.parse(localStorage.getItem('bookings') || '[]') || [])
                .map(b => ({ ...b, paid: true }));
              localStorage.setItem('bookings', JSON.stringify(bookings));
              localStorage.setItem('lastTickets', JSON.stringify(venda.arquivos));
              location.href = 'profile.html';
              return;
            }
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

  // ===== render inicial
  renderSummary();

  // ===== Mount Bricks
  await awaitMountBricks(firstTotal);

  // ===== Botões
  cancelBtn?.addEventListener('click', () => {
    const ok = confirm('Cancelar este pedido? Os itens do carrinho serão removidos.');
    if (!ok) return;
    const all = JSON.parse(localStorage.getItem('bookings') || '[]');
    const paid = all.filter(b => b.paid === true);
    localStorage.setItem('bookings', JSON.stringify(paid));
    order = [];
    renderSummary();
    awaitMountBricks(0);
  });
});
