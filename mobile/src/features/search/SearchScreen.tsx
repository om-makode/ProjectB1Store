import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { CartBar } from '@/features/cart/CartBar';
import { ProductGrid } from '@/features/catalog/components/ProductGrid';
import { openCategory, openProduct } from '@/features/catalog/navigation';
import { FilterBar } from '@/features/filters/FilterBar';
import { DEFAULT_SEARCH_FILTERS, filtersKey, type Filters } from '@/features/filters/filters';
import { FilterSheet } from '@/features/filters/FilterSheet';
import { useLocalize } from '@/i18n/localize';
import { useSettings } from '@/stores/settings';
import { fontFor } from '@/theme/fonts';
import { fontSize, radius, spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';
import { Chip, EmptyState, IconButton, OfflineBanner, showToast, Text } from '@/ui';

import { logSearch, type Suggestion } from './api';
import {
  MIN_QUERY,
  normalizeQuery,
  useDebouncedValue,
  useSearchResults,
  useSuggestions,
  useTrending,
} from './hooks';
import { useRecentSearches } from './recent';
import { useVoiceSearch } from './voice';

/** A search "counts" (recent + analytics) once results have been on screen this long. */
const COMMIT_AFTER_MS = 1500;

export function SearchScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const lang = useSettings((s) => s.language);
  const params = useLocalSearchParams<{ q?: string }>();

  const [text, setText] = useState(params.q ?? '');
  const q = normalizeQuery(useDebouncedValue(text, 300));
  const active = q.length >= MIN_QUERY;
  const [filters, setFilters] = useState<Filters>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);

  const results = useSearchResults(q, lang, filters);
  const suggestions = useSuggestions(q);
  const pages = results.data?.pages;
  const items = useMemo(() => pages?.flatMap((p) => p.items) ?? [], [pages]);
  const firstPage = pages?.[0];
  const loadedFor = results.isPlaceholderData ? null : q;

  const addRecent = useRecentSearches((s) => s.add);
  const committed = useRef(new Set<string>());
  const commit = (query: string, count: number) => {
    const key = `${query.toLocaleLowerCase()}|${lang}|${filtersKey(filters)}`;
    if (committed.current.has(key)) return;
    committed.current.add(key);
    if (count > 0) addRecent(query);
    logSearch(query, lang, count);
  };

  // Commit after the user has looked at the results for a moment (not on every keystroke).
  const resultCount = firstPage ? items.length + (firstPage.has_more ? 1 : 0) : 0;
  useEffect(() => {
    if (!active || loadedFor !== q || !firstPage) return;
    const id = setTimeout(() => commit(q, resultCount), COMMIT_AFTER_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, q, loadedFor, firstPage, resultCount]);

  const voice = useVoiceSearch(lang, (spoken, final) => {
    setText(spoken);
    if (final) inputRef.current?.blur();
  });
  useEffect(() => {
    if (voice.state === 'denied') showToast(t('search.voiceDenied'), 'warning');
    if (voice.state === 'error') showToast(t('search.voiceError'), 'warning');
  }, [voice.state, t]);

  const runQuery = (value: string) => {
    setText(value);
    inputRef.current?.blur();
  };

  const onSuggestion = (s: Suggestion, label: string) => {
    commit(q, resultCount);
    if (s.kind === 'category') openCategory(s.slug);
    else if (s.kind === 'product') openProduct(s.slug);
    else runQuery(label);
  };

  const zeroResults = active && loadedFor === q && !!firstPage && items.length === 0;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* Search header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingRight: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <IconButton
          icon="arrow-left"
          accessibilityLabel={t('common.back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 44,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
            paddingLeft: spacing.md,
          }}
        >
          <MaterialCommunityIcons name="magnify" size={20} color={colors.textMuted} />
          <TextInput
            ref={inputRef}
            testID="search-input"
            value={text}
            onChangeText={setText}
            autoFocus={!params.q}
            placeholder={t('search.placeholder')}
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel={t('search.title')}
            onSubmitEditing={() => {
              if (normalizeQuery(text).length >= MIN_QUERY) addRecent(text);
            }}
            style={{
              flex: 1,
              paddingHorizontal: spacing.sm,
              paddingVertical: spacing.sm,
              color: colors.text,
              fontSize: fontSize.body,
              fontFamily: fontFor('regular', 'mr'), // Devanagari family also has Latin glyphs
            }}
          />
          {text ? (
            <IconButton
              icon="close-circle"
              color="textMuted"
              size={18}
              accessibilityLabel={t('search.clearQuery')}
              onPress={() => {
                setText('');
                inputRef.current?.focus();
              }}
            />
          ) : null}
        </View>
        {voice.available ? (
          <IconButton
            icon={voice.state === 'listening' ? 'microphone' : 'microphone-outline'}
            color={voice.state === 'listening' ? 'danger' : 'primary'}
            accessibilityLabel={t('search.voice')}
            onPress={() => (voice.state === 'listening' ? voice.stop() : void voice.start())}
          />
        ) : null}
      </View>
      <OfflineBanner />
      {voice.state === 'listening' ? (
        <View style={{ padding: spacing.sm, backgroundColor: colors.accent }}>
          <Text align="center" weight="semibold" accessibilityLiveRegion="polite">
            {t('search.listening')}
          </Text>
        </View>
      ) : null}

      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {!active ? (
          <StartPanel onPick={runQuery} />
        ) : (
          <>
            <FilterBar
              config={DEFAULT_SEARCH_FILTERS}
              fields={[]}
              value={filters}
              onChange={setFilters}
              onOpenSheet={() => setFilterOpen(true)}
            />
            {zeroResults ? (
              <NoResults
                q={q}
                filtered={Object.keys(filters).length > 0}
                onClear={() => setFilters({})}
              />
            ) : (
              <ProductGrid
                products={items}
                loading={results.isPending}
                error={results.error}
                onRetry={() => void results.refetch()}
                onEndReached={() => {
                  if (results.hasNextPage && !results.isFetchingNextPage)
                    void results.fetchNextPage();
                }}
                loadingMore={results.isFetchingNextPage}
                header={
                  <ResultsHeader
                    suggestions={suggestions.data ?? []}
                    categories={firstPage?.categories ?? []}
                    onSuggestion={onSuggestion}
                  />
                }
              />
            )}
          </>
        )}
      </View>
      <CartBar />

      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        config={DEFAULT_SEARCH_FILTERS}
        fields={[]}
        value={filters}
        onApply={setFilters}
      />
    </SafeAreaView>
  );
}

/** Empty query: recent searches (on this phone) and trending searches (from the store). */
function StartPanel({ onPick }: { onPick: (q: string) => void }) {
  const { t } = useTranslation();
  const recent = useRecentSearches((s) => s.items);
  const clear = useRecentSearches((s) => s.clear);
  const trending = useTrending();
  const trend = trending.data ?? [];
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl }}
    >
      {recent.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">
              {t('search.recent')}
            </Text>
            <Pressable accessibilityRole="button" onPress={clear} hitSlop={12}>
              <Text weight="semibold" color="primary">
                {t('search.clearRecent')}
              </Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {recent.map((r) => (
              <Chip key={r} icon="history" label={r} onPress={() => onPick(r)} />
            ))}
          </View>
        </View>
      ) : null}
      {trend.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="title" accessibilityRole="header">
            {t('search.trending')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {trend.map((s) => (
              <Chip key={s} icon="trending-up" label={s} onPress={() => onPick(s)} />
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

/** Category and brand suggestions + matching categories, above the product grid. */
function ResultsHeader({
  suggestions,
  categories,
  onSuggestion,
}: {
  suggestions: Suggestion[];
  categories: { slug: string; name: Suggestion['label'] }[];
  onSuggestion: (s: Suggestion, label: string) => void;
}) {
  const l = useLocalize();
  const chips = new Map<string, { s: Suggestion; label: string }>();
  for (const c of categories)
    chips.set(`category:${c.slug}`, {
      s: { kind: 'category', slug: c.slug, label: c.name, image_path: null },
      label: l(c.name),
    });
  for (const s of suggestions)
    if (s.kind !== 'product') chips.set(`${s.kind}:${s.slug}`, { s, label: l(s.label) });
  if (chips.size === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingHorizontal: spacing.xs,
        paddingVertical: spacing.sm,
        gap: spacing.sm,
      }}
    >
      {[...chips.entries()].map(([key, { s, label }]) => (
        <Chip
          key={key}
          icon={s.kind === 'category' ? 'shape-outline' : 'tag-outline'}
          label={label}
          onPress={() => onSuggestion(s, label)}
        />
      ))}
    </ScrollView>
  );
}

/** Zero results: say so, and let the customer tell the owner what to stock. */
function NoResults({
  q,
  filtered,
  onClear,
}: {
  q: string;
  filtered: boolean;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.language);
  const [sent, setSent] = useState<string | null>(null);
  if (filtered) {
    return (
      <EmptyState
        icon="filter-remove-outline"
        title={t('search.noResults', { q })}
        message={t('catalog.noProductsMessage')}
        action={{ label: t('filters.clearAll'), onPress: onClear }}
      />
    );
  }
  return (
    <EmptyState
      icon="text-search"
      title={t('search.noResults', { q })}
      message={sent === q ? t('search.requested') : t('search.noResultsMessage')}
      action={
        sent === q
          ? undefined
          : {
              label: t('search.requestProduct', { q }),
              onPress: () => {
                logSearch(q, lang, 0, true);
                setSent(q);
                showToast(t('search.requested'), 'success');
              },
            }
      }
    />
  );
}
