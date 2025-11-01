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

// servir PDFs locais
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

// === Brevo API (fallback) ===
async function sendViaBrevoApi({ to, subject, html, text, fromEmail, fromName, attachments = [] }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY ausente');
  const brevoAttachments = (attachments || []).map(a => ({
    name: a.filename || 'anexo.pdf',
    content: a.contentBase64 || a.content || ''
  }));
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: to }],
      subject, htmlContent: html, textContent: text,
      attachment: brevoAttachments.length ? brevoAttachments : undefined,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Brevo API ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

/* =================== Helpers Gerais =================== */

// Data com offset -03:00 (ex.: 2025-10-17T22:12:24-03:00)
function isoWithOffset(iso, offsetMinutes = -(3*60)) {
  const base = iso ? new Date(iso) : new Date();
  const tz = new Date(base.getTime() + (offsetMinutes + base.getTimezoneOffset()) * 60000);
  const pad = n => String(n).padStart(2, '0');
  const y = tz.getFullYear();
  const m = pad(tz.getMonth()+1);
  const d = pad(tz.getDate());
  const hh= pad(tz.getHours());
  const mm= pad(tz.getMinutes());
  const ss= pad(tz.getSeconds());
  const sign = offsetMinutes <= 0 ? '-' : '+';
  const oh = pad(Math.floor(Math.abs(offsetMinutes)/60));
  const om = pad(Math.abs(offsetMinutes)%60);
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}${sign}${oh}:${om}`;
}

// dd/MM/yyyy HH:mm:ss em America/Sao_Paulo
function nowSaoPauloString() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(now).reduce((acc,p)=>{acc[p.type]=p.value;return acc;}, {});
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function normalizeHoraPartida(h) {
  if (!h) return '';
  let s = String(h).replace(/\D/g, '');
  if (s.length === 3) s = '0' + s;
  if (s.length >= 4) s = s.slice(0,4);
  return s;
}
const onlyDigits = v => String(v || '').replace(/\D/g, '');

/* =================== Praxio helpers =================== */
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

/* =================== Google Sheets (Append) =================== */
const { google } = require('googleapis');

async function sheetsAuthWrite() {
  const key = JSON.parse(process.env.GDRIVE_SA_KEY || '{}');
  const auth = new google.auth.JWT(
    key.client_email, null, key.private_key,
    ['https://www.googleapis.com/auth/spreadsheets'] // escrita
  );
  return google.sheets({ version: 'v4', auth });
}

async function appendBPERows(rows) {
  if (!rows?.length) return;

  const spreadsheetId = process.env.SHEETS_BPE_ID;
  const sheetTab = process.env.SHEETS_BPE_TAB || 'BPE'; // nome da aba

  const sheets = await sheetsAuthWrite();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetTab}!A:AZ`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows }
  });
}

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

/* =================== Venda Praxio + PDF + Sheets + E-mail =================== */
app.post('/api/praxio/vender', async (req, res) => {
  try {
    const {
      mpPaymentId,
      schedule,                    // { idViagem, horaPartida, idOrigem, idDestino, originName?, destinationName?, date? }
      passengers,                  // [{ seatNumber, name, document, phone? }]
      totalAmount,
      idEstabelecimentoVenda = '1',
      idEstabelecimentoTicket = '93',
      serieBloco = '93',
      userEmail: emailFromBody = '',
      userPhone: phoneFromBody = '',
      idaVolta = 'ida'
    } = req.body || {};

    // 1) Revalidar pagamento no MP
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
    const mpType = String(payment?.payment_type_id || '').toLowerCase(); // 'credit_card'|'debit_card'|'pix'
    const tipoPagamento = (mpType === 'pix') ? '8' : '3'; // 8=PIX | 3=Cartão
    const formaPagamento = (mpType === 'pix') ? 'PIX'
                         : (mpType === 'debit_card' ? 'Cartão de Débito' : 'Cartão de Crédito');
    const parcelas = Number(payment?.installments || 1);

    // helpers de data para a VIAGEM
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
      const [hh='00', mi='00'] = String(hhmm || '').split(':');
      return `${ymd} ${String(hh).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
    }

    // 2) Login Praxio
    const IdSessaoOp = await praxioLogin();

    // 3) Montar body da venda
    const passagemXml = (passengers || []).map(p => ({
      IdEstabelecimento: String(idEstabelecimentoTicket),
      SerieBloco: String(serieBloco),
      IdViagem: String(schedule?.idViagem || ''),
      Poltrona: String(p.seatNumber || ''),
      NomeCli: String(p.name || ''),
      IdentidadeCli: String((p.document || '').replace(/\D/g,'')),
      TelefoneCli: String((p.phone || phoneFromBody || '')).replace(/\D/g,''),
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
        HoraPartida: horaPad,
        IdOrigem: String(schedule.idOrigem),
        IdDestino: String(schedule.idDestino),
        Embarque: "S", Seguro: "N", Excesso: "N",
        BPe: 1,
        passagemXml,
        pagamentoXml: [{
          DataPagamento: isoWithOffset(null, -180),
          TipoPagamento: tipoPagamento,
          TipoCartao: (mpType === 'credit_card') ? '1' : (mpType === 'debit_card' ? '2' : '0'),
          QtdParcelas: parcelas,
          ValorPagamento: Number(totalAmount || mpAmount)
        }]
      }]
    };

    console.log('[Praxio][Venda] body:', JSON.stringify(bodyVenda).slice(0, 4000));

    // 4) Chamar Praxio
    const vendaResult = await praxioVendaPassagem(bodyVenda);
    console.log('[Praxio][Venda][Resp]:', JSON.stringify(vendaResult).slice(0, 4000));

    // 5) Gerar PDFs, subir no Drive e consolidar dados para e-mail e Sheets
    const subDir = new Date().toISOString().slice(0,10);
    const outDir = path.join(TICKETS_DIR, subDir);
    await fs.promises.mkdir(outDir, { recursive: true });

    const arquivos = [];
    const emailAttachments = [];
    const bilhetesEmitidos = [];

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

      const pdf = await generateTicketPdf(ticket, outDir);
      const localPath = path.join(outDir, pdf.filename);
      const localUrl  = `/tickets/${subDir}/${pdf.filename}`;

      let drive = null;
      try {
        const buf = await fs.promises.readFile(localPath);
        const nome = `BPE_${ticket.numPassagem}.pdf`;
        drive = await uploadPdfToDrive({
          buffer: buf,
          filename: nome,
          folderId: process.env.GDRIVE_FOLDER_ID,
        });
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
        } catch(_){}
      }

      arquivos.push({
        numPassagem: ticket.numPassagem,
        pdfLocal: localUrl,
        driveUrl: drive?.webViewLink || null,
        driveFileId: drive?.id || null
      });

      bilhetesEmitidos.push({
        numPassagem: p.NumPassagem || ticket.numPassagem,
        chaveBPe:    p.ChaveBPe || ticket.chaveBPe || null,
        origem:      p.Origem || ticket.origem || schedule?.originName || schedule?.origem || null,
        destino:     p.Destino || ticket.destino || schedule?.destinationName || schedule?.destino || null,
        poltrona:    p.Poltrona || ticket.poltrona || null,
        nomeCliente: p.NomeCliente || ticket.nomeCliente || null,
        docCliente:  p.DocCliente || ticket.docCliente || null,
        valor:       (p.ValorPgto ?? ticket.valor ?? null),
        linkDrive:   arquivos[arquivos.length-1]?.driveUrl || null
      });
    }

    // 6) Preparar e ENVIAR 1 e-mail por compra (com todos os bilhetes)
    // E-mail do login (PRIORIDADE)
    const getMail = v => (v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) ? String(v).trim() : null;
    const loginEmail =
      getMail(req?.user?.email) ||
      getMail(req?.session?.user?.email) ||
      getMail(req?.headers?.['x-user-email']) ||
      getMail(req?.body?.loginEmail || req?.body?.emailLogin) ||
      getMail(emailFromBody) ||
      null;

    const loginPhone =
      req?.user?.phone ||
      req?.session?.user?.phone ||
      req?.headers?.['x-user-phone'] ||
      req?.body?.loginPhone ||
      phoneFromBody ||
      null;

    // 6.1 Conteúdo do e-mail
    if (loginEmail) {
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

      let sent = false;
      try {
        const got = await ensureTransport();
        if (got.transporter) {
          await got.transporter.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: loginEmail,
            subject: `Seus bilhetes (${arquivos.length}) – ${appName}`,
            html, text,
            attachments: (emailAttachments || []).map(a => ({
              filename: a.filename,
              content: a.buffer,
            })),
          });
          sent = true;
          console.log(`[Email] enviados ${emailAttachments.length} anexos para ${loginEmail} via ${got.mode}`);
        }
      } catch (e) {
        console.warn('[Email SMTP] falhou, tentando Brevo...', e?.message || e);
      }
      if (!sent) {
        await sendViaBrevoApi({
          to: loginEmail,
          subject: `Seus bilhetes (${arquivos.length}) – ${appName}`,
          html, text,
          fromEmail, fromName,
          attachments: (emailAttachments || []).map(a => ({
            filename: a.filename,
            contentBase64: a.contentBase64,
          })),
        });
        console.log(`[Email] enviados ${emailAttachments.length} anexos para ${loginEmail} via Brevo API`);
      }
    } else {
      console.warn('[Email] comprador sem e-mail. Pulando envio.');
    }

    // 7) Gravar DIRETO no Google Sheets (uma linha por bilhete)
    try {
      const ymd = toYMD(schedule?.date || schedule?.dataViagem || '');
      const hhmm = String(schedule?.horaPartida || schedule?.departureTime || '00:00').slice(0,5);
      const dataHora = joinDateTime(ymd, hhmm);

      const net = payment?.transaction_details?.net_received_amount ?? '';
      const fee0 = Array.isArray(payment?.fee_details) && payment.fee_details[0] ? payment.fee_details[0].amount : '';
      const chargeId = Array.isArray(payment?.charges_details) && payment.charges_details[0] ? (payment.charges_details[0].id || `${payment.id}-001`) : `${payment.id}-001`;
      const dataHoraPagamentoISO = payment?.date_approved ? isoWithOffset(payment.date_approved, -180) : '';

      const phoneDigits = onlyDigits(loginPhone);
      const phoneSheet = phoneDigits ? (phoneDigits.startsWith('55') ? phoneDigits : `55${phoneDigits}`) : '';

      const rows = bilhetesEmitidos.map((b, idx) => ([
        // Data/horaSolicitação
        nowSaoPauloString(),
        // Nome
        b.nomeCliente || '',
        // Telefone
        phoneSheet,
        // E-mail
        loginEmail || '',
        // CPF
        b.docCliente || '',
        // Valor
        (Number(b.valor || 0)).toFixed(2),
        // ValorConveniencia
        '2',
        // ComissaoMP
        fee0,
        // ValorLiquido
        net,
        // NumPassagem
        b.numPassagem || '',
        // SeriePassagem
        String(serieBloco),
        // StatusPagamento
        payment?.status || '',
        // Status (sistema)
        'Emitido',
        // ValorDevolucao
        '',
        // Sentido
        idaVolta === 'volta' ? 'Volta' : 'Ida',
        // Data/hora_Pagamento
        dataHoraPagamentoISO,
        // NomePagador
        '',
        // CPF_Pagador
        '',
        // ID_Transação
        chargeId,
        // TipoPagamento
        tipoPagamento,
        // correlationID
        '',
        // idURL
        '',
        // Referencia
        payment?.external_reference || '',
        // Forma_Pagamento
        formaPagamento,
        // idUser
        '',
        // Data_Viagem
        ymd,
        // Data_Hora
        dataHora,
        // Origem
        b.origem || schedule?.originName || schedule?.origem || '',
        // Destino
        b.destino || schedule?.destinationName || schedule?.destino || '',
        // Identificador
        '',
        // idPagamento
        String(payment?.id || ''),
        // LinkBPE
        b.linkDrive || '',
        // poltrona
        b.poltrona || ''
      ]));

      await appendBPERows(rows);
      console.log(`[Sheets] Inseridas ${rows.length} linha(s).`);
    } catch (sheetErr) {
      console.error('[Sheets] erro ao inserir linhas:', sheetErr?.message || sheetErr);
    }

    // 8) Retorno para o front
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
