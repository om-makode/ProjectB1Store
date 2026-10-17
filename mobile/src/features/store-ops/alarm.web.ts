import { Asset } from 'expo-asset';

import { logger } from '@/lib/logger';

let audio: HTMLAudioElement | null = null;
let unlocked = false;
let playing = false;

/**
 * Browsers block sound until the user interacts with the page, so the board shows an
 * "Enable sound" toggle; tapping it calls unlockAlarm() inside that click.
 */
export const alarmAvailable = () => typeof window !== 'undefined' && 'Audio' in window;
export const alarmNeedsUnlock = true;

function ensureAudio(): HTMLAudioElement | null {
  if (audio) return audio;
  if (!alarmAvailable()) return null;
  const uri = Asset.fromModule(require('../../../assets/sounds/new_order.wav')).uri;
  audio = new window.Audio(uri);
  audio.loop = true;
  return audio;
}

export async function unlockAlarm(): Promise<boolean> {
  const a = ensureAudio();
  if (!a) return false;
  try {
    a.muted = true;
    await a.play();
    a.pause();
    a.currentTime = 0;
    a.muted = false;
    unlocked = true;
    if (playing) await a.play();
    return true;
  } catch (e) {
    logger.warn('alarm: browser blocked audio', e);
    return false;
  }
}

export async function startAlarm(): Promise<void> {
  playing = true;
  const a = ensureAudio();
  if (!a || !unlocked) return;
  try {
    a.currentTime = 0;
    await a.play();
  } catch (e) {
    logger.warn('alarm: play failed', e);
  }
}

export function stopAlarm(): void {
  playing = false;
  audio?.pause();
}
