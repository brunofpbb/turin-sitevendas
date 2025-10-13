// sitevendas/payment.js
(async () => {
  const pub = await fetch('/api/mp/pubkey').then(r => r.json()).catch(() => ({}));
  if (!pub.publicKey) {
    alert('Public Key não encontrada no servidor.');
    return;
  }

  // Recupera user/cart/valor como você já fazia
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
  const last = bookings[bookings.length - 1] || {};
  const total = Number(last?.total || last?.valorTotal || 0);
  if (!total) {
    alert('Valor total não encontrado.');
    return;
  }

  // Injeta CSS para esconder completamente o seletor de parcelas (fallback visual)
  const css = document.createElement('style');
  css.textContent = `
    /* classes internas podem variar entre versões; usamos seletores genéricos */
    [class*="installments"], [data-test-id*="installments"] { display: none !important; }
  `;
  document.head.appendChild(css);

  const mp = new MercadoPago(pub.publicKey, { locale: 'pt-BR' });
  const bricksBuilder = mp.bricks();

  const paymentsBrick = await bricksBuilder.create('payment', 'mp-checkout', {
    initialization: {
      amount: total, // número
      payer: { email: user.email || '' }
    },
    customization: {
      // força 1x – algumas versões do Brick respeitam maxInstallments
      paymentMethods: {
        creditCard: {
          maxInstallments: 1
        },
        debitCard: 'all',
        bankTransfer: ['pix']
      },
      visual: {
        style: { theme: 'default' }
      }
    },
    callbacks: {
      onReady: () => console.log('[MP] Brick pronto'),
      onError: (error) => {
        console.error('[MP] Brick error:', error);
        alert('Erro ao carregar o meio de pagamento (veja o console).');
      },
      onSubmit: async ({ selectedPaymentMethod, formData }) => {
        try {
          // Normaliza o que mandaremos ao backend
          const method = selectedPaymentMethod; // "credit_card" | "debit_card" | "pix"
          const payload = {
            transaction_amount: total,
            payer: {
              email: user.email || '',
              identification: formData?.payer?.identification
                ? {
                    type: formData.payer.identification.type || 'CPF',
                    number: String(formData.payer.identification.number || '').replace(/\D/g, '')
                  }
                : undefined
            }
          };

          if (method === 'pix') {
            payload.payment_method_id = 'pix';
            // NÃO envia token
          } else {
            // cartão (crédito/débito)
            payload.payment_method_id = formData?.payment_method_id; // ex: "visa", "master"
            payload.token = formData?.token; // token gerado pelo Brick
            payload.installments = 1;        // reforça 1x
          }

          const resp = await fetch('/api/mp/pay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const data = await resp.json();
          if (!resp.ok) throw new Error(data?.message || 'Falha ao processar');

          // === Sucesso ===
          if (method === 'pix') {
            // Exibe QR/ticket
            const qrBase64 = data?.qr_code_base64;
            const ticketUrl = data?.ticket_url;
            if (qrBase64) {
              const img = document.createElement('img');
              img.src = `data:image/png;base64,${qrBase64}`;
              img.style.maxWidth = '280px';
              alert('Pix gerado! O QR será exibido na página.');
              document.getElementById('mp-checkout')?.appendChild(img);
            } else if (ticketUrl) {
              window.open(ticketUrl, '_blank');
            } else {
              alert('Pix criado (sem QR). Verifique o console.');
              console.log('[MP][PIX] resp:', data);
            }
          } else {
            // Cartão aprovado ou em análise
            alert(`Pagamento aprovado/recebido!\nID: ${data.id}\nStatus: ${data.status}`);
            // marca compra como paga (se você controla no localStorage)
            if (bookings.length) {
              bookings[bookings.length - 1].paid = true;
              localStorage.setItem('bookings', JSON.stringify(bookings));
            }
            window.location.href = 'profile.html';
          }
        } catch (e) {
          console.error('[Pagamento falhou]', e);
          alert(`Pagamento falhou: ${e?.message || e}`);
        }
      }
    }
  });
})();
