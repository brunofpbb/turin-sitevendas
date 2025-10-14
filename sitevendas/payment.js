// payment.js — Turin / Mercado Pago (Payment Brick)
// força 1x no backend. Aqui mantemos config simples para garantir render do cartão.

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

  // Garantir número com 2 casas
  const amount = Number((total ?? 0).toFixed(2));

  // Helper: polling para pagamentos "in_process"
  function startPolling(paymentId) {
    const started = Date.now();

    const tick = async () => {
      try {
        const r = await fetch(`/api/mp/payments/${paymentId}`);
        const s = await r.json();
        console.log('[MP] poll status', s);

        if (s.status === 'approved') {
          alert('Pagamento aprovado! ID: ' + paymentId);
          // TODO: marcar compra como paga e redirecionar
          // window.location.href = 'profile.html';
          return;
        }
        if (s.status === 'rejected') {
          alert('Pagamento recusado: ' + (s.status_detail || 'verifique os dados'));
          return;
        }

        if (Date.now() - started < 60_000) {
          setTimeout(tick, 5_000);
        } else {
          alert('Pagamento em análise. Você pode acompanhar em "Minhas viagens".');
        }
      } catch (e) {
        console.error('Falha no polling de status', e);
      }
    };

    setTimeout(tick, 5_000);
  }

  /* --------- Config do Payment Brick --------- */
  const settings = {
    initialization: {
      amount,                               // número (não string)
      payer: { email: user.email || '' }    // útil para Pix
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
      onError: (error) => {
        console.error('[MP] Brick error:', error);
        alert('Erro ao carregar o pagamento (ver console).');
      },

      // Submissão do Brick
      onSubmit: async ({ selectedPaymentMethod, formData }) => {
        try {
          const method = String(selectedPaymentMethod || '').toLowerCase();
          const isPix = method === 'bank_transfer' ||
                        String(formData?.payment_method_id || '').toLowerCase() === 'pix';

          // Corpo em snake_case (Payments API)
          const body = {
            transaction_amount: amount,
            description: 'Compra Turin Transportes',
            payer: {
              // enquanto testa, mantenha o e-mail fixo para evitar internal_error
              email: 'teste@teste.com' /*user.email*/,





              
              identification: formData?.payer?.identification ? {
                type: formData.payer.identification.type,
                number: String(formData.payer.identification.number || '').replace(/\D/g, '')
              } : undefined
            }
          };

          if (isPix) {
            body.payment_method_id = 'pix';
          } else {
            // Cartão/Débito
            if (!formData?.token) {
              alert('Não foi possível tokenizar o cartão. Tente novamente.');
              return;
            }
            body.token = formData.token;                         // token gerado pelo Brick
            body.payment_method_id = formData.payment_method_id; // 'visa', 'master', ...
            body.installments = 1;
            if (formData.issuer_id) body.issuer_id = formData.issuer_id; // opcional
          }

          // limpar undefineds
          Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
          if (body.payer && body.payer.identification === undefined) {
            delete body.payer.identification;
          }

          const resp = await fetch('/api/mp/pay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const data = await resp.json();
          console.log('[MP] /pay ->', resp.status, data);

          if (!resp.ok) {
            throw new Error(data?.message || 'Falha ao processar pagamento');
          }

          // Cartão aprovado
          if (data.status === 'approved' || data?.order?.status === 'processed') {
            alert('Pagamento aprovado! ID: ' + (data?.id || data?.order?.id));
            // window.location.href = 'profile.html';
            return;
          }

          // Pix gerado
          const pix = data?.point_of_interaction?.transaction_data || data?.pix;
          if (pix?.qr_code || pix?.qr_code_base64 || pix?.qr_text) {
            alert('Pix gerado! Copie o código/QR e conclua no seu banco.');
            return;
          }

          // Em análise -> inicia polling
          if (data?.id && data?.status === 'in_process') {
            alert(`Pagamento criado: ${data.status} - ${data.status_detail || ''}`);
            startPolling(data.id);
            return;
          }

          // Outros estados
          alert(`Pagamento criado: ${data.status} - ${data.status_detail || ''}`);
        } catch (err) {
          console.error('Pagamento falhou:', err);
          alert('Pagamento falhou: ' + (err?.message || 'erro'));
        }
      }
    }
  };

  await bricksBuilder.create('payment', 'payment-brick-container', settings);
});
