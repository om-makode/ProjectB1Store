import { utf8Decode, utf8Encode } from '../utf8';

it('round-trips mixed Latin, Devanagari and emoji', () => {
  const s = 'Amul ताजा दूध 500 ml ✓ 🛒';
  expect(utf8Decode(utf8Encode(s))).toBe(s);
});
