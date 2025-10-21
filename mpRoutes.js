// routes/mpRoutes.js — Mercado Pago SDK v2 + CommonJS (import dinâmico, sem payment_method_id/issuer_id forçados)

const express = require('express');
const router = express.Router();

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const MP_PUBLIC_KEY  = process.env.MP_PUBLIC_KEY  || '';

const isTestPK  = /^TEST-/.test(MP_PUBLIC_KEY);
const isTestAT  = /^TEST-/.test(MP_ACCESS_TOKEN);
const isLiveAT  = /^APP_USR-/.test(MP_ACCESS_TOKEN);

if (!MP_ACCESS_TOKEN) console.warn('[MP] ⚠ MP_ACCESS_TOKEN não definido');
if (!MP_PUBLIC_KEY)  console.warn('[MP] ⚠ MP_PUBLIC_KEY não definido');

// Helpers
const onlyDigits = v => String(v || '').replace(/\D/g, '');
function resolveEntityType(payer = {}) {
  const tRaw = payer.entityType || payer.entity_type || payer?.identification?.type;
  const t = String(tRaw || '').toUpperCase();
  if (t === 'CPF') return 'individual';
  if (t === 'CNPJ') return 'association';
  if (t === 'INDIVIDUAL' || t === 'ASSOCIATION') return t.toLowerCase();
  return undefined;
}

// Lazy init SDK v2 (ESM)
let mpPayment = null;
async function ensureMP() {
  if (mpPayment) return mpPayment;
  const sdk = await import('mercadopago');
  const { MercadoPagoConfig, Payment } = sdk;
  const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
  mpPayment = new Payment(client);
  return mpPayment;
}

// Public key para o Brick
router.get('/pubkey', (_req, res) => res.json({ publicKey: MP_PUBLIC_KEY || null }));

// Criar pagamento (Cartão / PIX)
router.post('/pay', async (req, res) => {
  try {
    // Ambiente consistente?
    if ((isTestPK && !isTestAT) || (!isTestPK && isTestAT)) {
      return res.status(400).json({
        error: true,
        message: 'Ambiente MP inconsistente: MP_PUBLIC_KEY e MP_ACCESS_TOKEN devem ser ambos TEST ou ambos LIVE.'
      });
    }

    const payment = await ensureMP();

    // transactionAmount (camel/snake); preserva ponto decimal
    const rawAmount = req.body?.transactionAmount ?? req.body?.transaction_amount ?? req.body?.amount ?? null;
    let transactionAmountNum = NaN;
    if (typeof rawAmount === 'number') {
      transactionAmountNum = rawAmount;
    } else if (typeof rawAmount === 'string') {
      let s = rawAmount.trim().replace(/\s/g, '');
      if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
      transactionAmountNum = Number(s);
    }
    if (!Number.isFinite(transactionAmountNum) || transactionAmountNum <= 0) {
      return res.status(400).json({ error: true, message: 'transactionAmount inválido ou ausente' });
    }

    const description  = req.body?.description || 'Compra Turin Transportes';
    const token        = req.body?.token;                 // obrigatório para cartão
    const installments = Number(req.body?.installments || 1);
    const pmIdFromBody = String(req.body?.paymentMethodId || req.body?.payment_method_id || '').toLowerCase();
    const payer        = req.body?.payer || {};

    // BR: CPF/CNPJ e entity_type
    const idType   = String(payer?.identification?.type || '').toUpperCase();
    const idNumber = onlyDigits(payer?.identification?.number);
    const entityType = resolveEntityType({ ...payer, identification: { type: idType } });

    // payload v2 (snake_case)
    const base = {
      transaction_amount: transactionAmountNum,
      description,
      payer: {
        email: payer?.email || '',
        first_name: payer?.first_name,
        last_name:  payer?.last_name,
        identification: {
          type:   idType || undefined,
          number: idNumber || undefined,
        },
        entity_type: entityType, // obrigatório no BR
      },
    };

    const isPix = pmIdFromBody === 'pix' || pmIdFromBody === 'bank_transfer';
    const idemKey = req.get('x-idempotency-key') || null;

    console.log('[MP] IDEMPOTENCY ->', idemKey || '(none)');
    console.log('[MP] amount raw =>', rawAmount, typeof rawAmount, '=>', transactionAmountNum);

    if (isPix) {
      // ===== PIX =====
      base.payment_method_id = 'pix';
      base.date_of_expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      console.log('[MP] PIX create payload ->', JSON.stringify(base));
      const resp = await payment.create(
        { body: base },
        idemKey ? { idempotencyKey: idemKey } : undefined
      );
      const body = resp || {};
      const td = body?.point_of_interaction?.transaction_data;
      return res.json({
        id: body?.id,
        status: body?.status,
        status_detail: body?.status_detail,
        pix: {
          qr_base64: td?.qr_code_base64,
          qr_text: td?.qr_code,
          expires_at: td?.expiration_date,
        },
      });
    }

    // ===== Cartão =====
    // NÃO forçamos payment_method_id; o MP infere pelo token/BIN.
    // NÃO enviamos issuer_id.
    base.token = token;
    base.installments = installments;
    base.capture = true;

    console.log('[MP] CARD create payload ->', JSON.stringify(base));
    const resp = await payment.create(
      { body: base },                                   // assinatura correta v2
      idemKey ? { idempotencyKey: idemKey } : undefined
    );
    const body = resp || {};
    return res.json({
      id: body?.id,
      status: body?.status,
      status_detail: body?.status_detail,
    });
  } catch (err) {
    console.error('[MP] /api/mp/pay ERROR ->', JSON.stringify(err));
    return res.status(err?.status || 400).json({
      error: true,
      message: err?.message || err?.error || 'Falha ao processar pagamento',
      cause: err?.cause || undefined,
    });
  }
});

module.exports = router;
