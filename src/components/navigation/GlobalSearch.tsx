/**
 * Trackit X — GlobalSearch.
 *
 * The search overlay over the three data sources that exist — employees,
 * projects and tasks — all scoped to the active organization. The matching is a
 * pure function (`src/features/search/searchQuery.ts`) so it is testable without
 * a renderer, and the reading happens through the same hooks the module screens
 * use, so a result here is a record the module itself would show.
 *
 * The rule that governs the empty state is unchanged from the foundation: no
 * result is ever invented. Opening with an empty query lists the modules search
 * covers, and a term that matches nothing says so — it does not pad.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
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
  VStack,
} from '@/design-system';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useEmployeeDirectory } from '@/features/employees/useEmployeeDirectory';
import { useProjectList } from '@/features/projects/useProjects';
import {
  runGlobalSearch,
  SEARCH_GROUP_ORDER,
  isWorthSearching,
  type SearchResult,
} from '@/features/search/searchQuery';
import { useTaskList } from '@/features/tasks/useTasks';

import { useEscapeToClose } from './useEscapeToClose';

export interface GlobalSearchProps {
  onClose: () => void;
}

/** What global search covers — the three modules with real records today. */
const SEARCH_SCOPE: readonly { icon: 'employees' | 'projects' | 'tasks'; label: string }[] = [
  { icon: 'employees', label: 'Employees' },
  { icon: 'projects', label: 'Projects' },
  { icon: 'tasks', label: 'Tasks' },
];

/** One result group rendered in the overlay. */
function ResultGroup({
  title,
  results,
  onPick,
}: {
  title: string;
  results: readonly SearchResult[];
  onPick: (result: SearchResult) => void;
}) {
  const theme = useTheme();
  if (results.length === 0) return null;
  return (
    <VStack gap={1}>
      <Text variant="overline" tone="tertiary">
        {title}
      </Text>
      <VStack gap={1}>
        {results.map((result) => (
          <Pressable
            key={result.key}
            onPress={() => onPick(result)}
            accessibilityRole="button"
            accessibilityLabel={`${result.title}, ${result.subtitle}`}
            style={({ hovered }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[3],
              paddingHorizontal: theme.space[2],
              paddingVertical: theme.space[2],
              borderRadius: theme.radius.md,
              backgroundColor: hovered ? theme.colors.surfaceHover : 'transparent',
            })}
          >
            <VStack gap={0.5} style={{ flex: 1, minWidth: 0 }}>
              <Text variant="body" tone="primary" numberOfLines={1}>
                {result.title}
              </Text>
              <Text variant="caption" tone="tertiary" numberOfLines={1}>
                {result.subtitle}
              </Text>
            </VStack>
            <Icon name="chevronRight" size="sm" tone="tertiary" />
          </Pressable>
        ))}
      </VStack>
    </VStack>
  );
}

export function GlobalSearch({ onClose }: GlobalSearchProps) {
  const theme = useTheme();
  const router = useRouter();
  const { isCompact } = useResponsive();
  const insets = useSafeAreaInsets();
  const { organization } = useOrganization();
  const organizationId = organization?.id ?? null;
  const [query, setQuery] = useState('');

  useEscapeToClose(onClose);

  const directory = useEmployeeDirectory(organizationId);
  const projects = useProjectList(organizationId);
  const tasks = useTaskList(organizationId);

  const hasQuery = isWorthSearching(query);
  const results = useMemo(
    () => runGlobalSearch(query, directory.rows, projects.rows, tasks.rows),
    [query, directory.rows, projects.rows, tasks.rows],
  );

  const pick = (result: SearchResult): void => {
    onClose();
    router.push(result.path);
  };

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
            <GlobalSearchBody
              query={query}
              setQuery={setQuery}
              hasQuery={hasQuery}
              results={results}
              isCompact
              onPick={pick}
            />
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
              <GlobalSearchBody
                query={query}
                setQuery={setQuery}
                hasQuery={hasQuery}
                results={results}
                isCompact={false}
                onPick={pick}
              />
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
  results,
  isCompact,
  onPick,
}: {
  query: string;
  setQuery: (value: string) => void;
  hasQuery: boolean;
  results: ReturnType<typeof runGlobalSearch>;
  isCompact: boolean;
  onPick: (result: SearchResult) => void;
}) {
  const theme = useTheme();

  return (
    <>
      <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="Search employees, projects, tasks…"
          size={isCompact ? 'md' : 'lg'}
          autoFocus
          accessibilityLabel="Global search"
        />
        {!hasQuery && (
          <Text variant="caption" tone="tertiary">
            {'Results come from this workspace\'s own records.'}
          </Text>
        )}
      </View>

      {hasQuery && results.none ? (
        <View style={{ padding: theme.space[4], paddingTop: 0 }}>
          <EmptyState
            variant="noResults"
            icon="search"
            title="No matches in your records"
            description="Nothing in this workspace matches that term. Results are never invented to fill the space."
            inline
          />
        </View>
      ) : null}

      {hasQuery && !results.none ? (
        <ScrollView
          contentContainerStyle={{ padding: theme.space[3], paddingTop: 0, gap: theme.space[3] }}
          showsVerticalScrollIndicator={false}
          accessibilityRole="list"
          accessibilityLabel={`${results.total} search results`}
        >
          {SEARCH_GROUP_ORDER.map((group) => {
            const groupResults =
              group === 'Employee'
                ? results.employees
                : group === 'Project'
                  ? results.projects
                  : results.tasks;
            return (
              <ResultGroup
                key={group}
                title={group}
                results={groupResults}
                onPick={onPick}
              />
            );
          })}
        </ScrollView>
      ) : null}

      {!hasQuery ? (
        <ScrollView
          contentContainerStyle={{
            padding: theme.space[4],
            paddingTop: 0,
            gap: theme.space[1],
          }}
          showsVerticalScrollIndicator={false}
        >
          <Text variant="overline" tone="tertiary">
            Searches now
          </Text>
          {SEARCH_SCOPE.map((item) => (
            <HStack key={item.label} gap={2.5} style={{ paddingVertical: theme.space[1.5] }}>
              <Icon name={item.icon} size="md" tone="tertiary" />
              <Text variant="body">{item.label}</Text>
            </HStack>
          ))}
        </ScrollView>
      ) : null}
    </>
  );
}