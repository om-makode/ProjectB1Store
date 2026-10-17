import { hasExpoModule } from '@/lib/nativeOptional';
import { logger } from '@/lib/logger';

type Player = {
  loop: boolean;
  play(): void;
  pause(): void;
  seekTo(s: number): Promise<void>;
  remove(): void;
};

let player: Player | null = null;
let playing = false;

/**
 * New-order alarm on phones/tablets (expo-audio). Plays even in silent mode so a busy counter
 * never misses an order. expo-audio is a native module: until the dev build is rebuilt it's
 * missing, and the alarm silently falls back to vibration only.
 */
export const alarmAvailable = () => hasExpoModule('ExpoAudio');

/** Native needs no user gesture to play. */
export const alarmNeedsUnlock = false;

async function ensurePlayer(): Promise<Player | null> {
  if (player) return player;
  if (!alarmAvailable()) return null;
  try {
    const audio = await import('expo-audio');
    await audio.setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' });
    const p = audio.createAudioPlayer(require('../../../assets/sounds/new_order.wav'));
    p.loop = true;
    player = p as unknown as Player;
    return player;
  } catch (e) {
    logger.warn('alarm: audio unavailable', e);
    return null;
  }
}

export async function unlockAlarm(): Promise<boolean> {
  return (await ensurePlayer()) !== null;
}

export async function startAlarm(): Promise<void> {
  if (playing) return;
  const p = await ensurePlayer();
  if (!p) return;
  playing = true;
  await p.seekTo(0).catch(() => {});
  p.play();
}

export function stopAlarm(): void {
  if (!playing || !player) return;
  playing = false;
  player.pause();
}
