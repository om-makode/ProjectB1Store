import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AuthListener } from '@/features/auth/AuthListener';
import { CartSync } from '@/features/cart/hooks';
import { AppGate } from '@/features/config/AppGate';
import { RootErrorBoundary } from '@/features/errors/RootErrorBoundary';
import { PushSetup } from '@/features/notifications/PushSetup';
import { OrdersLive } from '@/features/orders/live';
import { initI18n } from '@/i18n';
import { Providers } from '@/providers/Providers';
import { useSettings } from '@/stores/settings';
import { appFonts } from '@/theme/fonts';

void SplashScreen.preventAutoHideAsync();
initI18n(useSettings.getState().language); // storage is synchronous: correct language on the first frame

export default function RootLayout() {
  const [loaded, fontError] = useFonts(appFonts);
  const hasChosenLanguage = useSettings((s) => s.hasChosenLanguage);
  const ready = loaded || !!fontError; // fall back to system fonts rather than hang on the splash

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <Providers>
      <RootErrorBoundary>
        <AuthListener />
        <CartSync />
        <OrdersLive />
        <PushSetup />
        <AppGate>
          <Stack screenOptions={{ headerShown: false }}>
            {/* Every route is listed here so the guard covers all of them (unlisted routes are
                added outside the guard and trigger ROUTE_NAMES_CHANGED when it flips). */}
            <Stack.Protected guard={hasChosenLanguage}>
              <Stack.Screen name="(shop)" />
              <Stack.Screen name="category/[slug]" />
              <Stack.Screen name="product/[slug]/index" />
              <Stack.Screen name="product/[slug]/reviews" />
              <Stack.Screen name="collection/[slug]" />
              <Stack.Screen name="p/[slug]" />
              <Stack.Screen name="c/[slug]" />
              <Stack.Screen name="buy-again" />
              <Stack.Screen name="search" options={{ animation: 'fade' }} />
              <Stack.Screen name="cart" options={{ animation: 'slide_from_bottom' }} />
              <Stack.Screen name="checkout" />
              <Stack.Screen
                name="order/placed"
                options={{ gestureEnabled: false, animation: 'fade' }}
              />
              <Stack.Screen name="order/[id]/index" />
              <Stack.Screen name="order/[id]/issue" />
              <Stack.Screen name="order/[id]/review" />
              <Stack.Screen name="auth/login" options={{ presentation: 'modal' }} />
              <Stack.Screen name="account/profile" />
              <Stack.Screen name="account/help" />
              <Stack.Screen name="account/legal" />
              <Stack.Screen name="account/wishlist" />
              <Stack.Screen name="account/notifications" />
              <Stack.Screen name="account/notification-settings" />
              <Stack.Screen name="account/addresses/index" />
              <Stack.Screen name="account/addresses/edit" />
              <Stack.Screen name="store" />
              <Stack.Screen name="admin" />
            </Stack.Protected>
            <Stack.Protected guard={!hasChosenLanguage}>
              <Stack.Screen name="(onboarding)/language" />
            </Stack.Protected>
          </Stack>
        </AppGate>
      </RootErrorBoundary>
    </Providers>
  );
}
