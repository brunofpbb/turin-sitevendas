// mpRoutes.js — Mercado Pago (SDK v2) com Payments API (sem preferência)
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const router = express.Router();

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const PUBLIC_KEY  = process.env.MP_PUBLIC_KEY;

if (!ACCESS_TOKEN) {
  console.warn('[MP] MP_ACCESS_TOKEN ausente! /api/mp/* retornará erro.');
}

// Instância global do SDK
const mp = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
const payments = new Payment(mp); // <— AGORA definido aqui para usar em todos os handlers

const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');

router.get('/pubkey', (_req, res) => {
  res.json({ publicKey: PUBLIC_KEY || '' });
});

router.get('/_diag', (_req, res) => {
  res.json({
    has_access_token: Boolean(ACCESS_TOKEN),
    access_token_snippet: ACCESS_TOKEN ? ACCESS_TOKEN.slice(0, 5) + '...' + ACCESS_TOKEN.slice(-4) : null,
    public_key: PUBLIC_KEY || null
  });
});

router.post('/pay', async (req, res) => {
  const startedAt = Date.now();
  try {
    if (!ACCESS_TOKEN) return res.status(500).json({ error: true, message: 'MP_ACCESS_TOKEN não configurado.' });

    // aceita camel/snake
    const paymentMethodId   = req.body.paymentMethodId ?? req.body.payment_method_id;
    const transactionAmount = Number(req.body.transactionAmount ?? req.body.transaction_amount ?? 0);
    const token             = req.body.token;
    const installments      = Number(req.body.installments ?? 1);
    const issuerId          = req.body.issuerId ?? req.body.issuer_id;
    const description       = req.body.description || 'Compra Turin Transportes';
    const payerIn           = req.body.payer || {};

    if (payerIn?.identification?.number) {
      payerIn.identification.number = onlyDigits(payerIn.identification.number);
    }
    if (!transactionAmount || Number.isNaN(transactionAmount) || transactionAmount <= 0) {
      return res.status(400).json({ error: true, message: 'Valor inválido.' });
    }

    const idempotencyKey = uuidv4();

    const base = {
      transaction_amount: transactionAmount,
      description,
      payer: {
        email: "teste@teste.com"/*payerIn.email*/ || '',
        identification: payerIn?.identification?.number
          ? { type: payerIn.identification.type || 'CPF', number: payerIn.identification.number }
          : undefined
      }
    };

    let body;
    if ((paymentMethodId || '').toLowerCase() === 'pix') {
      if (!base.payer?.email) return res.status(400).json({ error: true, message: 'E-mail obrigatório para Pix.' });
      body = { ...base, payment_method_id: 'pix' };
    } else {
      if (!token) return res.status(400).json({ error: true, message: 'Token do cartão ausente.' });
      body = {
        ...base,
        token,
        installments,
        capture: true,
        // opcional: manter o método emissor caso venha do Brick:
        // payment_method_id: req.body.payment_method_id || paymentMethodId,
        // issuer_id: issuerId
      };
    }

    const mpResp = await payments.create({ body, requestOptions: { idempotencyKey } });

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
      err?.message || 'Falha ao processar pagamento';
    const code = /token|credencial|unauthorized/i.test(cause) ? 401 : 400;
    return res.status(code).json({ error: true, message: cause });
  }
});

// Status do pagamento
router.get('/payments/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const resp = await payments.get({ id });
    return res.json({ id: resp.id, status: resp.status, status_detail: resp.status_detail });
  } catch (err) {
    return res.status(400).json({ error: true, message: 'Falha ao consultar' });
  }
});

module.exports = router;
