// payment.js — Mercado Pago Payment Brick (crédito, débito e Pix)
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof updateUserNav === 'function') updateUserNav();

  // 1) Checagem de login
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) {
    alert('Você precisa estar logado para pagar.');
    localStorage.setItem('postLoginRedirect', 'payment.html');
    window.location.href = 'login.html';
    return;
  }

  // 2) Carrega o último pedido (resumo)
  const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
  const summary = document.getElementById('order-summary');
  if (!bookings.length) {
    summary.textContent = 'Nenhuma reserva encontrada.';
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

  // 3) Public Key do back
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

  // 4) SDK v2
  const mp = new MercadoPago(publicKey, { locale: 'pt-BR' });
  const bricksBuilder = mp.bricks();

  // 5) Caixa para QR Pix (aparece apenas quando necessário)
  function ensurePixBox() {
    let box = document.getElementById('pix-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'pix-box';
      box.style.marginTop = '16px';
      box.style.padding = '12px';
      box.style.border = '1px solid #ddd';
      box.style.borderRadius = '8px';
      box.innerHTML = `
        <h4>Pagamento via Pix</h4>
        <div id="pix-qr" style="margin:8px 0"></div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="pix-code" type="text" readonly
                 style="flex:1;padding:.5rem;border:1px solid #ccc;border-radius:4px">
          <button id="pix-copy" class="btn btn-ghost" type="button">Copiar código</button>
        </div>
        <p id="pix-status" style="margin-top:8px;color:#555">Aguardando pagamento…</p>
      `;
      const cont = document.getElementById('payment-brick-container');
      cont.parentNode.insertBefore(box, cont.nextSibling);
      document.getElementById('pix-copy').addEventListener('click', () => {
        const el = document.getElementById('pix-code');
        el.select();
        document.execCommand('copy');
        alert('Código Pix copiado.');
      });
    }
    return box;
  }

document.addEventListener('DOMContentLoaded', async () => {
  // 1) pega a public key segura do backend
  const { publicKey } = await fetch('/api/mp/pubkey').then(r => r.json());

  // 2) inicializa SDK e Bricks
  const mp = new MercadoPago(publicKey, { locale: 'pt-BR' });
  const bricksBuilder = mp.bricks();

  // 3) configurações do Brick
  const total = window.__ORDER_TOTAL__ || Number(
    (document.getElementById('totalAmount')?.dataset?.value || '0').replace(',', '.')
  ); // ajuste se já tem o total em outro lugar

  const user = { email: window.__USER_EMAIL__ || '' }; // ajuste se já tem email do usuário

  const settings = {
    initialization: {
      amount: total,
      payer: { email: user.email || '' },
    },
    customization: {
      paymentMethods: {
        creditCard: {
          // força 1x
          maxInstallments: 1,
          installments: { quantity: 1, min: 1, max: 1 },
          visual: { showInstallmentsSelector: false },
        },
        debitCard: 'all',
        bankTransfer: ['pix'], // mantém Pix
      },
      visual: { style: { theme: 'default' } },
    },

    // <<< ÚNICA CHAVE callbacks >>>
    callbacks: {
      onReady: () => console.log('[MP] Brick pronto'),

      onError: (error) => {
        console.error('[MP] Brick error:', error);
        alert('Erro ao carregar o meio de pagamento (ver console).');
      },

      // formData = dados tokenizados do Brick
      onSubmit: async ({ selectedPaymentMethod, formData }) => {
        try {
          console.log('[MP] formData:', formData, 'method:', selectedPaymentMethod);

          // monta payload mínimo para o backend
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

          // limpa CPF (só dígitos)
          if (payload?.payer?.identification?.number) {
            payload.payer.identification.number =
              String(payload.payer.identification.number).replace(/\D/g, '');
          }

          // não enviar campos que não usamos
          delete payload.issuer_id;
          delete payload.paymentMethodId; // 'credit_card' | 'pix'

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

          // sucesso — trate como preferir
          if (data?.order?.status === 'processed' || data?.status === 'approved') {
            alert('Pagamento aprovado! ID: ' + (data?.id || data?.order?.id));
            // TODO: marcar reserva como paga e redirecionar
            // window.location.href = 'profile.html';
          } else if (data?.pix?.qr_text) {
            // Pix pendente — exibir QR
            // TODO: desenhar QR com data.pix.qr_base64 e oferecer cópia
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

  // 4) renderiza o Brick "payment" (cartão + pix)
  await bricksBuilder.create('payment', 'payment_brick_container', settings);
  // certifique-se de ter <div id="payment_brick_container"></div> na página
});
