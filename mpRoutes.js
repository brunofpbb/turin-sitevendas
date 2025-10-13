// mpRoutes.js — Mercado Pago (SDK v2) com logs e fluxo redondo
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const router = express.Router();

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const PUBLIC_KEY  = process.env.MP_PUBLIC_KEY;

if (!ACCESS_TOKEN) {
  console.warn('[MP] MP_ACCESS_TOKEN ausente! /api/mp/* retornará erro.');
}

// Instância da SDK v2
const mp = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });

// util simples
const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');

// publica a public key p/ o front
router.get('/pubkey', (req, res) => {
  res.json({ publicKey: PUBLIC_KEY || '' });
});

// diagnóstico rápido
router.get('/_diag', (req, res) => {
  res.json({
    has_access_token: Boolean(ACCESS_TOKEN),
    access_token_snippet: ACCESS_TOKEN ? ACCESS_TOKEN.slice(0, 5) + '...' + ACCESS_TOKEN.slice(-4) : null,
    public_key: PUBLIC_KEY || null
  });
});

router.post('/pay', async (req, res) => {
  const startedAt = Date.now();

  try {
    if (!ACCESS_TOKEN) {
      return res.status(500).json({ error: true, message: 'MP_ACCESS_TOKEN não configurado.' });
    }

    // ---- LOG 1: REQUEST ORIGINAL (mascarando token) ----
    const inLog = JSON.parse(JSON.stringify(req.body || {}));
    if (inLog.token) {
      const t = String(inLog.token);
      inLog.token = t.length > 10 ? t.slice(0, 6) + '…' + t.slice(-4) : '***';
    }
    console.log('\n[MP] /pay IN ->', JSON.stringify(inLog, null, 2));

    // aceita camelCase e snake_case
    const paymentMethodId =
      req.body.paymentMethodId ?? req.body.payment_method_id;  // 'pix' | 'credit_card' | 'debit_card'
    const transactionAmount =
      Number(req.body.transactionAmount ?? req.body.transaction_amount ?? 0);
    const token         = req.body.token;                       // token do cartão (Card Brick)
    const installments  = Number(req.body.installments ?? 1);
    const issuerId      = req.body.issuerId ?? req.body.issuer_id;
    const description   = req.body.description || 'Compra Turin Transportes';
    const payerIn       = req.body.payer || {};

    // normaliza CPF se veio
    if (payerIn?.identification?.number) {
      payerIn.identification.number = onlyDigits(payerIn.identification.number);
    }

    // valida valor
    if (!transactionAmount || Number.isNaN(transactionAmount) || transactionAmount <= 0) {
      console.log('[MP] /pay VALIDAÇÃO -> transactionAmount inválido:', transactionAmount);
      return res.status(400).json({ error: true, message: 'Valor inválido.' });
    }

    // idempotência (objeto simples — NÃO usar new MPRequestOptions)
    const requestOptions = { idempotencyKey: uuidv4() };

    const payments = new Payment(mp);

    // base comum
    const base = {
      transaction_amount: transactionAmount,
      description,
      payer: {
        email: payerIn.email || '',
        identification: payerIn?.identification?.number
          ? {
              type: payerIn.identification.type || 'CPF',
              number: payerIn.identification.number
            }
          : undefined
      }
    };

    let body;

    // -------- PIX --------
    if ((paymentMethodId || '').toLowerCase() === 'pix') {
      if (!base.payer?.email) {
        console.log('[MP] /pay VALIDAÇÃO -> e-mail obrigatório para Pix');
        return res.status(400).json({ error: true, message: 'E-mail obrigatório para Pix.' });
      }
      body = {
        ...base,
        payment_method_id: 'pix'
      };

    // -------- CARTÃO / DÉBITO --------
    } else {
      if (!token) {
        console.log('[MP] /pay VALIDAÇÃO -> token do cartão ausente');
        return res.status(400).json({ error: true, message: 'Token do cartão ausente.' });
      }
      body = {
        ...base,
        token,
        installments,                 // 1x (o front já envia 1; reforçamos aqui)
        capture: true,
        // Mantemos quando vier do Brick (alguns fluxos exigem)
        payment_method_id: (req.body.payment_method_id || paymentMethodId || undefined),
        issuer_id: issuerId || undefined,
      };
    }

    // ---- LOG 2: BODY ENVIADO AO MP (token mascarado) ----
    const bodyLog = JSON.parse(JSON.stringify(body));
    if (bodyLog.token) {
      const t = String(bodyLog.token);
      bodyLog.token = t.length > 10 ? t.slice(0, 6) + '…' + t.slice(-4) : '***';
    }
    console.log('[MP] /pay OUT (body) ->', JSON.stringify(bodyLog, null, 2));
    console.log('[MP] /pay OUT (requestOptions) ->', requestOptions);

    // chamada ao MP
    const mpResp = await payments.create({ body, requestOptions });

    // ---- LOG 3: RESPOSTA DO MP ----
    console.log('[MP] /pay MP RESP ->', JSON.stringify({
      id: mpResp?.id,
      status: mpResp?.status,
      status_detail: mpResp?.status_detail,
      point_of_interaction: mpResp?.point_of_interaction?.type || null
    }, null, 2));

    const elapsed = Date.now() - startedAt;
    console.log(`[MP] /pay OK (elapsed ${elapsed}ms)`);

    return res.json({
      id: mpResp?.id,
      status: mpResp?.status,
      status_detail: mpResp?.status_detail,
      point_of_interaction: mpResp?.point_of_interaction,
      transaction_details: mpResp?.transaction_details
    });

  } catch (err) {
    const cause =
      err?.cause?.[0]?.description ||
      err?.cause?.[0]?.message ||
      err?.message ||
      'Falha ao processar pagamento';

    // ---- LOG 4: ERRO DETALHADO ----
    console.error('[MP] /pay ERROR RAW ->', err);
    if (err?.cause) {
      console.error('[MP] /pay ERROR cause ->', JSON.stringify(err.cause, null, 2));
    }
    console.error('[MP] /pay ERROR message ->', cause);

    const elapsed = Date.now() - startedAt;
    console.error(`[MP] /pay FAIL (elapsed ${elapsed}ms)`);

    // 401 para credencial/token; 400 para validação/regra
    const code = /token|credencial|unauthorized/i.test(cause) ? 401 : 400;
    return res.status(code).json({ error: true, message: cause });
  }
});

module.exports = router;
