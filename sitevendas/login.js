// login.js - controla fluxo de autenticação via código de verificação
document.addEventListener('DOMContentLoaded', () => {
  updateUserNav();
  const emailForm = document.getElementById('email-form');
  const codeForm = document.getElementById('code-form');
  const stepEmail = document.getElementById('step-email');
  const stepCode = document.getElementById('step-code');
  const displayCode = document.getElementById('display-code');
  // Etapa 1: enviar email (simulado)
  emailForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const emailInput = document.getElementById('email');
    const email = emailInput.value.trim();
    if (!email) {
      alert('Informe um endereço de e-mail válido.');
      return;
    }
    // Gera código de 6 dígitos
    const code = String(Math.floor(100000 + Math.random() * 900000));
    // Armazena código e email para verificação posterior
    localStorage.setItem('loginVerificationEmail', email);
    localStorage.setItem('loginVerificationCode', code);
    // Mostra código para fins de demonstração
    displayCode.textContent = code;
    // Alterna para etapa do código
    stepEmail.style.display = 'none';
    stepCode.style.display = 'block';
  });
  // Etapa 2: verificar código
  codeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const entered = document.getElementById('code').value.trim();
    const storedCode = localStorage.getItem('loginVerificationCode');
    const storedEmail = localStorage.getItem('loginVerificationEmail');
    if (!entered || entered.length !== 6) {
      alert('Digite o código de 6 dígitos enviado para o seu email.');
      return;
    }
    if (entered !== storedCode) {
      alert('Código incorreto. Verifique e tente novamente.');
      return;
    }
    // Código correto: cria/atualiza usuário
    const user = { email: storedEmail };
    localStorage.setItem('user', JSON.stringify(user));
    // Limpa dados temporários
    localStorage.removeItem('loginVerificationCode');
    localStorage.removeItem('loginVerificationEmail');
    updateUserNav();
    // Se houver uma compra pendente salva em localStorage (de seleção de poltronas),
    // cria automaticamente a reserva no histórico antes de redirecionar. Isso
    // garante que o usuário continue a partir de onde parou.
    const pending = JSON.parse(localStorage.getItem('pendingPurchase') || 'null');
    if (pending) {
      const bookings = JSON.parse(localStorage.getItem('bookings') || '[]');
      bookings.push({
        id: Date.now(),
        schedule: pending.schedule,
        seats: pending.seats,
        passengers: pending.passengers,
        price: pending.price,
        date: pending.date,
        paid: false
      });
      localStorage.setItem('bookings', JSON.stringify(bookings));
      localStorage.removeItem('pendingPurchase');
    }
    // Redireciona para a página solicitada ou home
    const redirect = localStorage.getItem('postLoginRedirect');
    if (redirect) {
      localStorage.removeItem('postLoginRedirect');
      window.location.href = redirect;
    } else {
      window.location.href = 'index.html';
    }
  });
});