// mpRoutes.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const router = express.Router();

/* ========= SDK/Config ========= */
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
if (!ACCESS_TOKEN) {
  console.warn('[MP] MP_ACCESS_TOKEN ausente! /api/mp/* retornará erro.');
}
const mp = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });

/* ========= Helpers ========= */
const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');

/* ========= Expor public key para o front ========= */
router.get('/pubkey', (req, res) => {
  res.json({ publicKey: process.env.MP_PUBLIC_KEY || '' });
});

/* ========= Criar pagamento ========= */
router.post('/pay', async (req, res) => {
  try {
    if (!ACCESS_TOKEN) {
      return res.status(500).json({ error: true, message: 'MP_ACCESS_TOKEN não configurado.' });
    }

    // Aceita camelCase e snake_case vindos do front
    const paymentMethodId =
      req.body.paymentMethodId ?? req.body.payment_method_id;   // 'pix' | 'credit_card' | 'debit_card'
    const transactionAmount =
      Number(req.body.transactionAmount ?? req.body.transaction_amount ?? 0);
    const token = req.body.token;                                // token do cartão (Brick)
    const installments = Number(req.body.installments ?? 1);
    const issuerId = req.body.issuerId ?? req.body.issuer_id;    // opcional (não obrigatório p/ Brick)
    const description = req.body.description || 'Compra Turin Transportes';
    const payerIn = req.body.payer || {};

    // Sanitiza CPF se existir
    if (payerIn?.identification?.number) {
      payerIn.identification.number = onlyDigits(payerIn.identification.number);
    }

    // Valida valor
    if (!transactionAmount || transactionAmount <= 0) {
      return res.status(400).json({ error: true, message: 'Valor inválido.' });
    }

    // Cabeçalho de idempotência (objeto simples – NADA de "new MPRequestOptions")
    const requestOptions = { idempotencyKey: uuidv4() };

    const payments = new Payment(mp);

    // Corpo base comum
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

    if ((paymentMethodId || '').toLowerCase() === 'pix') {
      // ---------- PIX ----------
      if (!base.payer?.email) {
        return res.status(400).json({ error: true, message: 'E-mail obrigatório para Pix.' });
      }
      body = {
        ...base,
        payment_method_id: 'pix'
      };
    } else {
      // ---------- CARTÃO (crédito/débito) ----------
      if (!token) {
        return res.status(400).json({ error: true, message: 'Token do cartão ausente.' });
      }
      body = {
        ...base,
        token,
        installments,     // 1x já vem do front; o Brick pode mostrar 1x e o servidor reforça aqui
        capture: true
        // Não envie payment_method_id nem issuer_id: o MP infere pelo token/BIN.
        // Se quiser forçar issuer em casos raros:
        // issuer_id: issuerId || undefined
      };
    }

    const mpResp = await payments.create({ body, requestOptions });

    // Resposta “magrela” mas com o essencial
    return res.json({
      id: mpResp?.id,
      status: mpResp?.status,
      status_detail: mpResp?.status_detail,
      point_of_interaction: mpResp?.point_of_interaction,
      transaction_details: mpResp?.transaction_details
    });
  } catch (err) {
    // Loga a causa real (quando existir)
    const cause =
      err?.cause?.[0]?.description ||
      err?.cause?.[0]?.message ||
      err?.message ||
      'Falha ao processar pagamento';
    console.error('[MP] /pay error ->', JSON.stringify(err?.cause || err, null, 2));
    // 400 p/ erro de regra/validação, 401/403 só quando for credencial
    const code = /token|credencial|unauthorized/i.test(cause) ? 401 : 400;
    return res.status(code).json({ error: true, message: cause });
  }
});

module.exports = router;
