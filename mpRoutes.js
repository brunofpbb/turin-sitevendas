const express = require('express');
const router = express.Router();
const mercadopago = require('mercadopago');

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_PUBLIC_KEY  = process.env.MP_PUBLIC_KEY;

if (!MP_ACCESS_TOKEN) console.warn('[MP] ⚠ MP_ACCESS_TOKEN não definido');
mercadopago.configure({ access_token: MP_ACCESS_TOKEN });

// helpers
const onlyDigits = v => String(v || '').replace(/\D/g, '');
function resolveEntityType(payer = {}) {
  // aceita: payer.entityType (front), payer.entity_type (front/back),
  // ou derivado do identification.type (CPF/CNPJ)
  const tRaw = payer.entityType || payer.entity_type || payer?.identification?.type;
  const t = String(tRaw || '').toUpperCase();
  if (t === 'CPF') return 'individual';
  if (t === 'CNPJ') return 'association';
  if (t === 'INDIVIDUAL' || t === 'ASSOCIATION') return t.toLowerCase();
  return undefined;
}

// publica a public key para o Brick
router.get('/pubkey', (_req, res) => res.json({ publicKey: MP_PUBLIC_KEY || null }));

router.post('/pay', async (req, res) => {
  try {
    // ===== recebe do front em camelCase =====
    const {
      transactionAmount,
      description,
      token,
      installments,
      paymentMethodId,
      issuerId,
      payer = {},
    } = req.body || {};

    // ===== normaliza documento e entity_type =====
    const idType   = String(payer?.identification?.type || '').toUpperCase(); // "CPF"/"CNPJ"
    const idNumber = onlyDigits(payer?.identification?.number);
    const entityType = resolveEntityType({ ...payer, identification: { type: idType } });

    // ===== monta body no formato do SDK (snake_case) =====
    const base = {
      transaction_amount: Number(transactionAmount),
      description: description || 'Compra Turin Transportes',
      payer: {
        email: payer?.email || '',
        first_name: payer?.first_name,
        last_name:  payer?.last_name,
        identification: {
          type: idType || undefined,
          number: idNumber || undefined,
        },
        entity_type: entityType, // <- ESSENCIAL NO BRASIL
      },
    };

    const method = String(paymentMethodId || '').toLowerCase();

    // PIX
    if (method === 'pix') {
      base.payment_method_id = 'pix';
      base.date_of_expiration = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      // logs úteis
      console.log('[MP] PIX create payload ->', JSON.stringify(base));

      const idemKey = req.headers['x-idempotency-key'];
      const r = await mercadopago.payment.create(base, idemKey ? { idempotencyKey: idemKey } : undefined);
      const body = r?.body || {};
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

    // CARTÃO
    base.payment_method_id = paymentMethodId; // ex.: "master"
    base.token = token;                        // token do Brick
    base.installments = Number(installments || 1);
    // ⚠ issuer_id costuma causar 400 se não casar com o BIN no sandbox — só envie se veio mesmo:
    if (issuerId) base.issuer_id = issuerId;
    base.capture = true;

    console.log('[MP] CARD create payload ->', JSON.stringify(base));

    const idemKey = req.headers['x-idempotency-key'];
    const r = await mercadopago.payment.create(base, idemKey ? { idempotencyKey: idemKey } : undefined);
    const body = r?.body || {};

    return res.json({
      id: body?.id,
      status: body?.status,
      status_detail: body?.status_detail,
    });
  } catch (err) {
    const e = err?.response?.data || err;
    console.error('[MP] /api/mp/pay ERROR ->', JSON.stringify(e));
    return res.status(400).json({
      error: true,
      message: e?.message || e?.error || 'Falha ao processar pagamento',
      cause: e?.cause || undefined,
    });
  }
});

module.exports = router;
