// payment.js — Resumo com remoção de itens + total dinâmico + Bricks (Payments API, sem preferência)
document.addEventListener('DOMContentLoaded', async () => {
  // ——— login obrigatório
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) {
    localStorage.setItem('postLoginRedirect', 'payment.html');
    location.href = 'login.html';
    return;
  }
  if (typeof updateUserNav === 'function') updateUserNav();

  // ——— atachos de DOM (funciona com layout novo e antigo)
  const summaryBodyEl = document.getElementById('summary-body');      // lista (layout novo)
  const summaryTotalEl = document.getElementById('summary-total');    // total (layout novo)
  const legacySummaryEl = document.getElementById('order-summary');   // layout antigo (um container só)
  const payBtn = document.getElementById('pay-button');
  const cancelBtn = document.getElementById('btn-cancel') || document.getElementById('cancel-order');

  // garante visual do botão pagar = botão pesquisar
  if (payBtn) payBtn.className = 'btn btn-primary';

  // ——— utils
  const fmtBRL = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '') ?? '';
  const formatDateBR = (iso) => {
    if (typeof iso !== 'string' || !iso.includes('-')) return iso || '';
    const [y, m, d] = iso.split('-');
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  };

  // ——— lê carrinho (somente itens NÃO pagos)
  function readCart() {
    const b = JSON.parse(localStorage.getItem('bookings') || '[]');
    const open = b.filter(x => x.paid !== true);
    if (open.length) return open;
    const p = JSON.parse(localStorage.getItem('pendingPurchase') || 'null');
    return p && Array.isArray(p.legs) ? p.legs : [];
  }
  let order = readCart();

  // ===== helpers de valores
  const itemSubtotal = (it) => {
    const s = it.schedule || {};
    const unit = Number(String(s.price || 0).replace(',', '.')) || 0;
    return unit * ((it.seats || []).length || 0);
  };
  const cartTotal = () => order.reduce((acc, it) => acc + itemSubtotal(it), 0);

  // ===== atualiza storage removendo UM item da lista de não pagas (por índice)
  function removeFromStorageByOpenIndex(openIdx) {
    const all = JSON.parse(localStorage.getItem('bookings') || '[]');
    const paid = all.filter(b => b.paid === true);
    const open = all.filter(b => b.paid !== true);
    // remove exatamente o índice solicitado (se existir)
    if (openIdx >= 0 && openIdx < open.length) {
      open.splice(openIdx, 1);
    }
    localStorage.setItem('bookings', JSON.stringify([...paid, ...open]));
  }

  // ===== render do resumo (dois modos)
  function renderSummary() {
    const lines = [];
    let total = 0;

    order.forEach((it, idx) => {
      const s = it.schedule || {};
      const origem = pick(s.originName, s.origin, s.origem, '—');
      const destino = pick(s.destinationName, s.destination, s.destino, '—');
      const dataV = formatDateBR(s.date);
      const hora = pick(s.departureTime, s.horaPartida, '—');
      const seats = (it.seats || []).join(', ');
      const paxList = Array.isArray(it.passengers) ? it.passengers.map(p => `Pol ${p.seatNumber}: ${p.name}`) : [];
      const sub = itemSubtotal(it);
      total += sub;

      // classes esperadas pelo CSS: .order-item, .item-remove, .title, .meta, .price
      lines.push(`
        <div class="order-item" data-open-index="${idx}">
          <button class="item-remove" title="Remover" aria-label="Remover">×</button>
          <div class="title">
            <span>${origem} → ${destino}</span>
            <span class="price">${fmtBRL(sub)}</span>
          </div>
          <div class="meta">
            ${dataV} • ${hora} • Poltronas: ${seats || '—'}
            ${paxList.length ? `<br/>Passageiros: ${paxList.join(', ')}` : ''}
          </div>
        </div>
      `);
    });

    if (summaryBodyEl) {
      // layout novo
      summaryBodyEl.innerHTML = lines.join('') + `
        <div class="summary-total"><span>Total</span><span>${fmtBRL(total)}</span></div>
      `;
      if (summaryTotalEl) summaryTotalEl.textContent = fmtBRL(total);
    } else if (legacySummaryEl) {
      // layout antigo (um container único)
      legacySummaryEl.innerHTML = lines.join('') + `
        <div class="summary-total"><span>Total</span><span>${fmtBRL(total)}</span></div>
      `;
    }

    // Bind de remoção (X)
    const container = summaryBodyEl || legacySummaryEl;
    if (container) {
      container.querySelectorAll('.order-item .item-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const wrap = btn.closest('.order-item');
          const openIdx = Number(wrap.getAttribute('data-open-index'));
          // remove do estado e do storage
          order.splice(openIdx, 1);
          removeFromStorageByOpenIndex(openIdx);
          // re-render + atualizar bricks
          const newTotal = cartTotal();
          renderSummary();
          awaitMountBricks(newTotal);
        });
      });
    }

    // habilita/desabilita botão pagar
    if (payBtn) {
      if (order.length) payBtn.removeAttribute('disabled');
      else payBtn.setAttribute('disabled', 'disabled');
    }

    return total;
  }

  // ======= Bricks (controlador para desmontar/montar com novo total)
  // carrega public key
  let publicKey = '';
  try {
    const r = await fetch('/api/mp/pubkey');
    const j = await r.json();
    publicKey = j.publicKey || '';
  } catch (e) { console.error('Erro /api/mp/pubkey', e); }
  if (!publicKey) { alert('Chave pública do Mercado Pago não configurada.'); return; }

  // cria SDK
  const mp = new MercadoPago(publicKey, { locale: 'pt-BR' });
  const bricks = mp.bricks();

  const brickContainerId =
    document.getElementById('payment-bricks') ? 'payment-bricks' :
    (document.getElementById('payment-brick-container') ? 'payment-brick-container' : null);

  if (!brickContainerId) {
    console.error('Container do Bricks não encontrado.');
    return;
  }

  let brickController = null;       // referência do brick para unmount
  let currentTotal = 0;             // total atual usado no submit

  async function mountBricks(amount) {
    // desmonta anterior
    try { await brickController?.unmount?.(); } catch(_) {}

    currentTotal = Number((amount || 0).toFixed(2));

    brickController = await bricks.create('payment', brickContainerId, {
      initialization: {
        amount: currentTotal,
        payer: { email: user.email || '' }
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
        onError: (e) => { console.error('[MP] Brick error:', e); alert('Erro ao iniciar o pagamento.'); },
        onSubmit: async ({ selectedPaymentMethod, formData }) => {
          try {
            // usa SEMPRE o currentTotal
            const method = String(selectedPaymentMethod || '').toLowerCase();
            const isPix = method === 'bank_transfer' ||
                          String(formData?.payment_method_id || '').toLowerCase() === 'pix';

            const body = {
              transaction_amount: currentTotal,
              description: 'Compra Turin Transportes',
              payer: {
                email: user.email || '',
                identification: formData?.payer?.identification ? {
                  type: formData.payer.identification.type || 'CPF',
                  number: String(formData.payer.identification.number || '').replace(/\D/g, '')
                } : undefined
              }
            };

            if (isPix) {
              body.payment_method_id = 'pix';
            } else {
              if (!formData?.token) { alert('Não foi possível tokenizar o cartão.'); return; }
              body.token = formData.token;
              body.payment_method_id = formData.payment_method_id; // ex.: 'visa'
              body.installments = 1;
              if (formData.issuer_id) body.issuer_id = formData.issuer_id;
            }

            Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
            if (body.payer && body.payer.identification === undefined) delete body.payer.identification;

            const resp = await fetch('/api/mp/pay', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            const data = await resp.json();

            if (!resp.ok) throw new Error(data?.message || 'Falha ao processar pagamento');

            if (data.status === 'approved') {
              // marca TODAS as não pagas como pagas e vai para profile
              const bookings = JSON.parse(localStorage.getItem('bookings') || '[]')
                .map(b => ({ ...b, paid: true }));
              localStorage.setItem('bookings', JSON.stringify(bookings));
              alert('Pagamento aprovado!');
              location.href = 'profile.html';
              return;
            }

            const pix = data?.point_of_interaction?.transaction_data;
            if (pix?.qr_code || pix?.qr_code_base64 || pix?.qr_text) {
              alert('Pix gerado! Conclua o pagamento no seu banco.');
              return;
            }

            if (data?.id && data?.status === 'in_process') {
              alert('Pagamento em análise. Acompanhe em Minhas viagens.');
              return;
            }

            alert(`Pagamento: ${data.status} - ${data.status_detail || ''}`);
          } catch (err) {
            console.error('Pagamento falhou:', err);
            alert('Pagamento falhou: ' + (err?.message || 'erro'));
          }
        }
      }
    });
  }

  // função wrapper que lida com carrinho vazio
  async function awaitMountBricks(total) {
    if (!order.length) {
      // carrinho vazio: desmonta e mostra aviso
      try { await brickController?.unmount?.(); } catch(_) {}
      const container = document.getElementById(brickContainerId);
      if (container) container.innerHTML = '<p class="mute">Seu carrinho está vazio.</p>';
      return;
    }
    await mountBricks(total);
  }

  // ===== Inicializa resumo + bricks
  const firstTotal = renderSummary();
  await awaitMountBricks(firstTotal);

  // ===== Botões gerais
  cancelBtn?.addEventListener('click', () => {
    const ok = confirm('Cancelar este pedido? Os itens do carrinho serão removidos.');
    if (!ok) return;
    // limpa não pagas do storage e do estado
    const all = JSON.parse(localStorage.getItem('bookings') || '[]');
    const paid = all.filter(b => b.paid === true);
    localStorage.setItem('bookings', JSON.stringify(paid));
    order = [];
    renderSummary();
    awaitMountBricks(0);
    // opcional: voltar para home
    // location.href = 'index.html';
  });

  // (opcional) botão pagar via click direto — o bricks já cuida via onSubmit,
  // mas mantemos um guard aqui para UX:
  payBtn?.addEventListener('click', () => {
    if (!order.length) {
      alert('Seu carrinho está vazio.');
    }
  });
});
