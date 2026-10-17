import { validateAddress, type AddressDraft } from '../validate';

const ok: AddressDraft = {
  label: 'home',
  receiver_name: ' Asha Patil ',
  receiver_phone: '+91 98765 43210',
  house: 'Flat 4, Sai Residency',
  area: 'Rajapeth',
  landmark: '',
  city: 'Amravati',
  pincode: '444601',
  latitude: 20.93,
  longitude: 77.75,
  is_default: true,
};

describe('validateAddress', () => {
  it('normalises a valid draft to the table format', () => {
    const { errors, input } = validateAddress(ok);
    expect(errors).toEqual({});
    expect(input).toMatchObject({
      receiver_name: 'Asha Patil',
      receiver_phone: '9876543210',
      landmark: null,
    });
  });

  it('flags the same things the database check constraints would reject', () => {
    const { errors, input } = validateAddress({
      ...ok,
      receiver_phone: '12345',
      pincode: '044601',
      house: ' ',
    });
    expect(input).toBeNull();
    expect(errors).toMatchObject({
      receiver_phone: 'phoneError',
      pincode: 'pincodeError',
      house: 'required',
    });
  });

  it('accepts an address without a GPS location (delivery is checked at checkout)', () => {
    const { errors, input } = validateAddress({ ...ok, latitude: null, longitude: null });
    expect(errors).toEqual({});
    expect(input).toMatchObject({ latitude: null, longitude: null, pincode: '444601' });
  });
});
