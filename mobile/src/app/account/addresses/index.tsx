import { withLogin } from '@/features/auth/LoginRequired';
import { AddressListScreen } from '@/features/addresses/AddressListScreen';

export default withLogin(AddressListScreen, 'addresses', 'address.title');
