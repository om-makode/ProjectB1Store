import { withLogin } from '@/features/auth/LoginRequired';
import { NotificationSettingsScreen } from '@/features/engagement/NotificationSettingsScreen';

export default withLogin(NotificationSettingsScreen, 'notifications', 'notifSettings.title');
