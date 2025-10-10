// payment.js — Mercado Pago Payment Brick (crédito, débito e Pix)
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof updateUserNav === 'function') updateUserNav();

  /* -------------------- 1) Checagem de login -------------------- */
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) {
    alert('Você precisa estar logado para pagar.');
    localStorage.setItem('postLoginRedirect', 'payment.html');
    window.location.href = 'login.html';
    return;
  }

  /* -------------------- 2) Carrega último pedido (resumo) -------------------- */
  const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
  const summary = document.getElementById('order-summary');
  if (!bookings.length) {
    if (summary) summary.textContent = 'Nenhuma reserva encontrada.';
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

  if (summary) {
    summary.innerHTML = `
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

  /* -------------------- 3) Public Key do backend -------------------- */
  const pubRes = await fetch('/api/mp/pubkey');
  if (!pubRes.ok) {
    const txt = await pubRes.text();
    console.error('Erro ao obter pubkey:', pubRes.status, txt.slice(0, 200));
    alert('Falha ao obter chave pública do MP. Veja o console.');
    return;
  }
  const { publicKey } = await pubRes.json();
  if (!publicKey) {
    alert('Chave pública do Mercado Pago não configurada no servidor.');
    return;
  }

  /* -------------------- 4) Inicializa SDK/Bricks -------------------- */
  const mp = new MercadoPago(publicKey, { locale: 'pt-BR' });
  const bricksBuilder = mp.bricks();

  /* -------------------- 5) Config do Brick -------------------- */
  const settings = {
    initialization: {
      amount: total,                     // valor total
      payer: { email: user.email || '' } // e-mail do logado
    },
    customization: {
      paymentMethods: {
        creditCard: {
          // força 1x e oculta seletor de parcelas
          maxInstallments: 1,
          installments: { quantity: 1, min: 1, max: 1 },
          visual: { showInstallmentsSelector: false },
        },
        debitCard: 'all',
        bankTransfer: ['pix'], // Pix continua disponível
      },
      visual: { style: { theme: 'default' } },
    },

    callbacks: {
      onReady: () => console.log('[MP] Brick pronto'),

      onError: (error) => {
        console.error('[MP] Brick error:', error);
        alert('Erro ao carregar o meio de pagamento (ver console).');
      },

      // Dados tokenizados do Brick
      onSubmit: async ({ selectedPaymentMethod, formData }) => {
        try {
          console.log('[MP] formData:', formData, 'method:', selectedPaymentMethod);

          // payload mínimo esperado pelo /api/mp/pay
          const payload = {
            transactionAmount: total,
            description: 'Compra Turin Transportes',
            token: formData.token,
            installments: 1, // força 1x
            payment_method_id: formData.payment_method_id, // 'visa' | 'master' …
            payer: {
              ...(formData.payer || {}),
              entityType: 'individual',
            },
          };

          // Normaliza CPF (só dígitos)
          if (payload?.payer?.identification?.number) {
            payload.payer.identification.number =
              String(payload.payer.identification.number).replace(/\D/g, '');
          }

          // remove campos que não usamos
          delete payload.issuer_id;
          delete payload.paymentMethodId;

          const resp = await fetch('/api/mp/pay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          const data = await resp.json();
          console.log('[MP] /pay resp:', resp.status, data);

          if (!resp.ok) {
            throw new Error(data?.message || 'Falha ao processar');
          }

          // Sucesso
          if (data?.order?.status === 'processed' || data?.status === 'approved') {
            alert('Pagamento aprovado! ID: ' + (data?.id || data?.order?.id));
            // TODO: marque a reserva como paga e redirecione
            // window.location.href = 'profile.html';
          } else if (data?.pix?.qr_text) {
            // Pix pendente (se um dia usar submit Pix do mesmo brick)
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

  /* -------------------- 6) Render do Brick -------------------- */
  // ATENÇÃO: o ID precisa bater com o HTML: <div id="payment-brick-container"></div>
  await bricksBuilder.create('payment', 'payment-brick-container', settings);
});
