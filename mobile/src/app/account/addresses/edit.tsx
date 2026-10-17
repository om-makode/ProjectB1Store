import { withLogin } from '@/features/auth/LoginRequired';
import { AddressFormScreen } from '@/features/addresses/AddressFormScreen';

export default withLogin(AddressFormScreen, 'addresses', 'address.title');
