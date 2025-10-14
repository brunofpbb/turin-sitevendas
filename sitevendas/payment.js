// payment.js — 2 cards (Resumo lateral + Bricks) e Payments API (sem preferência)
document.addEventListener('DOMContentLoaded', async () => {
  // ——— login obrigatório
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) {
    localStorage.setItem('postLoginRedirect', 'payment.html');
    location.href = 'login.html';
    return;
  }
  if (typeof updateUserNav === 'function') updateUserNav();

  // ——— util
  const fmtBRL = (n) => (Number(n)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '') ?? '';
  const formatDateBR = (iso) => {
    if (typeof iso !== 'string' || !iso.includes('-')) return iso || '';
    const [y, m, d] = iso.split('-');
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  };

  // ——— lê carrinho (bookings || pendingPurchase.legs)
  function getCart() {
    const b = JSON.parse(localStorage.getItem('bookings') || '[]');
    if (b.length) return b;
    const p = JSON.parse(localStorage.getItem('pendingPurchase') || 'null');
    return p && Array.isArray(p.legs) ? p.legs : [];
  }
  const items = getCart();
  if (!items.length) {
    const sb = document.getElementById('summary-body') || document.getElementById('order-summary');
    if (sb) sb.innerHTML = '<p class="mute">Nenhum item no pedido. Volte e selecione sua viagem.</p>';
    return;
  }

  // ——— render resumo (compatível com layout novo e antigo)
  function renderSummary(list) {
    const summaryBody = document.getElementById('summary-body');
    const legacySummary = document.getElementById('order-summary'); // compat
    let total = 0;

    const lines = [];
    list.forEach((it) => {
      const s = it.schedule || {};
      const priceUnit = Number(String(s.price).replace(',', '.')) || 0;
      const qtd = (it.seats || []).length;
      const sub = priceUnit * qtd;
      total += sub;

      const origem  = pick(s.originName, s.origin, s.origem, '—');
      const destino = pick(s.destinationName, s.destination, s.destino, '—');
      const dataV   = formatDateBR(s.date);
      const hora    = pick(s.departureTime, s.horaPartida, '—');
      const seats   = (it.seats || []).join(', ');
      const paxList = Array.isArray(it.passengers) ? it.passengers.map(p => `Pol ${p.seatNumber}: ${p.name}`) : [];

      lines.push(`
        <div class="summary-line">
          <div>
            <div><b>${origem}</b> → <b>${destino}</b></div>
            <div class="mute" style="font-size:.92rem">${dataV} • ${hora} • Poltronas: ${seats || '—'}</div>
            ${paxList.length ? `<div class="mute" style="font-size:.9rem;margin-top:4px">Passageiros: ${paxList.join(', ')}</div>` : ''}
          </div>
          <div><b>${fmtBRL(sub)}</b></div>
        </div>
      `);
    });

    if (summaryBody) {
      summaryBody.innerHTML = lines.join('');
      const totalEl = document.getElementById('summary-total');
      if (totalEl) totalEl.textContent = fmtBRL(total);
    } else if (legacySummary) {
      // layout antigo: mantém blocos que você já tinha
      legacySummary.innerHTML = `
        ${lines.join('')}
        <div class="total-line" style="margin-top:10px;display:flex;justify-content:space-between;align-items:center">
          <span class="total-label"><b>Total</b></span>
          <span class="total-amount" style="font-size:1.25rem;color:#005b28"><b>${fmtBRL(total)}</b></span>
        </div>
      `;
    }
    return total;
  }
  const amount = Number(renderSummary(items).toFixed(2));

  // ——— botão cancelar (novo layout)
  const btnCancel = document.getElementById('btn-cancel');
  if (btnCancel) btnCancel.addEventListener('click', () => { location.href = 'index.html'; });

  // ——— Public key
  let publicKey = '';
  try {
    const r = await fetch('/api/mp/pubkey');
    const j = await r.json();
    publicKey = j.publicKey || '';
  } catch (e) { console.error('Erro /api/mp/pubkey', e); }
  if (!publicKey) { alert('Chave pública do Mercado Pago não configurada.'); return; }

  // ——— SDK + Bricks (Payments API, sem preferência)
  const mp = new MercadoPago(publicKey, { locale: 'pt-BR' });
  const bricks = mp.bricks();

  const brickContainerId =
    document.getElementById('payment-bricks') ? 'payment-bricks' :
    (document.getElementById('payment-brick-container') ? 'payment-brick-container' : null);

  if (!brickContainerId) {
    console.error('Container do Bricks não encontrado.');
    return;
  }

  await bricks.create('payment', brickContainerId, {
    initialization: {
      amount,
      payer: { email: user.email || '' }
    },
    customization: {
      paymentMethods: {
        creditCard: 'all',
        debitCard: 'all',
        bankTransfer: ['pix'],
        minInstallments: 1,
        maxInstallments: 1
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

          const body = {
            transaction_amount: amount,
            description: 'Compra Turin Transportes',
            payer: {
              email: user.email || '',
              identification: formData?.payer?.identification ? {
                type: formData.payer.identification.type || 'CPF',
                number: String(formData.payer.identification.number || '').replace(/\D/g, '')
              } : undefined
            }
          };

          if (isPix) {
            body.payment_method_id = 'pix';
          } else {
            if (!formData?.token) { alert('Não foi possível tokenizar o cartão.'); return; }
            body.token = formData.token;
            body.payment_method_id = formData.payment_method_id; // ex.: 'visa'
            body.installments = 1;
            if (formData.issuer_id) body.issuer_id = formData.issuer_id;
          }

          Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
          if (body.payer && body.payer.identification === undefined) delete body.payer.identification;

          const resp = await fetch('/api/mp/pay', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const data = await resp.json();

          if (!resp.ok) throw new Error(data?.message || 'Falha ao processar pagamento');

          if (data.status === 'approved') {
            // marca como pago e vai para profile
            const bookings = JSON.parse(localStorage.getItem('bookings') || '[]').map(b => ({ ...b, paid: true }));
            localStorage.setItem('bookings', JSON.stringify(bookings));
            alert('Pagamento aprovado!');
            location.href = 'profile.html';
            return;
          }

          const pix = data?.point_of_interaction?.transaction_data;
          if (pix?.qr_code || pix?.qr_code_base64 || pix?.qr_text) {
            alert('Pix gerado! Conclua o pagamento no seu banco.');
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
});
