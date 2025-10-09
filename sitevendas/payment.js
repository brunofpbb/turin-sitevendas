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

  // Obtém a public key do back
  const pubRes = await fetch('/api/mp/pubkey');
  const { publicKey } = await pubRes.json();
  if (!publicKey) {
    alert('Chave pública do Mercado Pago não configurada.');
    return;
  }

  const mp = new MercadoPago(publicKey, { locale: 'pt-BR' }); // SDK v2
  const bricksBuilder = mp.bricks();

  // Área para Pix (QR e cópia)
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
      summary.parentNode.insertBefore(box, summary.nextSibling);
      document.getElementById('pix-copy').addEventListener('click', () => {
        const el = document.getElementById('pix-code');
        el.select();
        document.execCommand('copy');
        alert('Código Pix copiado.');
      });
    }
    return box;
  };

  // Render do Payment Brick com crédito, débito e Pix
  const renderPaymentBrick = async () => {
    const settings = {
      initialization: {
        amount: total,
        payer: { email: user.email || '' },
      },
      customization: {
        // Créditos, Débitos e Pix habilitados no Payment Brick
        paymentMethods: {
          creditCard: 'all',
          debitCard: 'all',
          bankTransfer: ['pix'], // Pix
        },
        visual: { style: { theme: 'default' } },
      },
      callbacks: {
        onSubmit: async (formData) => {
          try {
            // Envia tudo ao back. Campos mínimos p/ cartão:
            // token, transaction_amount, installments, payment_method_id, payer.email
            // Para Pix: payment_method_id === 'pix' e amount + payer.email já bastam.
            const payload = {
              ...formData,
              transaction_amount: total,
              description: 'Compra Turin Transportes',
            };

            const resp = await fetch('/api/mp/pay', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await resp.json();
            if (!resp.ok || !data.ok) throw new Error(data?.error || 'Falha ao processar pagamento');

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

            // Pix: status pendente/in_process → mostrar QR/copia e aguardar
            const lower = String(data.status || '').toLowerCase();
            if (lower === 'pending' || lower === 'in_process') {
              const box = ensurePixBox();
              const poi = data.point_of_interaction || {};
              const qrB64 = poi?.transaction_data?.qr_code_base64;
              const qrStr = poi?.transaction_data?.qr_code;

              // mostra QR e código
              const qrArea = document.getElementById('pix-qr');
              const codeEl = document.getElementById('pix-code');
              qrArea.innerHTML = qrB64 ? `<img src="data:image/png;base64,${qrB64}" alt="QR Pix">` : '';
              codeEl.value = qrStr || '';

              // (Opcional) pequeno polling para verificar aprovação
              // Em produção, prefira WEBHOOK para confirmação definitiva.
              let tries = 0;
              const maxTries = 30; // ~2min
              const poll = setInterval(async () => {
                tries++;
                try {
                  // Consulta o pagamento pelo ID (precisa expor rota de consulta se quiser real)
                  // Aqui, como protótipo, paramos o polling e avisamos o usuário
                  // ou você pode implementar GET /api/mp/payment/:id
                  if (tries >= maxTries) {
                    clearInterval(poll);
                    document.getElementById('pix-status').textContent =
                      'Pagamento Pix em processamento. Assim que for confirmado, você verá em Minhas Viagens.';
                  }
                } catch (e) {
                  clearInterval(poll);
                }
              }, 4000);

              alert('Gere o pagamento com Pix usando o QR ou copiando o código.');
              return;
            }

            // Outros status (ex.: rejected)
            alert('Status do pagamento: ' + data.status);
          } catch (err) {
            console.error('Pagamento falhou:', err);
            alert('Não foi possível concluir o pagamento. Verifique os dados e tente novamente.');
          }
        },
        onError: (error) => {
          console.error('Brick error:', error);
          alert('Erro no formulário de pagamento. Verifique os dados e tente novamente.');
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
