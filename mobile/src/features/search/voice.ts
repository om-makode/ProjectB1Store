import { requireOptionalNativeModule } from 'expo';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Lang } from '@/i18n';
import { logger } from '@/lib/logger';

type SpeechModule = typeof import('expo-speech-recognition');

/**
 * expo-speech-recognition is a native module: a dev build made before it was added
 * doesn't contain it, so load it lazily and hide the mic button instead of crashing.
 */
let speech: SpeechModule | null | undefined;
function loadSpeech(): SpeechModule | null {
  if (speech !== undefined) return speech;
  // Check the native side first: requiring the JS package when it's missing makes Metro
  // report an error even though we catch it.
  if (!requireOptionalNativeModule('ExpoSpeechRecognition')) {
    speech = null;
    return speech;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    speech = require('expo-speech-recognition') as SpeechModule;
    if (!speech.ExpoSpeechRecognitionModule.isRecognitionAvailable()) speech = null;
  } catch {
    speech = null;
  }
  return speech;
}

const LOCALES: Record<Lang, string> = { en: 'en-IN', mr: 'mr-IN', hi: 'hi-IN' };

export type VoiceState = 'idle' | 'listening' | 'denied' | 'error';

/** On-device speech → text (free; uses the phone's own recogniser). */
export function useVoiceSearch(lang: Lang, onText: (text: string, final: boolean) => void) {
  const [available] = useState(() => loadSpeech() !== null);
  const [state, setState] = useState<VoiceState>('idle');
  const cb = useRef(onText);
  useEffect(() => {
    cb.current = onText;
  }, [onText]);

  useEffect(() => {
    const mod = loadSpeech()?.ExpoSpeechRecognitionModule;
    if (!mod) return;
    const subs = [
      mod.addListener('result', (e) => {
        const text = e.results[0]?.transcript?.trim();
        if (text) cb.current(text, e.isFinal);
      }),
      mod.addListener('end', () => setState((s) => (s === 'listening' ? 'idle' : s))),
      mod.addListener('error', (e) => {
        logger.debug('speech error', e.error, e.message);
        setState(e.error === 'not-allowed' ? 'denied' : e.error === 'no-speech' ? 'idle' : 'error');
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  const start = useCallback(async () => {
    const mod = loadSpeech()?.ExpoSpeechRecognitionModule;
    if (!mod) return;
    const perm = await mod.requestPermissionsAsync();
    if (!perm.granted) {
      setState('denied');
      return;
    }
    setState('listening');
    mod.start({ lang: LOCALES[lang], interimResults: true, contextualStrings: ['atta', 'doodh'] });
  }, [lang]);

  const stop = useCallback(() => {
    loadSpeech()?.ExpoSpeechRecognitionModule.stop();
    setState('idle');
  }, []);

  return { available, state, start, stop };
}
