// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const { uploadPdfToDrive } = require('./drive');

// === serviços de bilhete (PDF) ===
const { mapVendaToTicket } = require('./services/ticket/mapper');
const { generateTicketPdf } = require('./services/ticket/pdf');

const app = express();
const PUBLIC_DIR  = path.join(__dirname, 'sitevendas');
const TICKETS_DIR = path.join(__dirname, 'tickets');
const PORT = process.env.PORT || 8080;

/* ============================================================================
   Agrupador de e-mail + webhook por compra (in-memory)
   - Junta múltiplos requests da MESMA compra (ex.: 2 poltronas)
   - Dispara 1 e-mail (com todos os anexos) e 1 webhook (com todos os bilhetes)
============================================================================ */
// ==== Agrupador por compra (in-memory) ====
// groupId -> { timer, base, bilhetes:[], arquivos:[], email:{to,html,text,attachments}, flushed }
const AGGR = new Map();
const AGGR_DEBOUNCE_MS = 1200;

function computeGroupId(req, payment, schedule) {
  // Tente sempre usar o id do pagamento. Se não houver, caia para referencia/grupoId etc.
  return String(
    payment?.id ||
    req?.body?.grupoId ||
    req?.body?.referencia ||
    payment?.external_reference ||
    req?.headers?.['x-idempotency-key'] ||
    [schedule?.idViagem, schedule?.date || schedule?.dataViagem, schedule?.horaPartida].join('|')
  );
}

// Insere/atualiza o agregado e arma o flush
async function queueUnifiedSend(groupId, fragment, hookUrl) {
  let e = AGGR.get(groupId);
  if (!e) e = { timer: null, base: null, bilhetes: [], arquivos: [], email: null, flushed: false };

  // guarda a base uma única vez
  if (!e.base && fragment.base) e.base = fragment.base;

  // acumula bilhetes e arquivos
  if (Array.isArray(fragment.bilhetes) && fragment.bilhetes.length) e.bilhetes.push(...fragment.bilhetes);
  if (Array.isArray(fragment.arquivos) && fragment.arquivos.length) e.arquivos.push(...fragment.arquivos);

  // se chegou pacote de e-mail, mantenha o “melhor” (normalmente o último sobrescreve)
  if (fragment.email) e.email = fragment.email;

  // rearmar o debounce
  if (e.timer) clearTimeout(e.timer);
  e.timer = setTimeout(async () => {
    try {
      // 1) webhook único
      const payload = { ...e.base, bilhetes: e.bilhetes, arquivos: e.arquivos };
      const resp = await fetch(hookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-source': 'sitevendas' },
        body: JSON.stringify(payload),
      });
      console.log('[AGGR] webhook status=', resp.status, '| groupId=', groupId, '| itens=', e.bilhetes.length);

      // 2) e-mail único (se houver “to”)
      if (e.email?.to) {
        let sent = false;
        try {
          const got = await ensureTransport();
          if (got.transporter) {
            await got.transporter.sendMail({
              from: `"${e.email.fromName}" <${e.email.fromEmail}>`,
              to: e.email.to,
              subject: e.email.subject,
              html: e.email.html,
              text: e.email.text,
              attachments: (e.email.attachments || []).map(a => ({ filename: a.filename, content: a.buffer })),
            });
            sent = true;
            console.log('[AGGR] email via SMTP para', e.email.to, '| anexos=', (e.email.attachments||[]).length);
          }
        } catch (err) {
          console.warn('[AGGR] SMTP falhou, caindo p/ Brevo:', err?.message || err);
        }
        if (!sent) {
          await sendViaBrevoApi({
            to: e.email.to,
            subject: e.email.subject,
            html: e.email.html,
            text: e.email.text,
            fromEmail: e.email.fromEmail,
            fromName: e.email.fromName,
            attachments: (e.email.attachments || []).map(a => ({ filename: a.filename, contentBase64: a.contentBase64 })),
          });
          console.log('[AGGR] email via Brevo para', e.email.to, '| anexos=', (e.email.attachments||[]).length);
        }
      }
    } catch (err) {
      console.error('[AGGR] flush erro:', err?.message || err);
    } finally {
      e.flushed = true;
      AGGR.delete(groupId);
    }
  }, AGGR_DEBOUNCE_MS);

  AGGR.set(groupId, e);
  return e;
}


/* ============================================================================
   Google Sheets (consulta por email) – leitura (mantido)
============================================================================ */
const { google } = require('googleapis');

async function sheetsAuth() {
  const key = JSON.parse(process.env.GDRIVE_SA_KEY || '{}');
  const auth = new google.auth.JWT(
    key.client_email, null, key.private_key,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
  return google.sheets({ version: 'v4', auth });
}

// normaliza texto: minúsculo, sem acento e sem sinais
const norm = s => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]/gi, '').toLowerCase();

app.get('/api/sheets/bpe-by-email', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ ok:false, error:'email é obrigatório' });

    const sheets = await sheetsAuth();
    const spreadsheetId = process.env.SHEETS_BPE_ID;
    const range = process.env.SHEETS_BPE_RANGE || 'BPE!A:AF';

    const r = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = r.data.values || [];
    if (!rows.length) return res.json({ ok:true, items:[] });

    const headerRaw = rows[0].map(h => (h || '').toString().trim());
    const header = headerRaw.map(norm);

    const idxOf = (...names) => {
      const want = names.map(norm);
      return header.findIndex(h => want.includes(h));
    };
    const get = (row, idx) => (idx >= 0 && row[idx] != null) ? String(row[idx]).trim() : '';

    // índices necessárias
    const idxEmail      = idxOf('email', 'e-mail');
    const idxNum        = idxOf('numpassagem', 'bilhete');
    const idxSerie      = idxOf('seriepassagem');
    const idxStatusPay  = idxOf('statuspagamento');
    const idxStatus     = idxOf('status');
    const idxValor      = idxOf('valor');
    const idxValorConv  = idxOf('valorconveniencia');
    const idxValorDev   = idxOf('valordevolucao');
    const idxDataPgto   = idxOf('datahorapagamento', 'datahora_pagamento');
    const idxDataViagem = idxOf('dataviagem', 'data_viagem');
    const idxDataHora   = idxOf('datahora', 'data_hora');
    const idxOrigem     = idxOf('origem');
    const idxDestino    = idxOf('destino');
    const idxSentido    = idxOf('sentido');
    const idxCpf        = idxOf('cpf');
    const idxNumTrans   = idxOf('idtransacao', 'id_transacao', 'idtransação', 'id_transação');
    const idxTipoPgto   = idxOf('tipopagamento');
    const idxRef        = idxOf('referencia');
    const idxIdUser     = idxOf('iduser');
    const idxLinkBPE    = idxOf('linkbpe');
    const idxIdUrl      = idxOf('idurl');
    const idxpoltrona   = idxOf('poltrona');
    const idxNome       = idxOf('nome');

    if (idxEmail < 0) return res.json({ ok:true, items:[] });

    const items = rows.slice(1)
      .filter(r => get(r, idxEmail).toLowerCase() === email)
      .map(r => {
        const dataHora = get(r, idxDataHora);
        const departureTime = dataHora.includes(' ')
          ? dataHora.split(' ')[1]
          : '';
        const price = get(r, idxValor).replace(',', '.');

        return {
          name:              get(r, idxNome),
          email,
          ticketNumber:      get(r, idxNum),
          serie:             get(r, idxSerie),
          statusPagamento:   get(r, idxStatusPay),
          status:            get(r, idxStatus),
          price:             price ? Number(price) : 0,
          valorConveniencia: get(r, idxValorConv),
          valorDevolucao:    get(r, idxValorDev),
          paidAt:            get(r, idxDataPgto),
          origin:            get(r, idxOrigem),
          destination:       get(r, idxDestino),
          date:              get(r, idxDataViagem),
          dateTime:          dataHora,
          departureTime,
          sentido:           get(r, idxSentido),
          cpf:               get(r, idxCpf),
          transactionId:     get(r, idxNumTrans),
          paymentType:       get(r, idxTipoPgto),
          referencia:        get(r, idxRef),
          idUser:            get(r, idxIdUser),
          driveUrl:          get(r, idxLinkBPE) || get(r, idxIdUrl),
          poltrona:          get(r, idxpoltrona)
        };
      });

    res.json({ ok:true, items });
  } catch (e) {
    console.error('[sheets] read error', e);
    res.status(500).json({ ok:false, error:'sheets_read_failed' });
  }
});

/* ============================================================================
   Descobrir e-mail do cliente (prioriza login, inclui body.userEmail)
============================================================================ */
function pickBuyerEmail({ req, payment, vendaResult, fallback }) {
  const isMail = (v) => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
  const fromLogin =
    req?.user?.email ||
    req?.session?.user?.email ||
    req?.headers?.['x-user-email'] ||
    req?.body?.loginEmail ||
    req?.body?.emailLogin ||
    req?.body?.userEmail ||      // legado
    req?.body?.user?.email;      // legado

  if (isMail(fromLogin)) return String(fromLogin).trim();

  const fromMP = payment?.payer?.email || payment?.additional_info?.payer?.email;
  if (isMail(fromMP)) return String(fromMP).trim();

  const fromReq = req?.body?.email || req?.body?.buyerEmail || req?.body?.clienteEmail;
  if (isMail(fromReq)) return String(fromReq).trim();

  const fromVenda = vendaResult?.Email || vendaResult?.EmailCliente;
  if (isMail(fromVenda)) return String(fromVenda).trim();

  return fallback || null;
}

/* =================== CSP (Bricks) =================== */
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.mercadopago.com https://wallet.mercadopago.com https://http2.mlstatic.com",
      "connect-src 'self' https://api.mercadopago.com https://wallet.mercadopago.com https://http2.mlstatic.com https://api-static.mercadopago.com https://api.mercadolibre.com https://*.mercadolibre.com https://*.mercadolivre.com",
      "img-src 'self' data: https://*.mercadopago.com https://*.mpago.li https://http2.mlstatic.com https://*.mercadolibre.com https://*.mercadolivre.com",
      "frame-src https://wallet.mercadopago.com https://api.mercadopago.com https://api-static.mercadopago.com https://*.mercadolibre.com https://*.mercadolivre.com",
      "child-src https://wallet.mercadopago.com https://api.mercadopago.com https://api-static.mercadopago.com https://*.mercadolibre.com https://*.mercadolivre.com",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:"
    ].join('; ')
  );
  next();
});

/* =================== Middlewares =================== */
app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/img', express.static(path.join(__dirname, 'img')));

// servir PDFs
if (!fs.existsSync(TICKETS_DIR)) fs.mkdirSync(TICKETS_DIR);
app.use('/tickets', express.static(TICKETS_DIR, { maxAge: '7d', index: false }));

/* =================== Rotas Mercado Pago existentes =================== */
const mpRoutes = require('./mpRoutes');
app.use('/api/mp', mpRoutes);

// diagnóstico rápido
app.get('/api/_diag', (_req, res) => {
  const at = process.env.MP_ACCESS_TOKEN || '';
  res.json({
    has_access_token: Boolean(at),
    access_token_snippet: at ? `${at.slice(0, 6)}...${at.slice(-4)}` : null,
    public_key: process.env.MP_PUBLIC_KEY || null
  });
});

/* =================== SMTP / Brevo =================== */
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

// === Brevo API (primário) ===
async function sendViaBrevoApi({ to, subject, html, text, fromEmail, fromName, attachments = [] }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY ausente');

  const brevoAttachments = (attachments || []).map(a => ({
    name: a.filename || 'anexo.pdf',
    content: a.contentBase64 || a.content || ''
  }));

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
      attachment: brevoAttachments.length ? brevoAttachments : undefined,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Brevo API ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

/* =================== Auth: códigos por e-mail =================== */
const codes = new Map();
const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 6;
const genCode = () => Math.floor(100000 + Math.random() * 900000).toString();
const normalizeEmail = e => String(e || '').trim().toLowerCase();

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

    try {
      const got = await ensureTransport();
      if (!got.transporter) throw new Error('smtp-indisponivel');
      await got.transporter.sendMail({
        from, to: email, replyTo: fromEmail,
        subject: `Seu código de acesso (${appName})`,
        html, text,
      });
    } catch {
      await sendViaBrevoApi({ to: email, subject: `Seu código de acesso (${appName})`, html, text, fromEmail, fromName });
    }

    const devPayload = process.env.NODE_ENV !== 'production' ? { demoCode: code } : {};
    return res.json({ ok: true, message: 'Código enviado.', ...devPayload });

  } catch (err) {
    console.error('Erro ao enviar e-mail:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'Falha ao enviar e-mail.' });
  }
});

app.post('/api/auth/verify-code', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || '');
  if (!email || !code) return res.status(400).json({ ok: false, error: 'E-mail e código são obrigatórios.' });

  const entry = codes.get(email);
  if (!entry) return res.status(400).json({ ok: false, error: 'Solicite um novo código.' });
  if (entry.expiresAt < Date.now()) { codes.delete(email); return res.status(400).json({ ok: false, error: 'Código expirado.' }); }
  if (entry.attempts >= MAX_ATTEMPTS) { codes.delete(email); return res.status(400).json({ ok: false, error: 'Muitas tentativas.' }); }

  entry.attempts += 1;
  if (entry.code !== code) return res.status(400).json({ ok: false, error: 'Código incorreto.' });

  codes.delete(email);
  const user = { email, name: email.split('@')[0], createdAt: new Date().toISOString() };
  res.json({ ok: true, user });
});

/* =================== Praxio helpers =================== */
function normalizeHoraPartida(h) {
  if (!h) return '';
  let s = String(h).replace(/\D/g, '');
  if (s.length === 3) s = '0' + s;
  if (s.length >= 4) s = s.slice(0, 4);
  return s;
}

async function praxioLogin() {
  const resp = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Login/efetualogin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
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
  if (!resp.ok) throw new Error(`Praxio login ${resp.status}`);
  const j = await resp.json();
  if (!j?.IdSessaoOp) throw new Error('Praxio sem IdSessaoOp');
  return j.IdSessaoOp;
}

async function praxioVendaPassagem(bodyVenda) {
  const resp = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/VendaPassagem/VendaPassagem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyVenda),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data?.Sucesso === false) {
    const msg = data?.Mensagem || data?.MensagemDetalhada || `HTTP ${resp.status}`;
    throw new Error(`Falha VendaPassagem: ${msg}`);
  }
  return data;
}

// Data com offset -03:00 (ex.: 2025-10-17T22:12:24-03:00)
function nowWithTZOffsetISO(offsetMinutes = -(3 * 60)) {
  const now = new Date();
  const tzNow = new Date(now.getTime() + (offsetMinutes + now.getTimezoneOffset()) * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  const y = tzNow.getFullYear();
  const m = pad(tzNow.getMonth() + 1);
  const d = pad(tzNow.getDate());
  const hh = pad(tzNow.getHours());
  const mm = pad(tzNow.getMinutes());
  const ss = pad(tzNow.getSeconds());
  const sign = offsetMinutes <= 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const oh = pad(Math.floor(abs / 60));
  const om = pad(abs % 60);
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}${sign}${oh}:${om}`;
}

/* =================== Partidas/Poltronas =================== */
app.post('/api/partidas', async (req, res) => {
  try {
    const { origemId, destinoId, data } = req.body;
    const IdSessaoOp = await praxioLogin();

    const partResp = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Partidas/Partidas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        IdSessaoOp,
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
    const IdSessaoOp = await praxioLogin();

    const seatResp = await fetch('https://oci-parceiros2.praxioluna.com.br/Autumn/Poltrona/RetornaPoltronas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        IdSessaoOp,
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

/* =================== Render manual de ticket (debug) =================== */
app.post('/api/ticket/render', async (req, res) => {
  try {
    const vendaRoot = req.body;
    const ticket = mapVendaToTicket(vendaRoot);
    const subDir = new Date().toISOString().slice(0,10);
    const outDir = path.join(TICKETS_DIR, subDir);
    const pdf = await generateTicketPdf(ticket, outDir);
    const pdfUrl = `/tickets/${subDir}/${pdf.filename}`;
    res.json({ ok: true, files: { pdf: pdfUrl }, ticket: {
      nome: ticket.nomeCliente, numPassagem: ticket.numPassagem, poltrona: ticket.poltrona,
      data: ticket.dataViagem, hora: ticket.horaPartida, origem: ticket.origem, destino: ticket.destino
    }});
  } catch (e) {
    console.error('ticket/render error:', e);
    res.status(400).json({ ok:false, error: e.message || 'Falha ao gerar bilhete' });
  }
});

/* =================== Webhook MP (somente log) =================== */
app.post('/api/mp/webhook', async (req, res) => {
  res.status(200).json({ received: true });
  try {
    const { type, data } = req.body || {};
    console.log('[MP webhook] type:', type, 'id:', data?.id);
  } catch (err) {
    console.error('[MP webhook] erro:', err?.message || err);
  }
});

/* =================== Venda Praxio + PDF + e-mail + Webhook agrupado =================== */
app.post('/api/praxio/vender', async (req, res) => {
  try {
    const {
      mpPaymentId,                 // MP payment id
      schedule,                    // { idViagem, horaPartida, idOrigem, idDestino, ... }
      passengers,                  // [{ seatNumber, name, document }]
      totalAmount,                 // valor total
      idEstabelecimentoVenda = '1',
      idEstabelecimentoTicket = '93',
      serieBloco = '93',
      userEmail = '',
      userPhone = '',
      idaVolta = 'ida'
    } = req.body || {};

    // 1) Revalida o pagamento
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    const payment = await r.json();
    if (!r.ok || !['approved','accredited'].includes(payment?.status)) {
      return res.status(400).json({ ok:false, error:'Pagamento não está aprovado.' });
    }

    const mpAmount = Number(payment.transaction_amount || 0);
    if (totalAmount && Number(totalAmount) > mpAmount + 0.01) {
      return res.status(400).json({ ok:false, error:'Valor do item maior que o total pago.' });
    }

    // tipo/forma de pagamento
    const mpType = String(payment?.payment_type_id || '').toLowerCase(); // 'credit_card'|'debit_card'|'pix'|...
    const tipoPagamento = (mpType === 'pix') ? '8' : '3';                // 8=PIX | 3=Cartão
    const tipoCartao    = (mpType === 'credit_card') ? '1'
                        : (mpType === 'debit_card')  ? '2'
                        : '0';                                           // 0=PIX
    const formaPagamento = (mpType === 'pix') ? 'PIX'
                        : (mpType === 'debit_card') ? 'Cartão de Débito'
                        : 'Cartão de Crédito';
    const parcelas = Number(payment?.installments || 1);

    // helpers datas
    function toYMD(dateStr) {
      if (!dateStr) return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
        const [d,m,y] = dateStr.split('/');
        return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
      }
      const t = Date.parse(dateStr);
      if (Number.isFinite(t)) {
        const z = new Date(t);
        const yyyy = z.getFullYear();
        const mm = String(z.getMonth()+1).padStart(2,'0');
        const dd = String(z.getDate()).padStart(2,'0');
        return `${yyyy}-${mm}-${dd}`;
      }
      return '';
    }
    function joinDateTime(ymd, hhmm) {
      const hh = (hhmm || '').split(':')[0] || '00';
      const mi = (hhmm || '').split(':')[1] || '00';
      return `${ymd} ${String(hh).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
    }

    // 2) Login Praxio
    const IdSessaoOp = await praxioLogin();

    // 3) Monta body venda
    const passagemXml = (passengers || []).map(p => ({
      IdEstabelecimento: String(idEstabelecimentoTicket),
      SerieBloco: String(serieBloco),
      IdViagem: String(schedule?.idViagem || ''),
      Poltrona: String(p.seatNumber || ''),
      NomeCli: String(p.name || ''),
      IdentidadeCli: String((p.document || '').replace(/\D/g,'')),
      TelefoneCli: String((p.phone || userPhone || '')).replace(/\D/g,''),
    }));

    const horaPad = normalizeHoraPartida(schedule?.horaPartida);
    if (!schedule?.idViagem || !horaPad || !schedule?.idOrigem || !schedule?.idDestino || !passagemXml.length) {
      return res.status(400).json({ ok:false, error:'Dados mínimos ausentes para venda.' });
    }

    const bodyVenda = {
      listVendasXmlEnvio: [{
        IdSessaoOp,
        IdEstabelecimentoVenda: String(idEstabelecimentoVenda),
        IdViagem: String(schedule.idViagem),
        HoraPartida: horaPad, // ex.: "1048"
        IdOrigem: String(schedule.idOrigem),
        IdDestino: String(schedule.idDestino),
        Embarque: "S", Seguro: "N", Excesso: "N",
        BPe: 1,
        passagemXml,
        pagamentoXml: [{
          DataPagamento: nowWithTZOffsetISO(-180), // ISO -03:00
          TipoPagamento: tipoPagamento,           // 8=PIX | 3=Cartão
          TipoCartao: tipoCartao,                 // 1=crédito | 2=débito | 0=PIX
          QtdParcelas: parcelas,
          ValorPagamento: Number(totalAmount || mpAmount)
        }]
      }]
    };

    console.log('[Praxio][Venda] body:', JSON.stringify(bodyVenda).slice(0, 4000));

    // 4) Chama Praxio
    const vendaResult = await praxioVendaPassagem(bodyVenda);
    console.log('[Praxio][Venda][Resp]:', JSON.stringify(vendaResult).slice(0, 4000));

    // 5) Gerar PDFs (local) e subir no Drive
    const subDir = new Date().toISOString().slice(0,10);
    const outDir = path.join(TICKETS_DIR, subDir);
    await fs.promises.mkdir(outDir, { recursive: true });

    const arquivos = [];
    const emailAttachments = []; // base64 + Buffer
    const bilhetesPayload = [];

    for (const p of (vendaResult.ListaPassagem || [])) {
      const ticket = mapVendaToTicket({
        ListaPassagem: [p],
        mp: {
          payment_type_id: payment.payment_type_id,
          payment_method_id: (payment.payment_method?.id || payment.payment_method_id || ''),
          status: payment.status,
          installments: payment.installments
        },
        emissaoISO: new Date().toISOString()
      });

      // 5.1 gerar PDF local
      const pdf = await generateTicketPdf(ticket, outDir);
      const localPath = path.join(outDir, pdf.filename);
      const localUrl  = `/tickets/${subDir}/${pdf.filename}`;

      // 5.2 subir no Drive (opcional)
      let drive = null;
      try {
        const buf = await fs.promises.readFile(localPath);
        const nome = `BPE_${ticket.numPassagem}.pdf`;
        drive = await uploadPdfToDrive({
          buffer: buf,
          filename: nome,
          folderId: process.env.GDRIVE_FOLDER_ID,
        });

        // preparar anexos para e-mail
        emailAttachments.push({
          filename: nome,
          contentBase64: buf.toString('base64'),
          buffer: buf,
        });
      } catch (e) {
        console.error('[Drive] upload falhou:', e?.message || e);
        try {
          const buf = await fs.promises.readFile(localPath);
          const nome = `BPE_${ticket.numPassagem}.pdf`;
          emailAttachments.push({
            filename: nome,
            contentBase64: buf.toString('base64'),
            buffer: buf,
          });
        } catch(_) {}
      }

      arquivos.push({
        numPassagem: ticket.numPassagem,
        pdfLocal: localUrl,
        driveUrl: drive?.webViewLink || null,
        driveFileId: drive?.id || null
      });

      bilhetesPayload.push({
        numPassagem: p.NumPassagem || ticket.numPassagem,
        chaveBPe:    p.ChaveBPe || ticket.chaveBPe || null,
        origem:      p.Origem || ticket.origem || schedule?.originName || schedule?.origem || null,
        destino:     p.Destino || ticket.destino || schedule?.destinationName || schedule?.destino || null,
        poltrona:    p.Poltrona || ticket.poltrona || null,
        nomeCliente: p.NomeCliente || ticket.nomeCliente || null,
        docCliente:  p.DocCliente || ticket.docCliente || null,
        valor:       p.ValorPgto ?? ticket.valor ?? null
      });
    }

    // 5.3) Preparar pacote de e-mail (NÃO envia agora; vai no agregador)
let emailFragment = null;
try {
  // pega o e-mail do login com alta prioridade
  const getMail = v => (v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) ? String(v).trim() : null;
  const loginEmail =
    getMail(req?.user?.email) ||
    getMail(req?.session?.user?.email) ||
    getMail(req?.headers?.['x-user-email']) ||
    getMail(req?.body?.loginEmail || req?.body?.emailLogin) ||
    null;

  const to = loginEmail || pickBuyerEmail({ req, payment, vendaResult, fallback: null });
  if (to) {
    const appName   = process.env.APP_NAME || 'Turin Transportes';
    const fromName  = process.env.SUPPORT_FROM_NAME || 'Turin Transportes';
    const fromEmail = process.env.SUPPORT_FROM_EMAIL || process.env.SMTP_USER;

    const rota = `${schedule?.originName || schedule?.origin || schedule?.origem || ''} → ${schedule?.destinationName || schedule?.destination || schedule?.destino || ''}`;
    const data = schedule?.date || '';
    const hora = schedule?.horaPartida || schedule?.departureTime || '';
    const valorTotalBRL = (Number(payment?.transaction_amount || 0)).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

    const listaBilhetesHtml = arquivos.map((a,i) => {
      const link = a.driveUrl || (a.pdfLocal ? (new URL(a.pdfLocal, `https://${req.headers.host}`).href) : '');
      const linkHtml = link ? `<div style="margin:2px 0"><a href="${link}" target="_blank" rel="noopener">Abrir bilhete ${i+1}</a></div>` : '';
      return `<li>Bilhete nº <b>${a.numPassagem}</b>${linkHtml}</li>`;
    }).join('');

    const html =
      `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222">
        <p>Olá,</p>
        <p>Recebemos o seu pagamento em <b>${appName}</b>. Seguem os bilhetes em anexo.</p>
        <p><b>Rota:</b> ${rota}<br/>
           <b>Data:</b> ${data} &nbsp; <b>Saída:</b> ${hora}<br/>
           <b>Valor total:</b> ${valorTotalBRL}
        </p>
        <p><b>Bilhetes:</b></p>
        <ul style="margin-top:8px">${listaBilhetesHtml}</ul>
        <p style="color:#666;font-size:12px;margin-top:16px">Este é um e-mail automático. Em caso de dúvidas, responda a esta mensagem.</p>
      </div>`;

    const text =
      `Olá,\n\nRecebemos seu pagamento em ${appName}. Bilhetes anexos.\n\n`+
      `Rota: ${rota}\nData: ${data}  Saída: ${hora}\nValor total: ${valorTotalBRL}\n`+
      `Bilhetes:\n` + arquivos.map((a,i)=>` - Bilhete ${i+1}: ${a.numPassagem}`).join('\n');

    emailFragment = {
      email: {
        to, fromEmail, fromName, subject: `Seus bilhetes – ${appName}`,
        html, text,
        attachments: emailAttachments // buffers + base64 já prontos
      }
    };
  } else {
    console.warn('[Email] comprador sem e-mail. Será enviado apenas o webhook.');
  }
} catch (e) {
  console.error('[Email] preparação falhou:', e?.message || e);
}


  // 6) Webhook + E-mail via agregador (1 POST e 1 e-mail por compra)
try {
  const getMail = v => (v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) ? String(v).trim() : null;
  const userEmail =
    getMail(req?.user?.email) ||
    getMail(req?.session?.user?.email) ||
    getMail(req?.headers?.['x-user-email']) ||
    getMail(req?.body?.loginEmail || req?.body?.emailLogin) ||
    null;

  const userPhone =
    req?.user?.phone || req?.session?.user?.phone || req?.headers?.['x-user-phone'] || req?.body?.loginPhone || null;

  const toYMD = (v) => {
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  };
  const joinDateTime = (d, hm) => (d && hm) ? `${d} ${String(hm).slice(0,5)}` : (d || hm || '');

  const ymdViagem = toYMD(schedule?.date || schedule?.dataViagem || '');
  const hhmm      = String(schedule?.horaPartida || schedule?.departureTime || '00:00').slice(0,5);

  const bilhetes = (Array.isArray(bilhetesPayload) && bilhetesPayload.length)
    ? bilhetesPayload
    : (vendaResult.ListaPassagem || []).map(p => ({
        numPassagem: p.NumPassagem,
        chaveBPe:    p.ChaveBPe || null,
        origem:      p.Origem,
        destino:     p.Destino,
        poltrona:    p.Poltrona,
        nomeCliente: p.NomeCliente,
        docCliente:  p.DocCliente,
        valor:       p.ValorPgto
      }));

  const fragment = {
    base: {
      fonte: 'sitevendas',
      userEmail,
      userPhone,
      idaVolta:       req?.body?.idaVolta ?? null,
      tipoPagamento:  req?.body?.tipoPagamento ?? null,
      formaPagamento: req?.body?.formaPagamento ?? null,
      dataViagem: ymdViagem,
      dataHora:   joinDateTime(ymdViagem, hhmm),
      mp: {
        id: payment?.id,
        status: payment?.status,
        status_detail: payment?.status_detail,
        external_reference: payment?.external_reference || null,
        amount: payment?.transaction_amount
      },
      viagem: {
        idViagem:    schedule?.idViagem,
        horaPartida: schedule?.horaPartida || schedule?.departureTime,
        idOrigem:    schedule?.idOrigem   || schedule?.originId,
        idDestino:   schedule?.idDestino  || schedule?.destinationId,
        origemNome:  schedule?.originName || schedule?.origem,
        destinoNome: schedule?.destinationName || schedule?.destino,
      },
    },
    bilhetes,
    arquivos,
    ...(emailFragment || {}) // junta dados do e-mail aqui
  };

  const hookUrl = process.env.WEBHOOK_SALVAR_BPE_URL
    || 'https://primary-teste1-f69d.up.railway.app/webhook/salvarBpe';

  const groupId = computeGroupId(req, payment, schedule);
  await queueUnifiedSend(groupId, fragment, hookUrl);
  console.log('[AGGR] queued groupId=', groupId, '| bilhetes+=', bilhetes.length, '| emailTo=', (emailFragment?.email?.to || '(nenhum)'));
} catch (e) {
  console.error('[AGGR] queue erro:', e?.message || e);
}

    // 7) Retorno para o front
    return res.json({ ok: true, venda: vendaResult, arquivos });

  } catch (e) {
    console.error('praxio/vender error:', e);
    return res.status(500).json({ ok:false, error: e.message || 'Falha ao vender/gerar bilhete.' });
  }
});

/* =================== Fallback para .html =================== */
app.get('*', (req, res, next) => {
  if (req.path.endsWith('.html')) {
    return res.sendFile(path.join(PUBLIC_DIR, req.path));
  }
  next();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] rodando em http://localhost:${PORT} | publicDir: ${PUBLIC_DIR}`);
});
