// HMAC / amount helpers used by the payment Edge Functions.
// Run: node supabase/functions/tests/razorpay-core.test.mjs   (Node ≥ 23.6 strips TS types)
// Expected values come from node:crypto, an implementation independent of Web Crypto.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import {
  hmacHex,
  safeEqual,
  toPaise,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from '../_shared/razorpay-core.ts';

const SECRET = 'test_secret_not_real';
const oracle = (secret, msg) => createHmac('sha256', secret).update(msg).digest('hex');

test('hmacHex matches node:crypto', async () => {
  assert.equal(await hmacHex(SECRET, 'order_ABC|pay_XYZ'), oracle(SECRET, 'order_ABC|pay_XYZ'));
  assert.equal(await hmacHex(SECRET, ''), oracle(SECRET, ''));
  assert.equal(await hmacHex(SECRET, 'दूध ₹28'), oracle(SECRET, 'दूध ₹28'));
});

test('checkout signature: order_id|payment_id with the key secret', async () => {
  const sig = oracle(SECRET, 'order_ABC|pay_XYZ');
  assert.equal(await verifyCheckoutSignature(SECRET, 'order_ABC', 'pay_XYZ', sig), true);
  assert.equal(await verifyCheckoutSignature(SECRET, 'order_ABC', 'pay_OTHER', sig), false);
  assert.equal(await verifyCheckoutSignature('wrong_secret', 'order_ABC', 'pay_XYZ', sig), false);
  assert.equal(await verifyCheckoutSignature(SECRET, 'order_ABC', 'pay_XYZ', ''), false);
  assert.equal(await verifyCheckoutSignature('', 'order_ABC', 'pay_XYZ', sig), false);
});

test('webhook signature is over the exact raw body', async () => {
  const raw = '{"event":"payment.captured","payload":{"payment":{"entity":{"amount":41200}}}}';
  const sig = oracle(SECRET, raw);
  assert.equal(await verifyWebhookSignature(SECRET, raw, sig), true);
  // Re-serialised JSON (different whitespace) must NOT verify.
  const reserialised = JSON.stringify(JSON.parse(raw), null, 1);
  assert.equal(await verifyWebhookSignature(SECRET, reserialised, sig), false);
  assert.equal(await verifyWebhookSignature(SECRET, raw, sig.toUpperCase()), true);
});

test('safeEqual', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});

test('toPaise rounds rupees to integer paise', () => {
  assert.equal(toPaise(412), 41200);
  assert.equal(toPaise('412.50'), 41250);
  assert.equal(toPaise(0.1 + 0.2), 30);
  assert.equal(toPaise('19.99'), 1999);
  assert.throws(() => toPaise('abc'));
  assert.throws(() => toPaise(-1));
});
