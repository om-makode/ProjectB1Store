import { withLogin } from '@/features/auth/LoginRequired';
import { EditProfileScreen } from '@/features/profile/EditProfileScreen';

export default withLogin(EditProfileScreen, 'profile', 'profile.title');
