import { Stack } from 'expo-router';

import { StoreGate } from '@/features/store-ops/StoreGate';

/** Store mode: staff/admin only (the RPCs enforce it again on the server). */
export default function StoreLayout() {
  return (
    <StoreGate>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="order/[id]" />
        <Stack.Screen name="stock" options={{ animation: 'none' }} />
        <Stack.Screen name="issues" options={{ animation: 'none' }} />
        <Stack.Screen name="settings" options={{ animation: 'none' }} />
      </Stack>
    </StoreGate>
  );
}
