/*
// server.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const app = express();

const PUBLIC_DIR = path.join(__dirname, 'sitevendas');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const fs = require('fs');
const fetch = require('node-fetch'); // ok com Node 18
const nodemailer = require('nodemailer');

// >>> só UMA VEZ:
const { MercadoPagoConfig, Payment } = require('mercadopago');
const { v4: uuidv4 } = require('uuid'); 



 =================== CSP compatível com MP Bricks =================== 
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // SDK/Bricks usam inline + new Function
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.mercadopago.com https://wallet.mercadopago.com https://http2.mlstatic.com",
      // XHR/fetch (inclui mlstatic e api-static + todos os *.mercadolibre/mercadolivre)
      "connect-src 'self' https://api.mercadopago.com https://wallet.mercadopago.com https://http2.mlstatic.com https://api-static.mercadopago.com https://api.mercadolibre.com https://*.mercadolibre.com https://*.mercadolivre.com",
      // imagens (QR base64 + assets mlstatic + domínios ML BR/Global)
      "img-src 'self' data: https://*.mercadopago.com https://*.mpago.li https://http2.mlstatic.com https://*.mercadolibre.com https://*.mercadolivre.com",
      // iframes necessários (wallet + secure-fields + possíveis páginas ML)
      "frame-src https://wallet.mercadopago.com https://api.mercadopago.com https://api-static.mercadopago.com https://*.mercadolibre.com https://*.mercadolivre.com",
      // (opcional) compat: alguns navegadores antigos ainda olham child-src
      "child-src https://wallet.mercadopago.com https://api.mercadopago.com https://api-static.mercadopago.com https://*.mercadolibre.com https://*.mercadolivre.com",
      // estilos e fontes
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:"
    ].join('; ')
  );
  next();
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

const PORT = process.env.PORT;

 =================== Static / Health =================== 
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'sitevendas'))
  ? path.join(__dirname, 'sitevendas')
  : __dirname;

app.use(express.static(PUBLIC_DIR));


app.get('/health', (_req, res) => res.json({ ok: true, publicDir: PUBLIC_DIR }));



const mpRoutes = require('./mpRoutes');
app.use('/api/mp', mpRoutes);


*/


// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();

// ----------- Segurança mínima / CSP p/ Bricks -----------
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.mercadopago.com https://wallet.mercadopago.com https://http2.mlstatic.com",
      "connect-src 'self' https://api.mercadopago.com https://wallet.mercadopago.com https://api-static.mercadopago.com https://http2.mlstatic.com https://*.mercadolibre.com https://*.mercadolivre.com",
      "img-src 'self' data: https://*.mercadopago.com https://*.mpago.li https://http2.mlstatic.com https://*.mercadolibre.com https://*.mercadolivre.com",
      "frame-src https://wallet.mercadopago.com https://api.mercadopago.com https://api-static.mercadopago.com https://*.mercadolibre.com https://*.mercadolivre.com",
      "child-src https://wallet.mercadopago.com https://api.mercadopago.com https://api-static.mercadopago.com https://*.mercadolibre.com https://*.mercadolivre.com",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:"
    ].join('; ')
  );
  next();
});

// ----------- Body parser -----------
app.use(express.json());

// ----------- Arquivos estáticos -----------
app.use(express.static(path.join(__dirname, 'sitevendas')));

// ----------- Rotas MP -----------
const mpRoutes = require('./mpRoutes'); // <- este arquivo fica na RAIZ junto com server.js
app.use('/api/mp', mpRoutes);

// ----------- Diagnóstico simples -----------
app.get('/api/_diag', (req, res) => {
  const at = process.env.MP_ACCESS_TOKEN || '';
  res.json({
    has_access_token: Boolean(at),
    access_token_snippet: at ? `${at.slice(0, 6)}...${at.slice(-4)}` : null,
    public_key: process.env.MP_PUBLIC_KEY || null
  });
});

// ----------- SPA fallback p/ arquivos .html -----------
app.get('*', (req, res, next) => {
  // entrega /payment.html, /index.html etc. direto da pasta
  if (req.path.endsWith('.html')) {
    return res.sendFile(path.join(__dirname, 'sitevendas', req.path));
  }
  next();
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[server] rodando em http://localhost:${PORT}`);
});






/* =================== SMTP / Brevo (como estava) =================== */
function createSSL() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: String(SMTP_SECURE || 'true') === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
    family: 4,
    connectionTimeout: 3500,
    greetingTimeout: 3500,
    socketTimeout: 3500,
  });
}
function createSTARTTLS() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: 587,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
    family: 4,
    connectionTimeout: 3500,
    greetingTimeout: 3500,
    socketTimeout: 3500,
  });
}
function verifyWithTimeout(transporter, ms = 3500) {
  return Promise.race([
    transporter.verify().then(() => ({ ok: true })),
    new Promise(r => setTimeout(() => r({ ok: false, error: 'verify-timeout' }), ms + 200)),
  ]).catch(e => ({ ok: false, error: e?.message || String(e) }));
}
async function ensureTransport() {
  let t = createSSL();
  if (t) {
    const r = await verifyWithTimeout(t);
    if (r.ok) return { transporter: t, mode: 'SSL(465)' };
  }
  t = createSTARTTLS();
  if (t) {
    const r = await verifyWithTimeout(t);
    if (r.ok) return { transporter: t, mode: 'STARTTLS(587)' };
    return { transporter: null, mode: null, error: r.error || 'falha STARTTLS' };
  }
  return { transporter: null, mode: null, error: 'vars SMTP ausentes' };
}

app.get('/api/auth/_debug-smtp', async (_req, res) => {
  const sslT = createSSL();
  const stT  = createSTARTTLS();
  const [sslRes, stRes] = await Promise.all([
    sslT ? verifyWithTimeout(sslT) : Promise.resolve({ ok: false, error: 'vars faltando (SSL)' }),
    stT  ? verifyWithTimeout(stT)  : Promise.resolve({ ok: false, error: 'vars faltando (STARTTLS)' }),
  ]);
  res.json({
    host: process.env.SMTP_HOST || null,
    user: !!process.env.SMTP_USER,
    ssl: sslRes,
    starttls: stRes,
  });
});

async function sendViaBrevoApi({ to, subject, html, text, fromEmail, fromName }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY ausente');
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Brevo API ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

app.get('/api/auth/_debug-brevo', async (_req, res) => {
  try {
    const r = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': process.env.BREVO_API_KEY || '' },
    });
    const j = await r.json().catch(() => ({}));
    res.json({ ok: r.ok, status: r.status, company: j.companyName || null, plan: j.planType || null });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

/* =================== Auth: códigos por e-mail (como estava) =================== */
const codes = new Map();
const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 6;

const genCode = () => Math.floor(100000 + Math.random() * 900000).toString();
const normalizeEmail = e => String(e || '').trim().toLowerCase();
console.log(genCode);
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of codes.entries()) if (v.expiresAt <= now) codes.delete(k);
}, 60 * 1000);

app.post('/api/auth/request-code', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'E-mail inválido.' });
    }
    const code = genCode();
    const expiresAt = Date.now() + CODE_TTL_MIN * 60 * 1000;
    codes.set(email, { code, expiresAt, attempts: 0 });

    const appName   = process.env.APP_NAME || 'Turin Transportes';
    const fromName  = process.env.SUPPORT_FROM_NAME || 'Turin Transportes';
    const fromEmail = process.env.SUPPORT_FROM_EMAIL || process.env.SMTP_USER;
    const from      = `"${fromName}" <${fromEmail}>`;

    const html = `
      <div style="font-family:Arial,sans-serif;font-size:16px;color:#222">
        <p>Olá,</p>
        <p>Seu código de acesso ao <b>${appName}</b> é:</p>
        <p style="font-size:28px;letter-spacing:3px;margin:16px 0"><b>${code}</b></p>
        <p>Ele expira em ${CODE_TTL_MIN} minutos.</p>
        <p style="color:#666;font-size:13px">Se não foi você, ignore este e-mail.</p>
      </div>
    `;
    const text = `Seu código é: ${code} (expira em ${CODE_TTL_MIN} minutos).`;

    let via;
    try {
      const got = await ensureTransport();
      if (!got.transporter) throw new Error('smtp-indisponivel');
      await got.transporter.sendMail({
        from, to: email, replyTo: fromEmail,
        subject: `Seu código de acesso (${appName})`,
        html, text,
      });
      via = got.mode || 'SMTP';
    } catch {
      await sendViaBrevoApi({ to: email, subject: `Seu código de acesso (${appName})`, html, text, fromEmail, fromName });
      via = 'Brevo API';
    }

    const devPayload = process.env.NODE_ENV !== 'production' ? { demoCode: code } : {};
    return res.json({ ok: true, message: `Código enviado via ${via}.`, ...devPayload });

  } catch (err) {
    console.error('Erro ao preparar/envio do e-mail:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'Falha ao enviar e-mail.' });
  }
});

app.post('/api/auth/verify-code', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || '');
  if (!email || !code) return res.status(400).json({ ok: false, error: 'E-mail e código são obrigatórios.' });

  const entry = codes.get(email);
  if (!entry) return res.status(400).json({ ok: false, error: 'Solicite um novo código.' });
  if (entry.expiresAt < Date.now()) { codes.delete(email); return res.status(400).json({ ok: false, error: 'Código expirado. Solicite outro.' }); }
  if (entry.attempts >= MAX_ATTEMPTS) { codes.delete(email); return res.status(400).json({ ok: false, error: 'Muitas tentativas. Solicite outro código.' }); }

  entry.attempts += 1;
  if (entry.code !== code) return res.status(400).json({ ok: false, error: 'Código incorreto.' });

  codes.delete(email);
  const user = { email, name: email.split('@')[0], createdAt: new Date().toISOString() };
  res.json({ ok: true, user });
});

/* =================== Praxio (como estava) =================== */
app.post('/api/partidas', async (req, res) => {
  try {
    const { origemId, destinoId, data } = req.body;

    const loginResp = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Login/efetualogin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Nome: process.env.PRAXIO_USER,
        Senha: process.env.PRAXIO_PASS,
        Sistema: 'WINVR.EXE',
        TipoBD: 0,
        Empresa: process.env.PRAXIO_EMP,
        Cliente: process.env.PRAXIO_CLIENT,
        TipoAplicacao: 0,
      }),
    });
    const loginData = await loginResp.json();

    const partResp = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Partidas/Partidas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        IdSessaoOp: loginData.IdSessaoOp,
        LocalidadeOrigem: origemId,
        LocalidadeDestino: destinoId,
        DataPartida: data,
        SugestaoPassagem: '1',
        ListarTodas: '1',
        SomenteExtra: '0',
        TempoPartida: 1,
        IdEstabelecimento: '1',
        DescontoAutomatico: 0,
      }),
    });
    const partData = await partResp.json();
    res.json(partData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar partidas' });
  }
});

app.post('/api/poltronas', async (req, res) => {
  try {
    const { idViagem, idTipoVeiculo, idLocOrigem, idLocDestino } = req.body;

    const loginResp = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Login/efetualogin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Nome: process.env.PRAXIO_USER,
        Senha: process.env.PRAXIO_PASS,
        Sistema: 'WINVR.EXE',
        TipoBD: 0,
        Empresa: process.env.PRAXIO_EMP,
        Cliente: process.env.PRAXIO_CLIENT,
        TipoAplicacao: 0,
      }),
    });
    const loginData = await loginResp.json();

    const seatResp = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Poltrona/RetornaPoltronas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        IdSessaoOp: loginData.IdSessaoOp,
        IdViagem: idViagem,
        IdTipoVeiculo: idTipoVeiculo,
        IdLocOrigem: idLocOrigem,
        IdLocdestino: idLocDestino,
        VerificarSugestao: 1,
      }),
    });
    const seatData = await seatResp.json();
    res.json(seatData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao consultar poltronas' });
  }
});

/* =================== SPA fallback (deixa por último!) =================== */
app.get('*', (_req, res) => {
  const indexPath = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))
    ? path.join(PUBLIC_DIR, 'index.html')
    : path.join(__dirname, 'index.html');
  res.sendFile(indexPath);
});

/* =================== Start =================== */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT} | publicDir: ${PUBLIC_DIR}`);
});
process.on('unhandledRejection', r => console.error('UnhandledRejection:', r));
process.on('uncaughtException', e => console.error('UncaughtException:', e));
