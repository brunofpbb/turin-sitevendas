// profile.js - mostra reservas do usuário
document.addEventListener('DOMContentLoaded', () => {
  updateUserNav();
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) {
    alert('Você precisa estar logado para ver suas viagens.');
    localStorage.setItem('postLoginRedirect', 'profile.html');
    window.location.href = 'login.html';
    return;
  }
  const bookingList = document.getElementById('booking-list');
  const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
  // Mostra apenas compras finalizadas (pagas)
  const paidBookings = bookings.filter(b => b.paid);
  if (paidBookings.length === 0) {
    bookingList.textContent = 'Nenhuma compra finalizada encontrada.';
  } else {
    paidBookings.forEach((booking, index) => {
      const div = document.createElement('div');
      div.className = 'booking-item';
      const seatList = booking.seats ? booking.seats.join(', ') : booking.seat;
      let passengerListHtml = '';
      if (booking.passengers && Array.isArray(booking.passengers)) {
        passengerListHtml = '<ul>' + booking.passengers.map(p => `<li>Poltrona ${p.seatNumber}: ${p.name}</li>`).join('') + '</ul>';
      }
      div.innerHTML = `
        <p><strong>Origem:</strong> ${booking.schedule.origin}</p>
        <p><strong>Destino:</strong> ${booking.schedule.destination}</p>
        <p><strong>Data:</strong> ${booking.schedule.date}</p>
        <p><strong>Saída:</strong> ${booking.schedule.departureTime}</p>
        <p><strong>Poltronas:</strong> ${seatList}</p>
        ${passengerListHtml}
        <p><strong>Total:</strong> R$ ${booking.price.toFixed(2)}</p>
        <p><strong>Status:</strong> Pago</p>
      `;
      // Botão de cancelamento
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancelar bilhete';
      cancelBtn.style.marginTop = '0.5rem';
      cancelBtn.addEventListener('click', () => {
        // Calcula diferença de horas até o embarque
        const departureDateStr = `${booking.schedule.date}T${booking.schedule.departureTime}`;
        const departureDate = new Date(departureDateStr);
        const now = new Date();
        const diffHours = (departureDate - now) / 36e5;
        if (diffHours < 12) {
          alert('O bilhete só pode ser cancelado com pelo menos 12 horas de antecedência.');
          return;
        }
        if (!confirm('Deseja cancelar este bilhete?')) return;
        // Remove a reserva e salva
        const allBookings = JSON.parse(localStorage.getItem('bookings') || '[]');
        const idx = allBookings.findIndex(b => b.id === booking.id);
        if (idx !== -1) {
          allBookings.splice(idx, 1);
          localStorage.setItem('bookings', JSON.stringify(allBookings));
        }
        // Remove visualmente
        div.remove();
        // Se não houver mais itens, mostra mensagem
        const remainPaid = allBookings.filter(b => b.paid);
        if (remainPaid.length === 0) {
          bookingList.textContent = 'Nenhuma compra finalizada encontrada.';
        }
      });
      div.appendChild(cancelBtn);
      bookingList.appendChild(div);
    });
  }
  document.getElementById('back-btn').addEventListener('click', () => {
    window.location.href = 'index.html';
  });
});