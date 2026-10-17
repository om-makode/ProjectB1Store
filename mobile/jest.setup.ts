/* eslint-disable @typescript-eslint/no-require-imports */
// In-memory replacement for expo-sqlite/kv-store (native module not available in Jest).
jest.mock('expo-sqlite/kv-store', () => {
  const map = new Map<string, string>();
  const api = {
    getItemSync: (k: string) => map.get(k) ?? null,
    setItemSync: (k: string, v: string) => void map.set(k, v),
    removeItemSync: (k: string) => map.delete(k),
    getItemAsync: async (k: string) => map.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void map.set(k, v),
    removeItemAsync: async (k: string) => map.delete(k),
    clearSync: () => map.clear(),
  };
  return { __esModule: true, default: api };
});

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-IN' }],
}));

jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

// Reanimated/worklets need native code. Minimal stand-in for what the app uses
// (Animated.View, shared values, animated styles, timing helpers, layout animations).
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  const anim = { duration: () => anim, delay: () => anim, springify: () => anim };
  return {
    __esModule: true,
    default: { View: RN.View, Text: RN.Text, ScrollView: RN.ScrollView },
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: (fn: () => object) => fn(),
    useReducedMotion: () => true,
    withTiming: (v: unknown) => v,
    withSequence: (...v: unknown[]) => v[v.length - 1],
    withRepeat: (v: unknown) => v,
    FadeInDown: anim,
    FadeIn: anim,
    FadeOut: anim,
  };
});
