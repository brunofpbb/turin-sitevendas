// sitevendas/payment.js
(async () => {
  // ------ total ------
  // Se você guarda o total no localStorage ou querystring, ajuste aqui.
  // Exemplo simples: buscar do storage:
  const saved = JSON.parse(localStorage.getItem('bookings') || '[]');
  const total = saved.reduce((sum, b) => sum + (Number(b?.price || 0)), 0);
  console.log('[payment.js] total detectado =', total);

  // ------ Public Key ------
  const { publicKey } = await fetch('/api/mp/pubkey').then(r => r.json());
  if (!publicKey) {
    alert('Chave pública do MP não encontrada.');
    return;
  }

  const mp = new MercadoPago(publicKey, { locale: 'pt-BR' });
  const bricksBuilder = mp.bricks();

  const container = document.getElementById('paymentBrick_container');

  const settings = {
    initialization: {
      amount: Number(total.toFixed(2)), // valor total
      payer: { email: '' } // se tiver, preencha
    },
    customization: {
      paymentMethods: {
        // habilita abas de cartão crédito / débito e pix
        creditCard: 'all',
        debitCard: 'all',
        bankTransfer: ['pix']
      },
      // força 1x SEM seletor de parcelas (fallbacks p/ versões do Brick)
      visual: { showInstallmentsSelector: false },
      maxInstallments: 1,
      installments: { quantity: 1, min: 1, max: 1 }
    },
    callbacks: {
      onReady: () => console.log('[MP] Brick pronto'),
      onError: (error) => {
        console.error('[MP] Brick error:', error);
        // causas comuns: CSP bloqueando sdk/mlstatic, ou total inválido
      },

      // -------- envio efetivo p/ o backend --------
      onSubmit: async ({ selectedPaymentMethod, formData }) => {
        try {
          // formData vem do Brick com todos campos necessários
          console.log('[MP] submit method =', selectedPaymentMethod, 'formData=', formData);

          // Monta o payload p/ nosso backend
          const payload = {
            payment_method_id: selectedPaymentMethod, // 'credit_card' | 'debit_card' | 'pix'
            transaction_amount: Number(total.toFixed(2)),
            description: 'Compra Turin Transportes',
            payer: formData?.payer || {}
          };

          if (selectedPaymentMethod === 'pix') {
            if (!payload.payer?.email) {
              alert('Informe um e-mail para receber o Pix.');
              return;
            }
          } else {
            // cartao
            payload.token = formData?.token;
            payload.installments = 1; // força 1x
            // Não envie payment_method_id (bandeira) nem issuer_id — o MP infere pelo token
          }

          const resp = await fetch('/api/mp/pay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const data = await resp.json();

          if (!resp.ok) {
            console.error('[MP] /pay resp', resp.status, data);
            alert(`Pagamento falhou: ${data?.message || 'Erro'}`);
            return;
          }

          console.log('[MP] pagamento OK:', data);

          // AQUI VOCÊ DECIDE A NAVEGAÇÃO PÓS-PAGAMENTO
          if (data.status === 'approved') {
            // Marcar reserva como paga, etc
            alert('Pagamento aprovado!');
            window.location.href = 'profile.html';
          } else if (payload.payment_method_id === 'pix' && data?.point_of_interaction?.transaction_data?.qr_code_base64) {
            // Você pode exibir o QR ou redirecionar para tela de status
            alert('Pix gerado! Abra o comprovante / QR.');
          } else {
            alert(`Status: ${data.status} - ${data.status_detail}`);
          }
        } catch (err) {
          console.error('[MP] submit err', err);
          alert('Erro inesperado ao enviar o pagamento.');
        }
      }
    }
  };

  // Renderiza o Payment Brick
  await bricksBuilder.create('payment', 'paymentBrick_container', settings);
})();




/*
// sitevendas/payment.js
(function () {
  // ---------- helpers ----------
  const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
  const toNumber = (n) => {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
  };
  const parseBRL = (text) => {
    if (!text) return 0;
    const m = String(text).match(/R\$\s*([\d\.\,]+)/);
    if (!m) return 0;
    return toNumber(m[1].replace(/\./g, '').replace(',', '.'));
  };

  function getAmountFromStorage() {
    const tryKeys = ['bookings', 'order', 'cart', 'checkout', 'lastOrder'];
    for (const key of tryKeys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      let obj;
      try { obj = JSON.parse(raw); } catch { obj = null; }
      if (!obj) continue;

      const o = Array.isArray(obj) ? obj[obj.length - 1] : obj;
      if (!o) continue;

      const guesses = [
        o.total, o.valorTotal, o.valor_total, o.amount, o.total_amount,
        o.price, o.totalPrice, o.finalPrice, o.final_price
      ].map(toNumber);

      const found = guesses.find(v => v > 0);
      if (found) return found;

      if (o.seats && o.price) {
        const v = toNumber(o.seats) * toNumber(o.price);
        if (v > 0) return v;
      }
    }
    return 0;
  }

  function getAmountFromDOM() {
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
    // 1) pega a public key do backend
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

    // 3) usuário (apenas email já ajuda no risco)
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    // 4) esconde visualmente o seletor de parcelas (cinto de segurança)
    const css = document.createElement('style');
    css.textContent = `
      [data-testid="installments"],
      .mp-CardPayment-installments,
      .mp-payment-installments,
      .mp-form-control--installments {
        display: none !important; visibility: hidden !important; height: 0 !important;
        margin: 0 !important; padding: 0 !important; overflow: hidden !important;
      }
    `;
    document.head.appendChild(css);

    // 5) cria o Payment Brick
    const mp = new MercadoPago(pub.publicKey, { locale: 'pt-BR' });
    const bricks = mp.bricks();

    await bricks.create('payment', 'payment-brick-container', {
      initialization: {
        amount: total,
        payer: { email: user.email || '' }
      },
      customization: {
        paymentMethods: {
          creditCard: { installments: 1, maxInstallments: 1 }, // tenta travar via config
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
              payload.payment_method_id = 'pix';
            } else {
              payload.payment_method_id = formData?.payment_method_id; // ex.: "visa", "master"
              payload.token = formData?.token;                         // token gerado pelo Brick
              payload.installments = 1;                                // reforço 1x
            }

            const resp = await fetch('/api/mp/pay', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data?.message || 'Falha ao processar');

            if (method === 'pix') {
              // mostra o QR se vier como base64
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
              // marca como pago no localStorage (se você usa)
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
