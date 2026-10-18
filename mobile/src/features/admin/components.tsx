import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, usePathname, type Href } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Switch, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useStaffAccess } from '@/features/store-ops/hooks';
import type { LocalizedString } from '@/i18n/localize';
import { catalogImageUrl } from '@/lib/images';
import { goBack } from '@/lib/navigation';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  IconButton,
  Skeleton,
  Text,
  TextField,
  showToast,
} from '@/ui';

import { canPickImages, pickImages, uploadSimpleImage } from './images';

/** ≥ 900 px: laptop/tablet layout (two columns, wider forms). */
export function useWide() {
  return useWindowDimensions().width >= 900;
}

/** Role guard for every admin/ route. The admin_* RPCs and RLS check is_admin() again. */
export function AdminGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const access = useStaffAccess();
  if (access === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, padding: spacing.lg, gap: spacing.md }}>
        <Skeleton width="100%" height={48} />
        <Skeleton width="100%" height={160} />
      </SafeAreaView>
    );
  }
  if (access !== 'admin') {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState
          icon="shield-lock-outline"
          title={t('admin.denied')}
          message={t('admin.deniedBody')}
          action={{ label: t('storeOps.backToShop'), onPress: () => router.replace('/') }}
        />
      </SafeAreaView>
    );
  }
  return <>{children}</>;
}

const NAV: { href: Href; match: string; key: keyof typeof navIcons }[] = [
  { href: '/admin', match: '/admin', key: 'dashboard' },
  { href: '/admin/categories', match: '/admin/categories', key: 'categories' },
  { href: '/admin/products', match: '/admin/products', key: 'products' },
  { href: '/admin/merch', match: '/admin/merch', key: 'merch' },
  { href: '/admin/settings', match: '/admin/settings', key: 'settings' },
  { href: '/admin/users', match: '/admin/users', key: 'users' },
  { href: '/admin/campaigns', match: '/admin/campaigns', key: 'campaigns' },
  { href: '/admin/reviews', match: '/admin/reviews', key: 'reviews' },
  { href: '/admin/refunds', match: '/admin/refunds', key: 'refunds' },
  { href: '/admin/reports/v_sales_daily' as Href, match: '/admin/reports', key: 'reports' },
];

const navIcons = {
  dashboard: 'view-dashboard-outline',
  categories: 'shape-outline',
  products: 'package-variant-closed',
  merch: 'image-multiple-outline',
  settings: 'cog-outline',
  users: 'account-group-outline',
  campaigns: 'bullhorn-outline',
  reviews: 'star-outline',
  refunds: 'cash-refund',
  reports: 'chart-box-outline',
} as const;

const isActive = (match: string, pathname: string) =>
  match === '/admin' ? pathname === '/admin' || pathname === '/admin/' : pathname.startsWith(match);

/** Left navigation for laptop / tablet widths. */
function Sidebar({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: (nav: () => void) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="menu"
      style={{
        width: 236,
        backgroundColor: colors.surface,
        borderRightWidth: 1,
        borderRightColor: colors.border,
        paddingVertical: spacing.md,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.lg,
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.md,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name="lightning-bolt" size={22} color={colors.accentText} />
        </View>
        <View>
          <Text weight="bold">NearKart</Text>
          <Text variant="caption" color="textMuted">
            {t('admin.title')}
          </Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.sm, gap: 2 }}>
        {NAV.map((n) => {
          const active = isActive(n.match, pathname);
          return (
            <Pressable
              key={n.key}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: active }}
              onPress={() =>
                onNavigate ? onNavigate(() => router.replace(n.href)) : router.replace(n.href)
              }
              style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingHorizontal: spacing.md,
                minHeight: 44,
                borderRadius: radius.md,
                backgroundColor: active
                  ? colors.surfaceAlt
                  : hovered || pressed
                    ? colors.background
                    : 'transparent',
                borderLeftWidth: 3,
                borderLeftColor: active ? colors.primary : 'transparent',
              })}
            >
              <MaterialCommunityIcons
                name={navIcons[n.key]}
                size={20}
                color={active ? colors.primary : colors.textMuted}
              />
              <Text weight={active ? 'bold' : 'semibold'} color={active ? 'primary' : 'text'}>
                {t(`admin.nav.${n.key}`)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View
        style={{
          paddingHorizontal: spacing.sm,
          gap: 2,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          paddingTop: spacing.sm,
        }}
      >
        {(
          [
            ['/store', 'storefront-outline', t('storeOps.entry')],
            ['/', 'shopping-outline', t('storeOps.backToShop')],
          ] as const
        ).map(([href, icon, label]) => (
          <Pressable
            key={href}
            accessibilityRole="link"
            onPress={() =>
              onNavigate
                ? onNavigate(() => router.replace(href as Href))
                : router.replace(href as Href)
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingHorizontal: spacing.md,
              minHeight: 44,
            }}
          >
            <MaterialCommunityIcons name={icon} size={20} color={colors.textMuted} />
            <Text color="textMuted" weight="semibold">
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/**
 * Admin page frame: top bar + section nav, content centred at ≤ 1100 px so forms stay readable
 * on a laptop. `scroll` wraps the content in a ScrollView.
 */
export function AdminShell({
  title,
  subtitle,
  children,
  actions,
  footer,
  scroll = true,
  back,
  hasUnsavedChanges = false,
}: {
  title: string;
  /** One line under the page title (what this page is for). */
  subtitle?: string;
  children: ReactNode;
  /** Primary page action(s), shown next to the title. */
  actions?: ReactNode;
  /** Sticky bar at the bottom (e.g. Save on long forms). */
  footer?: ReactNode;
  scroll?: boolean;
  back?: Href;
  hasUnsavedChanges?: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const pathname = usePathname();
  const wide = useWide();
  const { promptDiscard } = useUnsavedChanges(hasUnsavedChanges);

  const confirmNav = (nav: () => void) => {
    if (!hasUnsavedChanges) {
      nav();
      return;
    }
    void promptDiscard().then((ok) => {
      if (ok) nav();
    });
  };

  const pageHeader = wide ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}>
      {back ? (
        <IconButton
          icon="arrow-left"
          accessibilityLabel={t('common.back')}
          onPress={() => confirmNav(() => router.replace(back))}
        />
      ) : null}
      <View style={{ flex: 1, minWidth: 220 }}>
        <Text variant="h1" weight="bold" numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text color="textMuted">{subtitle}</Text> : null}
      </View>
      {actions ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          {actions}
        </View>
      ) : null}
    </View>
  ) : subtitle ? (
    <Text color="textMuted">{subtitle}</Text>
  ) : null;

  const body = (
    <View
      style={{
        width: '100%',
        maxWidth: 1100,
        alignSelf: 'center',
        padding: wide ? spacing.xl : spacing.lg,
        gap: spacing.lg,
      }}
    >
      {pageHeader}
      {children}
    </View>
  );

  const content = (
    <View style={{ flex: 1 }}>
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: footer ? 120 : 96 }}
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{body}</View>
      )}
      {footer ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            shadowColor: '#000',
            shadowOpacity: 0.08,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: -2 },
            elevation: 8,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 1100,
              alignSelf: 'center',
              flexDirection: 'row',
              justifyContent: 'flex-end',
              gap: spacing.sm,
              padding: spacing.md,
            }}
          >
            {footer}
          </View>
        </View>
      ) : null}
    </View>
  );

  if (wide) {
    return (
      <SafeAreaView
        edges={['top']}
        style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.background }}
      >
        <Sidebar pathname={pathname} onNavigate={confirmNav} />
        {content}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: spacing.sm }}>
          <IconButton
            icon="arrow-left"
            accessibilityLabel={t('common.back')}
            onPress={() => confirmNav(() => (back ? router.replace(back) : goBack('/account')))}
          />
          <Text variant="title" style={{ flex: 1 }} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          {actions}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: spacing.md,
            gap: spacing.sm,
            paddingBottom: spacing.sm,
          }}
        >
          {NAV.map((n) => {
            const active = isActive(n.match, pathname);
            return (
              <Pressable
                key={n.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => confirmNav(() => router.replace(n.href))}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.xs,
                  paddingHorizontal: spacing.lg,
                  minHeight: 40,
                  borderRadius: radius.full,
                  backgroundColor: active ? colors.primary : colors.surfaceAlt,
                }}
              >
                <MaterialCommunityIcons
                  name={navIcons[n.key]}
                  size={18}
                  color={active ? colors.primaryText : colors.text}
                />
                <Text weight="semibold" color={active ? 'primaryText' : 'text'}>
                  {t(`admin.nav.${n.key}`)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      {content}
    </SafeAreaView>
  );
}

/** Titled card section, with optional icon and one line of helper text. */
export function Section({
  title,
  children,
  right,
  icon,
  hint,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  hint?: string;
}) {
  const { colors } = useTheme();
  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {icon ? (
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: radius.md,
                backgroundColor: colors.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialCommunityIcons name={icon} size={18} color={colors.primary} />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text variant="title" weight="bold">
              {title}
            </Text>
            {hint ? (
              <Text variant="caption" color="textMuted">
                {hint}
              </Text>
            ) : null}
          </View>
          {right}
        </View>
        {children}
      </View>
    </Card>
  );
}

/** Lay children out in up to `cols` columns on wide screens, stacked on phones. */
export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: number }) {
  const wide = useWide();
  const items = Array.isArray(children) ? children.filter(Boolean) : [children];
  if (!wide || cols === 1) return <View style={{ gap: spacing.md }}>{items}</View>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
      {items.map((c, i) => (
        <View key={i} style={{ flexBasis: `${100 / cols - 2}%`, flexGrow: 1, minWidth: 220 }}>
          {c}
        </View>
      ))}
    </View>
  );
}

/** EN / मराठी / हिंदी inputs for one {en,mr,hi} value. English is required by the server. */
export function LocalizedInput({
  label,
  value,
  onChange,
  multiline,
  error,
  requiredEn = true,
}: {
  label: string;
  value: LocalizedString | null | undefined;
  onChange: (v: LocalizedString) => void;
  multiline?: boolean;
  error?: string | null;
  requiredEn?: boolean;
}) {
  const v = value ?? {};
  const set = (k: 'en' | 'mr' | 'hi') => (text: string) => onChange({ ...v, [k]: text });
  return (
    <View style={{ gap: spacing.xs }}>
      <Grid cols={3}>
        <TextField
          label={`${label} · English${requiredEn ? ' *' : ''}`}
          value={v.en ?? ''}
          onChangeText={set('en')}
          multiline={multiline}
          error={error}
        />
        <TextField
          label={`${label} · मराठी`}
          value={v.mr ?? ''}
          onChangeText={set('mr')}
          multiline={multiline}
        />
        <TextField
          label={`${label} · हिंदी`}
          value={v.hi ?? ''}
          onChangeText={set('hi')}
          multiline={multiline}
        />
      </Grid>
    </View>
  );
}

export function SwitchRow({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 }}>
      <View style={{ flex: 1 }}>
        <Text weight="semibold">{label}</Text>
        {hint ? (
          <Text variant="caption" color="textMuted">
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: colors.primary, false: colors.border }}
      />
    </View>
  );
}

/** Label + chips: pick one value. */
export function ChoiceRow<T extends string | number | boolean | null>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="caption" weight="semibold" color="textMuted">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {options.map((o) => (
          <Chip
            key={String(o.value)}
            label={o.label}
            selected={o.value === value}
            onPress={() => onChange(o.value)}
          />
        ))}
      </View>
    </View>
  );
}

/** Small up/down arrows for list reordering (works with mouse, touch and screen readers). */
export function MoveButtons({
  onUp,
  onDown,
  disabledUp,
  disabledDown,
}: {
  onUp: () => void;
  onDown: () => void;
  disabledUp?: boolean;
  disabledDown?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row' }}>
      <IconButton
        icon="arrow-up"
        accessibilityLabel={t('admin.moveUp')}
        onPress={onUp}
        disabled={disabledUp}
      />
      <IconButton
        icon="arrow-down"
        accessibilityLabel={t('admin.moveDown')}
        onPress={onDown}
        disabled={disabledDown}
      />
    </View>
  );
}

/** Swap item i with i+dir; returns a new array. */
export function moved<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Image path field: preview + pick/replace + remove. Uploads straight to the catalog bucket. */
export function ImageField({
  label,
  path,
  onChange,
  folder,
  width = 600,
  aspect = 1,
}: {
  label: string;
  path: string | null | undefined;
  onChange: (p: string | null) => void;
  folder: 'categories' | 'banners' | 'collections' | 'brands';
  width?: number;
  aspect?: number;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const url = catalogImageUrl(path);

  const pick = async () => {
    if (!canPickImages()) {
      showToast(t('admin.needsRebuild'), 'warning');
      return;
    }
    const picked = await pickImages(false);
    if (picked === 'denied') {
      showToast(t('admin.photoDenied'), 'warning');
      return;
    }
    const first = picked[0];
    if (!first) return;
    setBusy(true);
    try {
      onChange(await uploadSimpleImage(first, folder, width));
    } catch (e) {
      showToast(t('admin.uploadFailed', { message: (e as Error).message }), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="caption" weight="semibold" color="textMuted">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View
          style={{
            width: 96,
            height: 96 / aspect,
            borderRadius: radius.md,
            backgroundColor: colors.surfaceAlt,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {url ? (
            <Image
              source={{ uri: url }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
          ) : (
            <MaterialCommunityIcons name="image-outline" size={28} color={colors.textMuted} />
          )}
        </View>
        <View style={{ gap: spacing.sm }}>
          <Button
            title={path ? t('admin.replaceImage') : t('admin.addImage')}
            icon="upload"
            variant="secondary"
            onPress={() => void pick()}
            loading={busy}
          />
          {path ? (
            <Button title={t('admin.remove')} variant="ghost" onPress={() => onChange(null)} />
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** Yes/No confirmation that works on phones (Alert) and the web admin (window.confirm). */
export { confirmAction } from '@/lib/confirm';

/** Server validation errors come back as "field: message" lines; show them as a list. */
export function ErrorList({ message }: { message: string | null }) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        borderWidth: 1,
        borderColor: colors.danger,
        borderRadius: radius.md,
        padding: spacing.md,
        gap: spacing.xs,
      }}
    >
      {message
        .split('\n')
        .filter(Boolean)
        .map((line, i) => (
          <Text key={i} color="danger">
            • {line}
          </Text>
        ))}
    </View>
  );
}

/** Number text field that keeps the typed string, syncs with external updates, and reports a parsed number (or null). */
export function NumberField({
  label,
  value,
  onChange,
  hint,
  error,
  integerOnly = false,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  hint?: string;
  error?: string | null;
  integerOnly?: boolean;
}) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));

  useEffect(() => {
    const currentNum = text.trim() === '' ? null : Number(text.replace(',', '.'));
    const propNum = value === null || value === undefined ? null : value;
    if (currentNum !== propNum) {
      setText(propNum === null ? '' : String(propNum));
    }
  }, [value, text]);

  return (
    <TextField
      label={label}
      value={text}
      keyboardType={integerOnly ? 'number-pad' : 'decimal-pad'}
      inputMode={integerOnly ? 'numeric' : 'decimal'}
      hint={hint}
      error={error}
      onChangeText={(s) => {
        const clean = integerOnly ? s.replace(/[^0-9]/g, '') : s;
        setText(clean);
        if (clean.trim() === '') {
          onChange(null);
        } else {
          const n = integerOnly ? parseInt(clean, 10) : Number(clean.replace(',', '.'));
          onChange(!Number.isFinite(n) ? null : n);
        }
      }}
    />
  );
}
