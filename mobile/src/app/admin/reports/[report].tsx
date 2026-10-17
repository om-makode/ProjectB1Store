import { Redirect, useLocalSearchParams } from 'expo-router';

import { ReportScreen, isReportName } from '@/features/admin/ReportScreen';

export default function ReportRoute() {
  const { report } = useLocalSearchParams<{ report: string }>();
  if (!isReportName(report)) return <Redirect href="/admin" />;
  return <ReportScreen name={report} />;
}
