// mpRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const router = express.Router();

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const PUBLIC_KEY = process.env.MP_PUBLIC_KEY || process.env.MP_PUBLIC_KEY || process.env.MP_PUBLIC_KEY;

if (!ACCESS_TOKEN) {
  console.warn('[MP] MP_ACCESS_TOKEN não definido (.env).');
}
if (!PUBLIC_KEY) {
  console.warn('[MP] MP_PUBLIC_KEY não definido (.env).');
}

const mp = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });

// Public Key para o front
router.get('/pubkey', (_req, res) => {
  res.json({ publicKey: PUBLIC_KEY || '' });
});

// Criação de pagamento (cartão / pix)
router.post('/pay', async (req, res) => {
  try {
    const {
      transaction_amount,
      payment_method_id,
      token,
      installments,
      payer
    } = req.body || {};

    const amount = Number(transaction_amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: true, message: 'Valor total inválido.' });
    }
    if (!payment_method_id) {
      return res.status(400).json({ error: true, message: 'payment_method_id ausente.' });
    }

    const payClient = new Payment(mp);

    const parsedPayer = {
      email: payer?.email,
      identification: payer?.identification?.number
        ? {
            type: payer?.identification?.type || 'CPF',
            number: String(payer.identification.number).replace(/\D/g, '')
          }
        : undefined
    };

    // Corpo base
    const body = {
      transaction_amount: amount,
      description: 'Compra Turin Transportes',
      payment_method_id,
      payer: parsedPayer
    };

    if (payment_method_id === 'pix') {
      // pix não usa token/parcelas
    } else {
      // cartão
      if (!token) {
        return res.status(400).json({ error: true, message: 'Token do cartão ausente.' });
      }
      body.token = token;
      body.installments = Number(installments || 1) || 1; // reforça 1x
    }

    // Cabeçalho de idempotência (OBRIGATÓRIO)
    const requestOptions = { headers: { 'X-Idempotency-Key': uuidv4() } };

    const mpResp = await payClient.create({ body, requestOptions });

    if (payment_method_id === 'pix') {
      const tx = mpResp?.point_of_interaction?.transaction_data || {};
      return res.json({
        id: mpResp?.id,
        status: mpResp?.status,
        status_detail: mpResp?.status_detail,
        qr_code: tx.qr_code,
        qr_code_base64: tx.qr_code_base64,
        ticket_url: tx.ticket_url
      });
    }

    // cartão/débito
    return res.json({
      id: mpResp?.id,
      status: mpResp?.status,
      status_detail: mpResp?.status_detail
    });
  } catch (err) {
    const details =
      err?.cause?.[0]?.description ||
      err?.cause?.[0]?.message ||
      err?.message ||
      'Falha ao processar pagamento';

    // log detalhado no servidor
    console.error('MP /pay error:', JSON.stringify(err?.cause || err, null, 2));

    const code = /401|unauthor/i.test(details) ? 401 : 400;
    return res.status(code).json({ error: true, message: details });
  }
});

module.exports = router;
