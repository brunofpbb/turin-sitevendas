// payment.js – Payment Brick com crédito, débito e Pix
document.addEventListener('DOMContentLoaded', async () => {
  updateUserNav();

  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) {
    alert('Você precisa estar logado para pagar.');
    localStorage.setItem('postLoginRedirect', 'payment.html');
    window.location.href = 'login.html';
    return;
  }

  const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
  const summary  = document.getElementById('order-summary');
  if (bookings.length === 0) {
    summary.textContent = 'Nenhuma reserva encontrada.';
    return;
  }

  const last = bookings[bookings.length - 1];
  const pick = (...keys) => keys.find(v => v !== undefined && v !== null && v !== '') ?? '';
  const formatDateBR = (iso) => {
    if (typeof iso !== 'string' || !iso.includes('-')) return iso || '';
    const [y, m, d] = iso.split('-');
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  };

  const origem  = pick(last?.schedule?.originName, last?.schedule?.origin, last?.schedule?.origem, '—');
  const destino = pick(last?.schedule?.destinationName, last?.schedule?.destination, last?.schedule?.destino, '—');
  const dataViagem = formatDateBR(last?.schedule?.date);
  const hora       = pick(last?.schedule?.departureTime, last?.schedule?.horaPartida, '—');
  const seatList   = Array.isArray(last?.seats) ? last.seats.join(', ') : (last?.seat ?? '');
  const total      = Number(last?.price || 0);

  const totalBRL = total.toFixed(2).replace('.', ',');
  let passengersHtml = '';
  if (Array.isArray(last?.passengers)) {
    passengersHtml = '<p><strong>Passageiros:</strong></p><ul>' +
      last.passengers.map(p => `<li>Poltrona ${p.seatNumber}: ${p.name}</li>`).join('') +
      '</ul>';
  }
  summary.innerHTML = `
    <p><strong>Origem:</strong> ${origem}</p>
    <p><strong>Destino:</strong> ${destino}</p>
    <p><strong>Data da Viagem:</strong> ${dataViagem}</p>
    <p><strong>Saída:</strong> ${hora}</p>
    <p><strong>Poltronas:</strong> ${seatList}</p>
    ${passengersHtml}
    <div class="total-line">
      <span class="total-label">Valor Total:</span>
      <span class="total-amount">R$ ${totalBRL}</span>
    </div>
  `;

  // === Public Key do back ===
  const pubRes = await fetch('/api/mp/pubkey');
  const { publicKey } = await pubRes.json();
  if (!publicKey) {
    alert('Chave pública do Mercado Pago não configurada.');
    return;
  }

  // === SDK v2 ===
  const mp = new MercadoPago(publicKey, { locale: 'pt-BR' });
  const bricksBuilder = mp.bricks();

  // Caixa para exibir QR/código Pix
  const ensurePixBox = () => {
    let box = document.getElementById('pix-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'pix-box';
      box.style.marginTop = '16px';
      box.style.padding = '12px';
      box.style.border = '1px solid #d9d9d9';
      box.style.borderRadius = '8px';
      box.innerHTML = `
        <h4>Pagamento via Pix</h4>
        <div id="pix-qr" style="margin:8px 0"></div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="pix-code" type="text" readonly style="flex:1;padding:.5rem;border:1px solid #ccc;border-radius:4px">
          <button id="pix-copy" class="btn btn-ghost" type="button">Copiar código</button>
        </div>
        <p id="pix-status" style="margin-top:8px;color:#555">Aguardando pagamento...</p>
      `;
      // coloca logo após o container do brick
      const container = document.getElementById('payment-brick-container');
      container.parentNode.insertBefore(box, container.nextSibling);

      document.getElementById('pix-copy').addEventListener('click', () => {
        const el = document.getElementById('pix-code');
        el.select();
        document.execCommand('copy');
        alert('Código Pix copiado.');
      });
    }
    return box;
  };

  // Render do Payment Brick (crédito, débito e Pix)
  const renderPaymentBrick = async () => {
    const settings = {
      initialization: {
        amount: total,
        payer: { email: user.email || '' },
      },
      customization: {
        paymentMethods: {
          creditCard: 'all',
          debitCard: 'all',
          bankTransfer: ['pix'], // habilita Pix
        },
        visual: { style: { theme: 'default' } },
      },
      callbacks: {
        // ✅ exigido pelo Brick
        onReady: () => console.log('[MP] Brick pronto'),
        // ✅ exigido pelo Brick
        onError: (error) => {
          console.error('[MP] Brick error:', error);
          alert('Erro ao carregar o meio de pagamento. Veja o console.');
        },
        // Dispara no submit do formulário do Brick
        onSubmit: async ({ selectedPaymentMethod, formData }) => {
          try {
            const payload = {
              ...formData,
              transactionAmount: total,                 // 👈 server espera camelCase
              paymentMethodId: selectedPaymentMethod,   // garante 'pix' quando for Pix
              description: 'Compra Turin Transportes',
            };

            const resp = await fetch('/api/mp/pay', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data?.message || 'Falha ao processar pagamento');

            // Cartão aprovado
            if (data.status === 'approved') {
              const b = JSON.parse(localStorage.getItem('bookings') || '[]');
              if (b.length > 0) {
                b[b.length - 1].paid = true;
                localStorage.setItem('bookings', JSON.stringify(b));
              }
              alert('Pagamento aprovado! (ID: ' + data.id + ')');
              window.location.href = 'profile.html';
              return;
            }

            // Pix pendente: exibir QR e código
            const lower = String(data.status || '').toLowerCase();
            if (lower === 'pending' || lower === 'in_process') {
              const box = ensurePixBox();
              const qrB64 = data?.pix?.qr_base64 || '';
              const qrStr = data?.pix?.qr_text || '';

              const qrArea = document.getElementById('pix-qr');
              const codeEl = document.getElementById('pix-code');
              qrArea.innerHTML = qrB64 ? `<img src="data:image/png;base64,${qrB64}" alt="QR Pix">` : '';
              codeEl.value = qrStr;

              alert('Use o QR ou o código Pix para concluir o pagamento.');
              return;
            }

            // Outros status (ex.: rejected)
            alert('Status do pagamento: ' + (data.status || 'desconhecido'));
          } catch (err) {
            console.error('Pagamento falhou:', err);
            alert('Não foi possível concluir o pagamento. Verifique os dados e tente novamente.');
          }
        },
      },
    };

    await bricksBuilder.create('payment', 'payment-brick-container', settings);
  };

  await renderPaymentBrick();

  // Cancelar
  document.getElementById('cancel-btn').addEventListener('click', () => {
    const b = JSON.parse(localStorage.getItem('bookings') || '[]');
    if (b.length > 0) {
      b.pop();
      localStorage.setItem('bookings', JSON.stringify(b));
    }
    window.location.href = 'index.html';
  });
});

