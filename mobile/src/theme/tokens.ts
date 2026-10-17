// Quick-commerce palette: green for "go/add", yellow for highlights, blue for discounts.
export const palette = {
  light: {
    primary: '#0C831F',
    primaryText: '#FFFFFF', // ADD buttons, cart bar, active tab
    accent: '#F8CB46',
    accentText: '#1A1A1A', // banners, "Store open" pill
    background: '#F5F6F8',
    surface: '#FFFFFF',
    surfaceAlt: '#EEF0F3',
    text: '#1A1C1E',
    textMuted: '#5C6166',
    border: '#E2E5E9',
    success: '#16A34A',
    danger: '#C81E1E',
    warning: '#B45309',
    info: '#2563EB',
    discount: '#256FEF', // "12% OFF" tag
    veg: '#0F8A3C',
    nonVeg: '#B3261E', // FSSAI marks (always with the square/triangle shape)
    outOfStock: '#9AA0A6',
    overlay: 'rgba(0,0,0,0.45)',
    // Soft tints: selected chips, ADD outline fill, savings banner, info strips
    primarySoft: '#E8F5EA',
    accentSoft: '#FFF6D6',
    discountSoft: '#E7F0FF',
    dangerSoft: '#FDECEC',
    warningSoft: '#FFF4E0',
    hairline: '#ECEEF1',
  },
  dark: {
    primary: '#34C759',
    primaryText: '#0B1A0F',
    accent: '#F8CB46',
    accentText: '#1A1A1A',
    background: '#0E1012',
    surface: '#181B1E',
    surfaceAlt: '#22262A',
    text: '#F2F4F5',
    textMuted: '#A3A9AE',
    border: '#2C3136',
    success: '#4ADE80',
    danger: '#F87171',
    warning: '#FBBF24',
    info: '#60A5FA',
    discount: '#7AA7FF',
    veg: '#3DD07A',
    nonVeg: '#FF6B61',
    outOfStock: '#5F656B',
    overlay: 'rgba(0,0,0,0.6)',
    primarySoft: '#16301D',
    accentSoft: '#3A3216',
    discountSoft: '#1A2740',
    dangerSoft: '#3A1D1D',
    warningSoft: '#3A2C14',
    hairline: '#25292D',
  },
} as const;

export type Scheme = keyof typeof palette;
export type ColorName = keyof typeof palette.light;
export type Colors = Record<ColorName, string>;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 14, xl: 20, full: 999 } as const;

// Base sizes in sp. Multiplied by the "large text" setting (1.0 or 1.2); the OS font scale applies on top.
export const fontSize = { caption: 12, body: 15, bodyLg: 17, title: 19, h2: 22, h1: 26 } as const;
export type TextVariant = keyof typeof fontSize;

export const minTouch = 48; // dp: minimum tap target everywhere

/** Content widths for wide screens (web/tablet): customer screens are centred, not stretched. */
export const layout = {
  contentMax: 1200, // catalog, home, orders
  readableMax: 720, // forms, cart, checkout, account
  cartBarMax: 640,
} as const;

export const opacity = { pressed: 0.85, disabled: 0.4 } as const;

/**
 * Soft elevation presets that look the same on iOS (shadow*), Android (elevation) and web
 * (react-native-web maps shadow* to box-shadow). Use with `...shadow.md`.
 */
export const shadow = {
  none: {},
  sm: {
    shadowColor: '#0B1A12',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  md: {
    shadowColor: '#0B1A12',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  lg: {
    shadowColor: '#0B1A12',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
} as const;
