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

  // ===== >>> NOVOS HELPERS PARA VENDA PRAXIO <<<
  // Monta schedule a partir de um item do carrinho
  function getScheduleFromItem(it) {
    const s = it.schedule || {};
    return {
      idViagem: s.idViagem || s.IdViagem || s.id || s.Id || s.viagemId,
      horaPartida: s.horaPartida || s.departureTime,           // ex.: "1145"
      idOrigem: s.idOrigem || s.IdOrigem || s.originId || s.CodigoOrigem,
      idDestino: s.idDestino || s.IdDestino || s.destinationId || s.CodigoDestino,
      agencia: s.agencia || s.IdEstabelecimento || s.IdEstabelecimentoVenda || '93'
    };
  }

  // Extrai passageiros (nome/cpf/poltrona) do item
  function getPassengersFromItem(it) {
    const pax = [];
    const seats = Array.isArray(it.seats) ? it.seats : [];
    const passengers = Array.isArray(it.passengers) ? it.passengers : [];
    if (passengers.length) {
      for (const p of passengers) {
        pax.push({
          seatNumber: p.seatNumber || p.poltrona || seats[0],
          name: p.name || p.nome || '',
          document: (p.document || p.cpf || '').toString()
        });
      }
    } else {
      for (const seat of seats) {
        pax.push({ seatNumber: seat, name: (user.name || user.email || ''), document: '' });
      }
    }
    return pax;
  }

  // Chama o backend para validar pagamento, vender na Praxio e gerar PDFs
  async function venderPraxioApósAprovado(paymentId) {
    // consolida schedule do primeiro item e junta todos os passageiros da compra
    const first = order[0];
    const schedule = getScheduleFromItem(first);
    let passengers = [];
    order.forEach(it => { passengers = passengers.concat(getPassengersFromItem(it)); });
    const totalAmount = cartTotal();

    const r = await fetch('/api/praxio/vender', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        mpPaymentId: paymentId,
        schedule,
        passengers,
        totalAmount,
        idEstabelecimentoVenda: '1',
        idEstabelecimentoTicket: schedule.agencia || '93',
        serieBloco: '93'
      })
    });
    const j = await r.json();
    if (!j.ok) {
      console.error('Venda Praxio falhou:', j);
      alert('Pagamento aprovado, mas falhou ao emitir bilhete. Nosso suporte foi notificado.');
      return null;
    }
    return j; // { ok:true, venda, arquivos:[{numPassagem, pdf}, ...] }
  }
  // ===== <<< FIM DOS HELPERS NOVOS

  // ===== atualiza storage removendo UM item da lista de não pagas (por índice)
  function removeFromStorageByOpenIndex(openIdx) {
    const all = JSON.parse(localStorage.getItem('bookings') || '[]');
    const paid = all.filter(b => b.paid === true);
    const open = all.filter(b => b.paid !== true);
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
      summaryBodyEl.innerHTML = lines.join('') + `
        <div class="summary-total"><span>Total</span><span>${fmtBRL(total)}</span></div>
      `;
      if (summaryTotalEl) summaryTotalEl.textContent = fmtBRL(total);
    } else if (legacySummaryEl) {
      legacySummaryEl.innerHTML = lines.join('') + `
        <div class="summary-total"><span>Total</span><span>${fmtBRL(total)}</span></div>
      `;
    }

    const container = summaryBodyEl || legacySummaryEl;
    if (container) {
      container.querySelectorAll('.order-item .item-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const wrap = btn.closest('.order-item');
          const openIdx = Number(wrap.getAttribute('data-open-index'));
          order.splice(openIdx, 1);
          removeFromStorageByOpenIndex(openIdx);
          const newTotal = cartTotal();
          renderSummary();
          awaitMountBricks(newTotal);
        });
      });
    }

    if (payBtn) {
      if (order.length) payBtn.removeAttribute('disabled');
      else payBtn.setAttribute('disabled', 'disabled');
    }

    return total;
  }

  // ======= Bricks (controlador para desmontar/montar com novo total)
  let publicKey = '';
  try {
    const r = await fetch('/api/mp/pubkey');
    const j = await r.json();
    publicKey = j.publicKey || '';
  } catch (e) { console.error('Erro /api/mp/pubkey', e); }
  if (!publicKey) { alert('Chave pública do Mercado Pago não configurada.'); return; }

  const mp = new MercadoPago(publicKey, { locale: 'pt-BR' });
  const bricks = mp.bricks();

  const brickContainerId =
    document.getElementById('payment-bricks') ? 'payment-bricks' :
    (document.getElementById('payment-brick-container') ? 'payment-brick-container' : null);

  if (!brickContainerId) {
    console.error('Container do Bricks não encontrado.');
    return;
  }

  let brickController = null;
  let currentTotal = 0;

  async function mountBricks(amount) {
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
              body.payment_method_id = formData.payment_method_id;
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

            // === CARTÃO APROVADO ===
            if (data.status === 'approved') {
              alert('Pagamento aprovado!');
              const venda = await venderPraxioApósAprovado(data.id || data?.payment?.id);

              if (venda && Array.isArray(venda.arquivos) && venda.arquivos.length) {
                const bookings = (JSON.parse(localStorage.getItem('bookings') || '[]') || [])
                  .map(b => ({ ...b, paid: true }));
                localStorage.setItem('bookings', JSON.stringify(bookings));

                localStorage.setItem('lastTickets', JSON.stringify(venda.arquivos));
                location.href = 'profile.html';
              }
              return;
            }

            // === PIX (gera QR, aprovação é posterior) ===
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

  async function awaitMountBricks(total) {
    if (!order.length) {
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
    const all = JSON.parse(localStorage.getItem('bookings') || '[]');
    const paid = all.filter(b => b.paid === true);
    localStorage.setItem('bookings', JSON.stringify(paid));
    order = [];
    renderSummary();
    awaitMountBricks(0);
  });

  payBtn?.addEventListener('click', () => {
    if (!order.length) {
      alert('Seu carrinho está vazio.');
    }
  });
});
