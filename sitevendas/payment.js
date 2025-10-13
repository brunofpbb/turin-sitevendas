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
  console.log(total);
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

// --- ajuste na inicialização: garanta número (duas casas) ---
const amount = Number((total ?? 0).toFixed(2));

// ...
const settings = {
  initialization: {
    amount,                        // número (não string)
    payer: { email: user.email || '' } // útil pro Pix
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

    // === ESTE TRECHO SUBSTITUI O SEU onSubmit ===
    onSubmit: async ({ selectedPaymentMethod, formData }) => {
      try {
        // O Brick retorna exatamente estes campos (doc oficial):
        // formData.token, formData.payment_method_id, formData.issuer_id,
        // formData.payer.email, formData.payer.identification.{type, number}
        const method = String(selectedPaymentMethod || '').toLowerCase();
        const isPix = method === 'bank_transfer' ||
                      String(formData?.payment_method_id || '').toLowerCase() === 'pix';

        // Corpo em snake_case (Payments API)
        const body = {
          transaction_amount: amount,
          description: 'Compra Turin Transportes',
          payer: {
            email: formData?.payer?.email || user.email || '',
            identification: formData?.payer?.identification ? {
              type: formData.payer.identification.type,
              number: String(formData.payer.identification.number || '').replace(/\D/g, '')
            } : undefined
          }
        };

        if (isPix) {
          // PIX precisa somente destes campos
          body.payment_method_id = 'pix';
        } else {
          // Cartão / Débito — segue Card Payment Brick
          if (!formData?.token) {
            alert('Não foi possível tokenizar o cartão. Tente novamente.');
            return;
          }
          body.token = formData.token;                       // token gerado pelo Brick
          body.payment_method_id = formData.payment_method_id; // "visa", "master", ...
          body.installments = 1;
          if (formData.issuer_id) body.issuer_id = formData.issuer_id; // opcional
        }

        // remove undefineds
        Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
        if (body.payer && body.payer.identification === undefined) delete body.payer.identification;

        const resp = await fetch('/api/mp/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await resp.json();
        console.log('[MP] /pay ->', resp.status, data);

        if (!resp.ok) {
          // mensagens típicas: invalid_value, unauthorized, etc.
          throw new Error(data?.message || 'Falha ao processar pagamento');
        }

        // Sucesso em cartão
        if (data.status === 'approved' || data?.order?.status === 'processed') {
          alert('Pagamento aprovado! ID: ' + (data?.id || data?.order?.id));
          // window.location.href = 'profile.html';
          return;
        }

        // Sucesso em PIX
        const pix = data?.point_of_interaction?.transaction_data || data?.pix;
        if (pix?.qr_code || pix?.qr_code_base64 || pix?.qr_text) {
          alert('Pix gerado! Copie o código e conclua no seu banco.');
          return;
        }

        // Outros status (in_process, rejected…)
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
