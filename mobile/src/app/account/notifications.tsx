import { withLogin } from '@/features/auth/LoginRequired';
import { NotificationsScreen } from '@/features/notifications/NotificationsScreen';

export default withLogin(NotificationsScreen, 'notifications', 'notifications.title');
