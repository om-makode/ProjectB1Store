import { Stack } from 'expo-router';

import { AdminGate } from '@/features/admin/components';

/** Admin: owner only (the admin_* RPCs and RLS check is_admin() again on the server). */
export default function AdminLayout() {
  return (
    <AdminGate>
      <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
    </AdminGate>
  );
}
