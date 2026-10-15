const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const https = require('https');
const { run } = require('../database/db');
const { requireAuth } = require('../middleware/auth');

function verifyWithPaystack(reference) {
  return new Promise((resolve, reject) => {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return reject(new Error('Missing PAYSTACK_SECRET_KEY in server configuration'));

    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: `/transaction/verify/${encodeURIComponent(reference)}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secret}`
      }
    };

    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => (data += chunk));
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    });

    request.on('error', (err) => reject(err));
    request.end();
  });
}

// POST /api/payments/verify
router.post('/verify', requireAuth, async (req, res) => {
  try {
    const { reference, orderId } = req.body;
    if (!reference) return res.status(400).json({ error: 'Reference required' });

    const paystackData = await verifyWithPaystack(reference);
    if (!paystackData || !paystackData.status || !paystackData.data || paystackData.data.status !== 'success') {
      return res.status(400).json({ error: paystackData?.message || 'Payment verification failed at gateway' });
    }

    const amountPaidNaira = paystackData.data.amount / 100;

    if (orderId) {
      await run(
        `UPDATE orders SET payment_ref = ?, status = 'Settlement Confirmed', stage = 1, paid_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [reference, orderId]
      );
    }

    res.json({
      success: true,
      amount: amountPaidNaira,
      reference,
      gatewayResponse: paystackData.data.gateway_response
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Verification transaction failed' });
  }
});

// POST /api/payments/webhook
router.post('/webhook', async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return res.status(500).send('Paystack secret key not configured');

  const signature = req.headers['x-paystack-signature'];
  if (!signature) return res.status(400).send('Missing signature');

  // Verify against the unparsed raw buffer captured in server.js
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

  if (hash !== signature) {
    return res.status(400).send('Invalid signature');
  }

  const event = typeof req.body === 'object' ? req.body : JSON.parse(rawBody.toString());
  if (event.event === 'charge.success') {
    const ref = event.data?.reference;
    if (ref) {
      await run(
        `UPDATE orders SET status = 'Settlement Confirmed', stage = 1, paid_at = CURRENT_TIMESTAMP WHERE payment_ref = ?`,
        [ref]
      );
    }
  }

  res.sendStatus(200);
});

module.exports = router;