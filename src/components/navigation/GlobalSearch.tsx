/**
 * Trackit X — GlobalSearch.
 *
 * The reusable search interface and its honest empty state. This phase builds
 * the FOUNDATION only: the overlay, the input, the scope copy, and the rule
 * that no invented result is ever shown. The modules search will eventually
 * cover — employees, projects, tasks, customers, vendors, inventory, documents,
 * knowledge — have no data source yet, so anything typed yields a state that
 * says so in words.
 *
 * When a searchable module lands, it registers a provider here; the UI below
 * does not change shape.
 */
import { useState } from 'react';
import { Modal as RNModal, Pressable, ScrollView, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  EmptyState,
  HStack,
  Icon,
  SearchBar,
  Text,
  useResponsive,
  useTheme,
} from '@/design-system';

import { useEscapeToClose } from './useEscapeToClose';

export interface GlobalSearchProps {
  onClose: () => void;
}

/** What global search will cover once the modules exist — shown as scope. */
const SEARCH_SCOPE: readonly { icon: 'employees' | 'projects' | 'tasks' | 'customers' | 'suppliers' | 'inventory' | 'documents' | 'knowledge'; label: string }[] = [
  { icon: 'employees', label: 'Employees' },
  { icon: 'projects', label: 'Projects' },
  { icon: 'tasks', label: 'Tasks' },
  { icon: 'customers', label: 'Customers' },
  { icon: 'suppliers', label: 'Vendors' },
  { icon: 'inventory', label: 'Inventory' },
  { icon: 'documents', label: 'Documents' },
  { icon: 'knowledge', label: 'Knowledge base' },
];

export function GlobalSearch({ onClose }: GlobalSearchProps) {
  const theme = useTheme();
  const { isCompact } = useResponsive();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  useEscapeToClose(onClose);

  const hasQuery = query.trim().length > 0;

  const panel: ViewStyle = isCompact
    ? {
        flex: 1,
        backgroundColor: theme.colors.canvas,
        paddingTop: insets.top + theme.space[3],
        paddingBottom: insets.bottom,
      }
    : {
        width: 620,
        maxWidth: '92%',
        borderRadius: theme.radius.xl,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surfaceOverlay,
        ...theme.shadows.xl,
        overflow: 'hidden',
      };

  return (
    <RNModal
      transparent
      visible
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <View style={{ flex: 1 }}>
        {!isCompact && (
          <Pressable
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            onPress={onClose}
            accessibilityLabel="Close search"
            accessibilityRole="button"
          />
        )}
        {isCompact ? (
          <View style={panel}>
            <GlobalSearchBody query={query} setQuery={setQuery} hasQuery={hasQuery} isCompact />
          </View>
        ) : (
          <View
            style={{
              position: 'absolute',
              top: insets.top + theme.space[5],
              left: 0,
              right: 0,
              alignItems: 'center',
            }}
          >
            <View style={panel}>
              <GlobalSearchBody query={query} setQuery={setQuery} hasQuery={hasQuery} isCompact={false} />
            </View>
          </View>
        )}
      </View>
    </RNModal>
  );
}

function GlobalSearchBody({
  query,
  setQuery,
  hasQuery,
  isCompact,
}: {
  query: string;
  setQuery: (value: string) => void;
  hasQuery: boolean;
  isCompact: boolean;
}) {
  const theme = useTheme();

  return (
    <>
      <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="Search your workspace…"
          size={isCompact ? 'md' : 'lg'}
          autoFocus
          accessibilityLabel="Global search"
        />
        {!hasQuery && (
          <Text variant="caption" tone="tertiary">
            Search across every module once the data behind them exists.
          </Text>
        )}
      </View>

      {hasQuery ? (
        <View style={{ padding: theme.space[4] }}>
          <EmptyState
            variant="noResults"
            icon="search"
            title="Nothing to search yet"
            description="Global search shows results from your own records. The modules it searches are not built in this phase, so nothing is returned — and nothing is invented to fill the space."
            inline
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: theme.space[4],
            gap: theme.space[1],
          }}
          showsVerticalScrollIndicator={false}
        >
          <Text variant="overline" tone="tertiary">
            Will cover
          </Text>
          {SEARCH_SCOPE.map((item) => (
            <HStack key={item.label} gap={2.5} style={{ paddingVertical: theme.space[1.5] }}>
              <Icon name={item.icon} size="md" tone="tertiary" />
              <Text variant="body">{item.label}</Text>
            </HStack>
          ))}
        </ScrollView>
      )}
    </>
  );
}