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
  if (bookings.length === 0) {
    document.getElementById('order-summary').textContent = 'Nenhuma reserva encontrada.';
  } else {
    const last = bookings[bookings.length - 1];
    const summary = document.getElementById('order-summary');
    // Mostra resumo de múltiplas poltronas
    const seatList = last.seats ? last.seats.join(', ') : last.seat;
    let passengersHtml = '';
    if (last.passengers && Array.isArray(last.passengers)) {
      passengersHtml = '<p><strong>Passageiros:</strong></p><ul>' +
        last.passengers.map(p => `<li>Poltrona ${p.seatNumber}: ${p.name}</li>`).join('') +
        '</ul>';
    }
    summary.innerHTML = `
      <p><strong>Origem:</strong> ${last.schedule.origin}</p>
      <p><strong>Destino:</strong> ${last.schedule.destination}</p>
      <p><strong>Data:</strong> ${last.schedule.date}</p>
      <p><strong>Saída:</strong> ${last.schedule.departureTime}</p>
      <p><strong>Poltronas:</strong> ${seatList}</p>
      ${passengersHtml}
      <p><strong>Total:</strong> R$ ${last.price.toFixed(2)}</p>
    `;
  }
  const form = document.getElementById('payment-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    // Em um sistema real, aqui tokenizaria o cartão e enviaria ao backend para processar com Mercado Pago
    alert('Pagamento efetuado com sucesso! (simulação)');
    // Marca reserva como paga
    const bookingsArr = JSON.parse(localStorage.getItem('bookings') || '[]');
    if (bookingsArr.length > 0) {
      bookingsArr[bookingsArr.length - 1].paid = true;
      localStorage.setItem('bookings', JSON.stringify(bookingsArr));
    }
    window.location.href = 'profile.html';
  });
  document.getElementById('cancel-btn').addEventListener('click', () => {
    // Cancela reserva e volta para a página inicial
    const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
    if (bookings.length > 0) {
      bookings.pop();
      localStorage.setItem('bookings', JSON.stringify(bookings));
    }
    window.location.href = 'index.html';
  });
});