// One-off: assemble project migration files from doc SQL blocks (run once, then edit project files).
import fs from 'node:fs'
const B = new URL('./blocks/', import.meta.url).pathname
const P = '/Users/vasantha_m/Desktop/React Native Projects/nearkart/supabase'
const blk = (id) => fs.readFileSync(B + id + '.sql', 'utf8').trimEnd() + '\n'
const join = (...ids) => ids.map(blk).join('\n')
const M = {
  '20261101000000_p0_foundation.sql': join('PHASE_0_01'),
  '20261101010000_p1_catalog.sql': join('PHASE_1_01', 'PHASE_1_04'),
  '20261101011000_p1_home.sql': join('PHASE_1_05'),
  '20261101020000_p2_search.sql': join('PHASE_2_01'),
  '20261101030000_p3_accounts_addresses.sql': join('PHASE_3_01'),
  '20261101040000_p4_cart_orders.sql': join('PHASE_4_01', 'PHASE_4_02', 'PHASE_4_03', 'PHASE_4_04'),
  '20261101050000_p5_order_tracking_notifications.sql': join('PHASE_5_01','PHASE_5_02','PHASE_5_03','PHASE_5_04','PHASE_5_05','PHASE_5_06','PHASE_5_07'),
  '20261101060000_p6_store_ops.sql': join('PHASE_6_01','PHASE_6_02','PHASE_6_03','PHASE_6_04','PHASE_6_05','PHASE_6_06','PHASE_6_07','PHASE_6_08'),
  '20261101070000_p7_admin.sql': join('PHASE_7_01'),
  '20261101080000_p8_engagement.sql': join('PHASE_8_01'),
  '20261101090000_p9_hardening.sql': join('PHASE_9_01','PHASE_9_03','PHASE_9_06','PHASE_9_07','PHASE_9_09'),
  '20261101100000_p10_payments_enums.sql': join('PHASE_10_01'),
  '20261101100100_p10_payments.sql': join('PHASE_10_02','PHASE_10_03','PHASE_10_04','PHASE_10_06','PHASE_10_07','PHASE_10_08','PHASE_10_09','PHASE_10_10','PHASE_10_11'),
}
fs.mkdirSync(P + '/migrations', { recursive: true })
fs.mkdirSync(P + '/tests', { recursive: true })
for (const [f, s] of Object.entries(M)) fs.writeFileSync(`${P}/migrations/${f}`, s)
fs.writeFileSync(P + '/seed.sql', join('PHASE_0_03', 'PHASE_1_02', 'PHASE_1_06', 'PHASE_2_02'))
const T = { '0000_foundation': 'PHASE_0_04', '0100_catalog': 'PHASE_1_03', '0200_search': 'PHASE_2_03',
  '0300_accounts_addresses': 'PHASE_3_02', '0400_cart_orders': 'PHASE_4_05', '0500_orders_notifications': 'PHASE_5_08',
  '0600_store_ops': 'PHASE_6_09', '20_rls_customer_data': 'PHASE_9_05' }
for (const [f, b] of Object.entries(T)) fs.writeFileSync(`${P}/tests/${f}.test.sql`, blk(b))
fs.writeFileSync(P + '/tests/00_helpers.sql', blk('PHASE_9_04'))
console.log('ok')
