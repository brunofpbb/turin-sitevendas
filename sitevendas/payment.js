// payment.js - simula pagamento e finaliza reserva
document.addEventListener('DOMContentLoaded', () => {
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
  } else {
    const last = bookings[bookings.length - 1];

    // Helpers
    const pick = (...keys) =>
      keys.find(v => v !== undefined && v !== null && v !== '') ?? '';

    const formatDateBR = (iso) => {
      // espera "YYYY-MM-DD"
      if (typeof iso !== 'string' || !iso.includes('-')) return iso || '';
      const [y, m, d] = iso.split('-');
      return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
    };

    // Origem/Destino com todos os fallbacks usados nas outras telas
    const origem  = pick(last?.schedule?.originName, last?.schedule?.origin, last?.schedule?.origem, '—');
    const destino = pick(last?.schedule?.destinationName, last?.schedule?.destination, last?.schedule?.destino, '—');

    const dataViagem = formatDateBR(last?.schedule?.date);
    const hora       = pick(last?.schedule?.departureTime, last?.schedule?.horaPartida, '—');
    const seatList   = Array.isArray(last?.seats) ? last.seats.join(', ') : (last?.seat ?? '');

    let passengersHtml = '';
    if (Array.isArray(last?.passengers)) {
      passengersHtml = '<p><strong>Passageiros:</strong></p><ul>' +
        last.passengers.map(p => `<li>Poltrona ${p.seatNumber}: ${p.name}</li>`).join('') +
        '</ul>';
    }

    const totalBRL = (Number(last?.price) || 0).toFixed(2).replace('.', ',');

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
  }

  const form = document.getElementById('payment-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    // Em produção: tokenizar cartão e enviar ao backend para processar (ex: Mercado Pago)
    alert('Pagamento efetuado com sucesso! (simulação)');

    // Marca última reserva como paga
    const bookingsArr = JSON.parse(localStorage.getItem('bookings') || '[]');
    if (bookingsArr.length > 0) {
      bookingsArr[bookingsArr.length - 1].paid = true;
      localStorage.setItem('bookings', JSON.stringify(bookingsArr));
    }
    window.location.href = 'profile.html';
  });

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
