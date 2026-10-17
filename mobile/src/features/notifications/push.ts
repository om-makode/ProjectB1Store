import Constants from 'expo-constants';
import { router, type Href } from 'expo-router';
import { Platform } from 'react-native';

import i18n from '@/i18n';
import { logger } from '@/lib/logger';
import { hasExpoModule } from '@/lib/nativeOptional';

import { notificationHref, registerPushToken, unregisterPushToken } from './api';

type NotificationsModule = typeof import('expo-notifications');

/**
 * Push is phones-only and needs (1) expo-notifications in the native build and
 * (2) an EAS project id for Expo push tokens. Without either, we skip quietly:
 * the in-app inbox + Realtime toasts still work everywhere (web included).
 */
export const pushSupported = () => Platform.OS !== 'web' && hasExpoModule('ExpoPushTokenManager');

export const easProjectId = (): string | undefined =>
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
  Constants.easConfig?.projectId;

let mod: NotificationsModule | null = null;
async function load(): Promise<NotificationsModule | null> {
  if (!pushSupported()) return null;
  mod ??= await import('expo-notifications');
  return mod;
}

/** Android channels (plan: one per kind, so people can mute offers but keep order updates). */
export const CHANNELS = ['orders', 'store_orders', 'stock', 'offers', 'reminders'] as const;

let currentToken: string | null = null;

/** Once at startup: foreground behaviour, Android channels, tap routing. Returns cleanup. */
export async function initPush(): Promise<() => void> {
  const N = await load();
  if (!N) return () => {};

  N.setNotificationHandler({
    // In the foreground the app already shows an in-app toast (Realtime), so no banner.
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });

  if (Platform.OS === 'android') {
    for (const id of CHANNELS) {
      await N.setNotificationChannelAsync(id, {
        name: i18n.t(`notifications.channels.${id}`),
        importance: id === 'offers' ? N.AndroidImportance.DEFAULT : N.AndroidImportance.HIGH,
        // No `sound`: the channel then uses the system notification sound. A string here is
        // treated as a bundled custom sound file name ('default' doesn't exist and errors).
      });
    }
  }

  const route = (data: unknown) => {
    const href = notificationHref(data);
    if (href) router.push(href as Href);
  };
  const sub = N.addNotificationResponseReceivedListener((r) =>
    route(r.notification.request.content.data),
  );
  // Cold start from a tapped notification.
  const last = await N.getLastNotificationResponseAsync();
  if (last) {
    route(last.notification.request.content.data);
    await N.clearLastNotificationResponseAsync();
  }
  return () => sub.remove();
}

/** After login: ask permission once, get the Expo token, save it for this user. */
export async function registerForPush(): Promise<void> {
  const N = await load();
  if (!N) return;
  const projectId = easProjectId();
  if (!projectId) {
    logger.debug('push: no EAS projectId configured, skipping token registration');
    return;
  }
  let { status } = await N.getPermissionsAsync();
  if (status !== 'granted') status = (await N.requestPermissionsAsync()).status;
  if (status !== 'granted') return;
  try {
    const { data } = await N.getExpoPushTokenAsync({ projectId });
    await registerPushToken(data, Platform.OS === 'ios' ? 'ios' : 'android');
    currentToken = data;
  } catch (e) {
    logger.warn('push: registration failed', String(e)); // offline etc.: next launch retries
  }
}

/** Before logout (needs the session): stop pushes for this device. */
export async function unregisterPush(): Promise<void> {
  if (!currentToken) return;
  const token = currentToken;
  currentToken = null;
  try {
    await unregisterPushToken(token);
  } catch (e) {
    logger.warn('push: unregister failed', String(e));
  }
}
