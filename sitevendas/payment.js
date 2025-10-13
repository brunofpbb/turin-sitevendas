// sitevendas/payment.js
(function () {
  // ---- utilidades ------------------------------------
  function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }
  function toNumber(n) { const v = Number(n); return isFinite(v) ? v : 0; }
  function parseBRL(text) {
    if (!text) return 0;
    // pega o primeiro "R$ 1.234,56" que aparecer
    const m = String(text).match(/R\$\s*([\d\.\,]+)/);
    if (!m) return 0;
    return toNumber(m[1].replace(/\./g, '').replace(',', '.'));
  }

  function getAmountFromStorage() {
    const tryKeys = ['bookings', 'order', 'cart', 'checkout', 'lastOrder'];
    for (const key of tryKeys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      let obj;
      try { obj = JSON.parse(raw); } catch { obj = null; }
      if (!obj) continue;

      // se for array, pega o último
      const o = Array.isArray(obj) ? obj[obj.length - 1] : obj;
      if (!o) continue;

      // tenta várias propriedades comuns
      const guesses = [
        o.total, o.valorTotal, o.valor_total, o.amount, o.total_amount,
        o.price, o.totalPrice, o.finalPrice, o.final_price
      ].map(toNumber);

      const found = guesses.find(v => v > 0);
      if (found) return found;

      // fallback: se tiver seats e price
      if (o.seats && o.price) {
        const v = toNumber(o.seats) * toNumber(o.price);
        if (v > 0) return v;
      }
    }
    return 0;
  }

  function getAmountFromDOM() {
    // tenta achar "R$ ..." no resumo do pedido
    const nodes = [
      document.querySelector('#order-summary'),
      document.querySelector('main'),
      document.body
    ].filter(Boolean);

    for (const n of nodes) {
      const v = parseBRL(n.textContent || '');
      if (v > 0) return v;
    }
    return 0;
  }

  async function boot() {
    // 1) pega public key do backend
    const pub = await fetch('/api/mp/pubkey').then(r => r.json()).catch(() => ({}));
    if (!pub.publicKey) {
      alert('Public Key não encontrada no servidor.');
      console.error('[MP] /api/mp/pubkey sem chave pública');
      return;
    }

    // 2) descobre o total
    let total = getAmountFromStorage();
    if (!total) total = getAmountFromDOM();

    console.log('[payment.js] total detectado =', total);
    if (!total) {
      alert('Valor total não encontrado.');
      return;
    }

    // 3) usuário (apenas email já é suficiente)
    const user = JSON.parse(localStorage.getItem('user') || '{}');

/*
    
    // 4) injeta CSS extra para esconder seletor de parcelas (cinto de segurança)
    const css = document.createElement('style');
    css.textContent = `
      [data-testid="installments"],
      .mp-CardPayment-installments,
      .mp-payment-installments,
      .mp-form-control--installments { display:none !important; visibility:hidden !important; height:0 !important; margin:0 !important; padding:0 !important; overflow:hidden !important; }
    `;
    document.head.appendChild(css);
*/
    // 5) cria o Brick
    const mp = new MercadoPago(pub.publicKey, { locale: 'pt-BR' });
    const bricksBuilder = mp.bricks();

    await bricksBuilder.create('payment', 'payment-brick-container', {
      initialization: {
        amount: total,
        payer: { email: user.email || '' }
      },
      customization: {
        paymentMethods: {
          creditCard: { Installments: 1, default_installments: 1 },   // força 1x
          debitCard: 'all',
          bankTransfer: ['pix']
        },
        visual: { style: { theme: 'default' } }
      },
      callbacks: {
        onReady: () => console.log('[MP] Brick pronto'),
        onError: (error) => {
          console.error('[MP] Brick error:', error);
          alert('Erro ao carregar o meio de pagamento (veja o console).');
        },
        onSubmit: async ({ selectedPaymentMethod, formData }) => {
          try {
            const method = selectedPaymentMethod; // "credit_card" | "debit_card" | "pix"
            console.log('[MP] submit method=', method, 'formData=', formData);

            const payload = {
              transaction_amount: total,
              payer: {
                email: user.email || '',
                identification: formData?.payer?.identification
                  ? {
                      type: formData.payer.identification.type || 'CPF',
                      number: onlyDigits(formData.payer.identification.number || '')
                    }
                  : undefined
              }
            };

            if (method === 'pix') {
              payload.payment_method_id = 'pix';            // sem token
            } else {
              payload.payment_method_id = formData?.payment_method_id; // "visa", "master", ...
              payload.token = formData?.token;              // token gerado pelo Brick
              payload.installments = 1;                     // reforça 1x
            }

            const resp = await fetch('/api/mp/pay', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data?.message || 'Falha ao processar');

            if (method === 'pix') {
              // exibe QR base64 se vier
              if (data?.qr_code_base64) {
                const img = document.createElement('img');
                img.src = `data:image/png;base64,${data.qr_code_base64}`;
                img.style.maxWidth = '260px';
                img.style.marginTop = '12px';
                document.getElementById('payment-brick-container')?.appendChild(img);
                alert('Pix gerado! O QR foi mostrado na página.');
              } else if (data?.ticket_url) {
                window.open(data.ticket_url, '_blank');
              } else {
                alert('Pix criado. Veja detalhes no console.');
                console.log('[MP][PIX] resp:', data);
              }
            } else {
              alert(`Pagamento recebido!\nID: ${data.id}\nStatus: ${data.status}`);
              // marca como pago (se você controla localStorage)
              try {
                const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
                if (bookings.length) {
                  bookings[bookings.length - 1].paid = true;
                  localStorage.setItem('bookings', JSON.stringify(bookings));
                }
              } catch {}
              window.location.href = 'profile.html';
            }
          } catch (e) {
            console.error('[Pagamento falhou]', e);
            alert(`Pagamento falhou: ${e?.message || e}`);
          }
        }
      }
    });
  }

  // garante que o DOM esteja pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
