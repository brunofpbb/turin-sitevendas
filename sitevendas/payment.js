// payment.js — Turin / Mercado Pago (Payment Brick)
// força 1x no backend (Orders API). Aqui mantemos config simples para garantir render do cartão.

document.addEventListener('DOMContentLoaded', async () => {
  /* --------- user/login --------- */
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) {
    alert('Você precisa estar logado para pagar.');
    localStorage.setItem('postLoginRedirect', 'payment.html');
    location.href = 'login.html';
    return;
  }
  if (typeof updateUserNav === 'function') updateUserNav();

  /* --------- resumo do pedido --------- */
  const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
  const summaryEl = document.getElementById('order-summary');
  if (!bookings.length) {
    if (summaryEl) summaryEl.textContent = 'Nenhuma reserva encontrada.';
    return;
  }
  const last = bookings[bookings.length - 1];

  const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '') ?? '';
  const formatDateBR = (iso) => {
    if (typeof iso !== 'string' || !iso.includes('-')) return iso || '';
    const [y, m, d] = iso.split('-');
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  };

  const origem  = pick(last?.schedule?.originName, last?.schedule?.origin, last?.schedule?.origem, '—');
  const destino = pick(last?.schedule?.destinationName, last?.schedule?.destination, last?.schedule?.destino, '—');
  const dataV   = formatDateBR(last?.schedule?.date);
  const hora    = pick(last?.schedule?.departureTime, last?.schedule?.horaPartida, '—');
  const seats   = Array.isArray(last?.seats) ? last.seats.join(', ') : (last?.seat ?? '');
  const total   = Number(last?.price || 0);
  const totalBRL = total.toFixed(2).replace('.', ',');

  let passengersHtml = '';
  if (Array.isArray(last?.passengers) && last.passengers.length) {
    passengersHtml =
      '<p><strong>Passageiros:</strong></p><ul>' +
      last.passengers.map(p => `<li>Poltrona ${p.seatNumber}: ${p.name}</li>`).join('') +
      '</ul>';
  }

  if (summaryEl) {
    summaryEl.innerHTML = `
      <p><strong>Origem:</strong> ${origem}</p>
      <p><strong>Destino:</strong> ${destino}</p>
      <p><strong>Data da Viagem:</strong> ${dataV}</p>
      <p><strong>Saída:</strong> ${hora}</p>
      <p><strong>Poltronas:</strong> ${seats}</p>
      ${passengersHtml}
      <div class="total-line">
        <span class="total-label">Valor Total:</span>
        <span class="total-amount">R$ ${totalBRL}</span>
      </div>
    `;
  }

  /* --------- public key --------- */
  let publicKey = '';
  try {
    const r = await fetch('/api/mp/pubkey');
    const j = await r.json();
    publicKey = j.publicKey || '';
  } catch (e) {
    console.error('Erro /api/mp/pubkey', e);
  }
  if (!publicKey) {
    alert('Chave pública do Mercado Pago não configurada.');
    return;
  }

  /* --------- SDK + Bricks --------- */
  const mp = new MercadoPago(publicKey, { locale: 'pt-BR' });
  const bricksBuilder = mp.bricks();

  /* --------- Config do Payment Brick --------- */
  const settings = {
    initialization: {
      amount: total,
      payer: { email: user.email || '' }, // Pix precisa de e-mail
    },
    customization: {
      // forma simples/estável para garantir o render de cartão
      paymentMethods: {
        creditCard: 'all',
        debitCard: 'all',
        bankTransfer: ['pix'],
      },
      visual: { style: { theme: 'default' } },
    },
    callbacks: {
      onReady: () => console.log('[MP] Brick pronto'),
      onError: (error) => {
        console.error('[MP] Brick error:', error);
        alert('Erro ao carregar o pagamento (ver console).');
      },

      // formData já vem tokenizado para cartão
      onSubmit: async ({ selectedPaymentMethod, formData }) => {
        try {
          const method = String(selectedPaymentMethod || '').toLowerCase();
          const isPix  =
            method === 'bank_transfer' ||
            String(formData?.payment_method_id || '').toLowerCase() === 'pix';

          // base enviada para o backend
          const payload = {
            transactionAmount: total,
            description: 'Compra Turin Transportes',
            installments: 1, // 1x — não exibimos/forçamos no front; o backend garante
            payer: {
              ...(formData?.payer || {}),
              entityType: 'individual',
            },
          };

          // normaliza CPF se veio
          if (payload?.payer?.identification?.number) {
            payload.payer.identification.number =
              String(payload.payer.identification.number).replace(/\D/g, '');
          }

          if (isPix) {
            payload.paymentMethodId = 'pix';
            if (!payload.payer?.email) {
              alert('Informe seu e-mail para receber o Pix.');
              return;
            }
          } else {
            payload.paymentMethodId  = 'credit_card';
            payload.token            = formData?.token;                 // token do cartão
            payload.payment_method_id = formData?.payment_method_id;    // 'visa','master',…

            if (!payload.token) {
              alert('Não foi possível tokenizar o cartão. Tente novamente.');
              return;
            }
          }

          // limpa undefineds
          Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

          const resp = await fetch('/api/mp/pay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await resp.json();
          console.log('[MP] /pay', resp.status, data);

          if (!resp.ok) throw new Error(data?.message || 'Falha ao processar');

          if (data?.order?.status === 'processed' || data?.status === 'approved') {
            alert('Pagamento aprovado! ID: ' + (data?.id || data?.order?.id));
            // TODO: marcar compra como paga e redirecionar
            // window.location.href = 'profile.html';
          } else if (data?.pix?.qr_text || data?.pix?.qr_base64) {
            alert('Pix gerado. Use o QR/Texto para pagar.');
          } else {
            alert('Pagamento criado: ' + (data?.status_detail || data?.status || 'verifique'));
          }
        } catch (err) {
          console.error('Pagamento falhou:', err);
          alert('Pagamento falhou: ' + (err?.message || 'erro'));
        }
      },
    },
  };

  await bricksBuilder.create('payment', 'payment-brick-container', settings);
});
