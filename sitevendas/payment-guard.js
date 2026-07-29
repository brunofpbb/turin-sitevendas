// Bloqueia a tela de pagamento quando o carrinho não possui tarifa válida.
// Remove o antigo comportamento que acabava permitindo pagamento simbólico de R$ 1,00.
(() => {
  function parseMoney(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (value === null || value === undefined || value === '') return 0;

    let text = String(value).trim();
    if (text.includes(',') && text.includes('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(',', '.');
    }

    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function itemTotal(item) {
    const seats = Array.isArray(item?.seats) ? item.seats.length : 0;
    const unit = parseMoney(item?.schedule?.price);
    return unit * seats;
  }

  try {
    let bookings = JSON.parse(localStorage.getItem('bookings') || '[]');

    // Replica a mesclagem feita no payment.js para não bloquear quem acabou de autenticar.
    const pendingJson = localStorage.getItem('pendingPurchase');
    if (pendingJson) {
      const pending = JSON.parse(pendingJson);
      if (pending && Array.isArray(pending.legs) && pending.legs.length > 0) {
        const paidOnly = bookings.filter(item => item?.paid === true);
        bookings = [...paidOnly, ...pending.legs];
        localStorage.setItem('bookings', JSON.stringify(bookings));
        localStorage.removeItem('pendingPurchase');
      }
    }

    const open = bookings.filter(item => item?.paid !== true);
    const invalid = open.length === 0 || open.some(item => itemTotal(item) <= 0);
    const total = open.reduce((sum, item) => sum + itemTotal(item), 0);

    window.__PAYMENT_CART_VALID__ = !invalid && Number.isFinite(total) && total > 0;

    if (!window.__PAYMENT_CART_VALID__) {
      console.error('[Pagamento] Carrinho bloqueado por tarifa inválida:', { open, total });

      // Mantém apenas compras já pagas e elimina carrinhos corrompidos/antigos.
      const paidOnly = bookings.filter(item => item?.paid === true);
      localStorage.setItem('bookings', JSON.stringify(paidOnly));
      localStorage.removeItem('pendingPurchase');

      alert(
        'Não foi possível calcular o valor das passagens. ' +
        'O pagamento foi bloqueado para evitar uma cobrança incorreta. ' +
        'Faça uma nova busca e selecione novamente a viagem.'
      );

      location.replace('index.html');
    }
  } catch (error) {
    window.__PAYMENT_CART_VALID__ = false;
    console.error('[Pagamento] Falha ao validar o carrinho:', error);
    alert('O carrinho está inválido. Faça uma nova busca para continuar.');
    location.replace('index.html');
  }
})();
