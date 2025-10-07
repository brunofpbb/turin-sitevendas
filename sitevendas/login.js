// login.js - fluxo de autenticação com envio real de código por email (via backend)

document.addEventListener('DOMContentLoaded', () => {
  if (typeof updateUserNav === 'function') updateUserNav();

  const emailForm   = document.getElementById('email-form');
  const codeForm    = document.getElementById('code-form');
  const stepEmail   = document.getElementById('step-email');
  const stepCode    = document.getElementById('step-code');
  const displayCode = document.getElementById('display-code'); // só aparece em DEV quando backend retorna demoCode
  const emailMask   = document.getElementById('email-mask');
  const emailMsg    = document.getElementById('email-msg');
  const codeMsg     = document.getElementById('code-msg');
  const btnSend     = document.getElementById('btn-send');
  const btnVerify   = document.getElementById('btn-verify');
  const btnResend   = document.getElementById('btn-resend');

  // Helpers
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const sanitizeEmail = (e) => String(e || '').trim();

  function setLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = loading;
    const t = btn.dataset.originalText || btn.textContent;
    if (!btn.dataset.originalText) btn.dataset.originalText = t;
    btn.textContent = loading ? 'Aguarde…' : btn.dataset.originalText;
  }

  async function requestCode(email) {
    setLoading(btnSend, true);
    emailMsg.textContent = '';
    displayCode.textContent = '';
    try {
      const res = await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Falha ao solicitar código.');
      }
      localStorage.setItem('loginVerificationEmail', email);
      // Atualiza UI para etapa de código
      emailMask.textContent = email;
      stepEmail.style.display = 'none';
      stepCode.style.display = 'block';

      // Em desenvolvimento o backend pode mandar demoCode
      if (data.demoCode) {
        displayCode.textContent = `Código para testes: ${data.demoCode}`;
      }
      emailMsg.textContent = 'Código enviado. Verifique sua caixa de entrada e spam.';
    } catch (err) {
      console.error(err);
      emailMsg.textContent = 'Não foi possível enviar o e-mail. Verifique o endereço e tente novamente.';
      alert(err.message || 'Erro ao enviar código.');
    } finally {
      setLoading(btnSend, false);
    }
  }

  async function verifyCode(email, code) {
    setLoading(btnVerify, true);
    codeMsg.textContent = '';
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Código inválido.');
      }

      // Salva sessão simples
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.removeItem('loginVerificationEmail');

      if (typeof updateUserNav === 'function') updateUserNav();

      // Restaura compra pendente (mesma lógica que você já usava)
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

      // Redireciona
      const redirect = localStorage.getItem('postLoginRedirect');
      if (redirect) {
        localStorage.removeItem('postLoginRedirect');
        window.location.href = redirect;
      } else {
        window.location.href = 'index.html';
      }
    } catch (err) {
      console.error(err);
      codeMsg.textContent = err.message || 'Código inválido.';
      await sleep(100);
      alert(err.message || 'Código inválido.');
    } finally {
      setLoading(btnVerify, false);
    }
  }

  // Etapa 1: enviar email
  emailForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = sanitizeEmail(document.getElementById('email').value);
    if (!email) {
      alert('Informe um endereço de e-mail válido.');
      return;
    }
    requestCode(email);
  });

  // Reenviar código na etapa 2
  btnResend.addEventListener('click', () => {
    const email = localStorage.getItem('loginVerificationEmail');
    if (!email) return;
    requestCode(email);
  });

  // Etapa 2: verificar código
  codeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = String(document.getElementById('code').value || '').trim();
    const email = localStorage.getItem('loginVerificationEmail');
    if (!email) {
      alert('Sessão expirada. Solicite o código novamente.');
      stepCode.style.display = 'none';
      stepEmail.style.display = 'block';
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      alert('Digite o código de 6 dígitos.');
      return;
    }
    verifyCode(email, code);
  });
});
