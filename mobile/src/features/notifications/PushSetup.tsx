import { useEffect } from 'react';

import { useUserId } from '@/features/auth/store';
import { logger } from '@/lib/logger';

import { initPush, registerForPush } from './push';

/** Mounted once in the root layout: push init on start, token registration per login. */
export function PushSetup() {
  const uid = useUserId();

  useEffect(() => {
    let cleanup = () => {};
    initPush()
      .then((c) => (cleanup = c))
      .catch((e) => logger.warn('push: init failed', String(e)));
    return () => cleanup();
  }, []);

  useEffect(() => {
    if (uid) void registerForPush();
  }, [uid]);

  return null;
}
