import type { ExpoConfig } from 'expo/config';

const APP_ENV = process.env.APP_ENV ?? 'development';
// Release versions (Phase 9.10). Bump APP_VERSION for every store release and
// ANDROID_VERSION_CODE (+1) for every upload; app_config min/latest_app_version compare against APP_VERSION.
const APP_VERSION = process.env.APP_VERSION?.trim() || '1.0.0';
const ANDROID_VERSION_CODE = Number(process.env.ANDROID_VERSION_CODE) || 1;
const suffix = APP_ENV === 'production' ? '' : `.${APP_ENV}`;

// Google sign-in's iOS plugin needs the reversed iOS client id as a URL scheme. Only add the
// plugin once the id exists, so builds work before Google is set up (see docs/required/NEXT_STEPS.md).
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
const googleSignInPlugin: [string, { iosUrlScheme: string }][] = googleIosClientId
  ? [
      [
        '@react-native-google-signin/google-signin',
        {
          iosUrlScheme: `com.googleusercontent.apps.${googleIosClientId.replace('.apps.googleusercontent.com', '')}`,
        },
      ],
    ]
  : [];

// Android App Links: https://<web host>/p/<slug> and /c/<slug> open the app (Phase 8).
// Only when the web host is real https (not localhost); verification also needs
// web/.well-known/assetlinks.json with the release signing SHA-256 (see web/README.md).
const webUrl = process.env.EXPO_PUBLIC_WEB_URL?.trim() ?? '';
const webHost = /^https:\/\//.test(webUrl) ? new URL(webUrl).host : null;
const appLinkFilters = webHost
  ? [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: webHost, pathPrefix: '/p/' },
          { scheme: 'https', host: webHost, pathPrefix: '/c/' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ]
  : [];

// Expo push tokens need an EAS project id. Optional until push is set up (see docs/required/NEXT_STEPS.md).
const easProjectId = process.env.EAS_PROJECT_ID?.trim();

const config: ExpoConfig = {
  name: APP_ENV === 'production' ? 'NearKart' : `NearKart (${APP_ENV})`,
  slug: 'nearkart',
  scheme: 'nearkart', // nearkart://product/amul-milk-500ml
  version: APP_VERSION,
  orientation: 'portrait',
  userInterfaceStyle: 'automatic', // needed for dark mode
  icon: './assets/images/icon.png',
  ios: {
    bundleIdentifier: `in.nearkart.app${suffix}`,
    buildNumber: String(ANDROID_VERSION_CODE),
    supportsTablet: true, // tablets run Store mode
  },
  android: {
    package: `in.nearkart.app${suffix}`,
    versionCode: ANDROID_VERSION_CODE,
    // Each remaining permission comes from a feature plugin below and is asked only when used
    // (location: "Use current location"; camera: barcode scan / issue photo; mic: voice search).
    // Never needed: background location.
    blockedPermissions: [
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
    ],
    adaptiveIcon: {
      backgroundColor: '#FFFFFF',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    ...(appLinkFilters.length ? { intentFilters: appLinkFilters } : {}),
  },
  web: {
    bundler: 'metro',
    output: 'single', // web admin (Phase 7) is a plain SPA
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-secure-store',
    'expo-sqlite',
    'expo-font',
    // Store mode: barcode scanning on the stock screen (no video, so no microphone).
    [
      'expo-camera',
      {
        cameraPermission: 'NearKart uses the camera only in Store mode, to scan product barcodes.',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    // Store mode: new-order alarm (playback only).
    ['expo-audio', { recordAudioAndroid: false }],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'NearKart uses your location only when you tap "Use current location", to check delivery and fill your address.',
      },
    ],
    ...googleSignInPlugin,
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'NearKart uses the microphone only when you tap the mic to search.',
        speechRecognitionPermission: 'NearKart turns what you say into a search, on your phone.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'NearKart uses your photos only when you attach them to a problem report.',
        cameraPermission:
          'NearKart uses the camera only when you take a photo for a problem report.',
      },
    ],
    // Default channel for pushes that name none; the others are created at runtime (src/features/notifications/push.ts).
    ['expo-notifications', { color: '#0C831F', defaultChannel: 'orders' }],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0C831F',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: { appEnv: APP_ENV, ...(easProjectId ? { eas: { projectId: easProjectId } } : {}) },
};

export default config;
