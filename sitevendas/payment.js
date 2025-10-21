/* sitevendas/payment.js — Brick Payment com entityType + PIX/Cartão + total robusto */

document.addEventListener('DOMContentLoaded', async () => {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) {
    localStorage.setItem('postLoginRedirect', 'payment.html');
    location.href = 'login.html';
    return;
  }
  if (typeof updateUserNav === 'function') updateUserNav();

  // resumo/carrinho (mantive sua estrutura)
  const summaryBodyEl  = document.getElementById('summary-body');
  const summaryTotalEl = document.getElementById('summary-total');
  const legacySummaryEl = document.getElementById('order-summary');

  const fmtBRL = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '') ?? '';
  const formatDateBR = (iso) => (typeof iso === 'string' && iso.includes('-'))
    ? (() => { const [y,m,d]=iso.split('-'); return `${d.padStart(2,'0')}/${m.padStart(2,'0')}/${y}`; })()
    : (iso || '');

  function readCart() {
    const b = JSON.parse(localStorage.getItem('bookings') || '[]');
    const open = b.filter(x => x.paid !== true);
    if (open.length) return open;
    const p = JSON.parse(localStorage.getItem('pendingPurchase') || 'null');
    return p && Array.isArray(p.legs) ? p.legs : [];
  }
  let order = readCart();

  const itemSubtotal = (it) => {
    const s = it.schedule || {};
    const unit = Number(String(s.price || 0).replace(',', '.')) || 0;
    return unit * ((it.seats || []).length || 0);
  };
  const cartTotal = () => order.reduce((acc, it) => acc + itemSubtotal(it), 0);

  function renderSummary() {
    const lines = [];
    let total = 0;

    order.forEach((it, idx) => {
      const s = it.schedule || {};
      const origem  = pick(s.originName, s.origin, s.origem, '—');
      const destino = pick(s.destinationName, s.destination, s.destino, '—');
      const dataV   = formatDateBR(s.date);
      const hora    = pick(s.departureTime, s.horaPartida, '—');
      const seats   = (it.seats || []).join(', ');
      const paxList = Array.isArray(it.passengers) ? it.passengers.map(p => `Pol ${p.seatNumber}: ${p.name}`) : [];
      const sub = itemSubtotal(it);
      total += sub;

      lines.push(`
        <div class="order-item" data-open-index="${idx}">
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
    return total;
  }

  // ===== Bricks =====
  const pub = await fetch('/api/mp/pubkey').then(r => r.json()).catch(() => null);
  if (!pub?.publicKey) { alert('Chave pública do Mercado Pago não configurada.'); return; }
  const mp = new MercadoPago(pub.publicKey, { locale: 'pt-BR' });
  const bricks = mp.bricks();

  const brickContainerId =
    document.getElementById('payment-bricks') ? 'payment-bricks' :
    (document.getElementById('payment-brick-container') ? 'payment-brick-container' : 'paymentBrick_container');

  let brickController = null;
  let currentTotal = 0;

  async function mountBricks(amount) {
    try { await brickController?.unmount?.(); } catch(_) {}
    currentTotal = Number((amount || 0).toFixed(2));

    brickController = await bricks.create('payment', brickContainerId, {
      initialization: {
        amount: currentTotal,
        payer: { email: /*user.email*/'teste1@teste.com.br'|| '' }                          //email teste
      },
      customization: {
        paymentMethods: { creditCard: 'all', debitCard: 'all', bankTransfer: ['pix'] },
        visual: { showInstallmentsSelector: false }
      },
      callbacks: {
        onReady: () => console.log('[MP] Brick pronto'),
        onError: (e) => { console.error('[MP] Brick error:', e); alert('Erro ao iniciar o pagamento.'); },
        onSubmit
      }
    });
  }

  function normalizePayer(formData) {
    if (!formData?.payer) formData.payer = {};
    if (!formData.payer.identification) return;
    const id = formData.payer.identification;
    const t  = String(id.type || '').toUpperCase(); // CPF | CNPJ
    id.type   = t;
    id.number = String(id.number || '').replace(/\D/g, '');
    formData.payer.entityType = t === 'CPF' ? 'individual' : (t === 'CNPJ' ? 'association' : undefined);
  }

  /* sitevendas/payment.js – pontos essenciais */

async function onSubmit({ selectedPaymentMethod, formData }) {
  try {
    // Normaliza CPF/CNPJ + entityType
    if (formData?.payer?.identification) {
      const id = formData.payer.identification;
      const t  = String(id.type || '').toUpperCase(); // CPF | CNPJ
      id.type   = t;
      id.number = String(id.number || '').replace(/\D/g, '');
      formData.payer.entityType = t === 'CPF' ? 'individual' : (t === 'CNPJ' ? 'association' : undefined);
    }

    const method     = String(selectedPaymentMethod || '').toLowerCase();
    const pmFromForm = String(formData?.payment_method_id || '').toLowerCase();
    const isPix      = method === 'pix' || pmFromForm === 'pix' || method === 'bank_transfer';

    // **não** enviamos paymentMethodId para cartão (MP infere pelo token)
    const body = {
      transactionAmount: Number(currentTotal),
      description: 'Compra Turin Transportes',
      payer: {
        email: user.email || 'teste1@teste.com.br',
        identification: formData?.payer?.identification,
        entityType: formData?.payer?.entityType
      },
      ...(isPix
        ? { paymentMethodId: 'pix' }
        : { token: formData.token, installments: 1 })
    };

    // limpeza
    Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
    if (body.payer && body.payer.identification === undefined) delete body.payer.identification;

    console.log('[PAY] body =>', body);

    const resp = await fetch('/api/mp/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-idempotency-key': (crypto?.randomUUID?.() || String(Date.now()))
      },
      body: JSON.stringify(body)
    });
    const data = await resp.json();

    if (!resp.ok) throw new Error(data?.message || 'Falha ao processar pagamento');

    if (isPix && data?.pix) {
      alert('PIX gerado! Conclua no seu banco.');
      return;
    }
    if (data.status === 'approved') {
      alert('Pagamento aprovado!');
      return;
    }
    alert(`Pagamento: ${data.status} - ${data.status_detail || ''}`);
  } catch (e) {
    console.error('Pagamento falhou:', e);
    alert('Pagamento falhou: ' + (e?.message || 'erro'));
  }
}



  // inicializa
  const total = renderSummary();
  await mountBricks(total);
});
