(async () => {
  // 1) Descobrir o total (com fallback para 1.00 só para não travar)
  let total = 0;
  try {
    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    total = bookings.reduce((acc, b) => acc + (Number(b?.price || 0)), 0);
  } catch {}
  if (!Number.isFinite(total) || total <= 0) total = 1.00; // fallback

  console.log('[payment.js] total =', total);

  // 2) Buscar a Public Key do servidor
  const pub = await fetch('/api/mp/pubkey').then(r => r.json()).catch(e => (console.error(e), {}));
  if (!pub?.publicKey) {
    alert('Public Key do MP não encontrada. Verifique /api/mp/pubkey.');
    return;
  }
  console.log('[payment.js] publicKey =', pub.publicKey);

  // 3) Instanciar MP + Bricks
  const mp = new MercadoPago(pub.publicKey, { locale: 'pt-BR' });
  const bricksBuilder = mp.bricks();

  // 4) Configurar o Brick (cartão, débito e pix), com parcelas desativadas (1x)
  const settings = {
    initialization: {
      amount: Number(total.toFixed(2)),
      payer: { email: '' }
    },
    customization: {
      paymentMethods: {
        creditCard: 'all',
        debitCard: 'all',
        bankTransfer: ['pix']
      },
      visual: { showInstallmentsSelector: false },
      maxInstallments: 1,
      installments: { quantity: 1, min: 1, max: 1 }
    },
    callbacks: {
      onReady: () => console.log('[MP] Brick pronto'),
      onError: (error) => {
        console.error('[MP] Brick error:', error);
        alert('Erro ao carregar o meio de pagamento. Veja o console.');
      },
      onSubmit: async ({ selectedPaymentMethod, formData }) => {
        try {
          console.log('[MP] onSubmit method =', selectedPaymentMethod, 'formData =', formData);

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
            payload.token = formData?.token;
            payload.installments = 1;
          }

          const resp = await fetch('/api/mp/pay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await resp.json();

          console.log('[MP] /pay ->', resp.status, data);

          if (!resp.ok) {
            alert(`Pagamento falhou: ${data?.message || 'Erro'}`);
            return;
          }

          if (data.status === 'approved') {
            alert('Pagamento aprovado!');
            window.location.href = 'profile.html';
          } else if (selectedPaymentMethod === 'pix' && data?.point_of_interaction?.transaction_data?.qr_code) {
            alert('Pix gerado! Copie e pague o código/QR.');
          } else {
            alert(`Status: ${data.status} - ${data.status_detail}`);
          }
        } catch (e) {
          console.error('[MP] submit erro:', e);
          alert('Erro inesperado ao enviar o pagamento.');
        }
      }
    }
  };

  // 5) Renderizar
  await bricksBuilder.create('payment', 'paymentBrick_container', settings);
})();
