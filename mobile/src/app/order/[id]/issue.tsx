import { withLogin } from '@/features/auth/LoginRequired';
import { ReportIssueScreen } from '@/features/orders/ReportIssueScreen';

export default withLogin(ReportIssueScreen, 'orders', 'issue.title');
