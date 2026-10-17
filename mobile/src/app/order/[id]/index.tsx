import { withLogin } from '@/features/auth/LoginRequired';
import { OrderScreen } from '@/features/orders/OrderScreen';

export default withLogin(OrderScreen, 'orders', 'order.title');
