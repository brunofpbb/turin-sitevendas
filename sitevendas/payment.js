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
