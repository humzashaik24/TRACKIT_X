/**
 * Trackit X — DataTable.
 *
 * Business software is mostly tables, so this component carries most of the
 * decisions that make a table readable.
 *
 *  · IT IS TWO LAYOUTS, NOT ONE SHRUNK. From tablet up it is a real table with
 *    aligned columns. On a phone each row becomes a card with labelled fields.
 *    A horizontally-scrolling table on a 390px screen is unusable, and hiding
 *    columns silently loses data — so compact mode relabels instead.
 *  · NUMBERS ARE RIGHT-ALIGNED AND TABULAR. Column-aligned digits are the whole
 *    reason to put figures in a table; proportional digits make 1,111 and 9,999
 *    different widths and the column stops scanning.
 *  · SORT DIRECTION IS SPOKEN, NOT DRAWN. A caret alone tells a screen reader
 *    nothing, so the header's accessibility label states the current direction and
 *    what pressing it will do.
 *  · SKELETON ROWS, NOT A SPINNER. The row count is known before the data is, so
 *    the layout can be held and nothing jumps on arrival.
 *
 * Deliberately NOT here: pagination, selection, and fetching. Which page you are
 * on is application state that belongs with the query, and a table that owns its
 * own paging cannot be driven by a URL. `footer` is where a pager goes.
 */
import { useCallback } from 'react';
import { FlatList, Pressable, View, type ViewStyle } from 'react-native';

import { useResponsive } from '../hooks/useResponsive';
import { useTheme } from '../hooks/useTheme';
import { Card } from './Card';
import { Divider } from './Divider';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Icon } from './Icon';
import { Skeleton } from './Skeleton';
import { HStack, VStack } from './Stack';
import { Text } from './Text';

export type SortDirection = 'asc' | 'desc';

export interface DataTableSort {
  readonly columnKey: string;
  readonly direction: SortDirection;
}

export interface DataTableColumn<Row> {
  /** Stable column identity. Used for sorting and as the React key. */
  readonly key: string;
  readonly header: string;
  /** Flex weight in the wide layout. Defaults to 1. */
  readonly width?: number;
  /** Floor in pixels, so a narrow column does not collapse to nothing. */
  readonly minWidth?: number;
  /** Right-aligns and applies tabular figures. Use for every figure. */
  readonly numeric?: boolean;
  readonly sortable?: boolean;
  /**
   * Hidden from the stacked compact layout. Only for genuinely secondary detail —
   * anything a user needs on a phone must stay.
   */
  readonly hideOnCompact?: boolean;
  /** Shown as the card's title in compact mode. Exactly one column should set it. */
  readonly primary?: boolean;
  /** Field label in compact mode, when `header` is too terse to stand alone. */
  readonly compactLabel?: string;
  /** Renders the cell. Returning a string is fine — it is wrapped in Text. */
  readonly render: (row: Row) => React.ReactNode;
}

export interface DataTableProps<Row> {
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  /** Stable row identity. Index is not acceptable — rows reorder when sorted. */
  keyExtractor: (row: Row) => string;
  loading?: boolean;
  /** Placeholder row count while loading. Match the usual page size. */
  loadingRows?: number;
  /** Already-safe message. Never pass a raw provider error. */
  error?: string | undefined;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Current sort. The caller sorts the data; this only reflects and requests. */
  sort?: DataTableSort;
  onSortChange?: (sort: DataTableSort) => void;
  onRowPress?: (row: Row) => void;
  /** Where a pager, a total, or a row count goes. */
  footer?: React.ReactNode;
  /** Announced for the table as a whole, e.g. `'Employees'`. */
  accessibilityLabel?: string;
  style?: ViewStyle;
  /** Renders rows inline rather than in a scrolling list. For short, fixed sets. */
  scrollEnabled?: boolean;
}

/** Flips a direction, or starts a new column at the given default. */
export function nextSort(
  current: DataTableSort | undefined,
  columnKey: string,
  startWith: SortDirection = 'asc',
): DataTableSort {
  if (current?.columnKey !== columnKey) return { columnKey, direction: startWith };
  return { columnKey, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

/** Words for a sort state. The caret is reinforcement; this is the actual signal. */
function describeSort(header: string, sort: DataTableSort | undefined, columnKey: string): string {
  if (sort?.columnKey !== columnKey) return `${header}, not sorted. Activate to sort ascending.`;
  return sort.direction === 'asc'
    ? `${header}, sorted ascending. Activate to sort descending.`
    : `${header}, sorted descending. Activate to sort ascending.`;
}

/** Wraps a plain cell value in Text so callers can return strings and numbers. */
function CellContent({
  value,
  numeric,
  emphasis = false,
}: {
  value: React.ReactNode;
  numeric: boolean;
  emphasis?: boolean;
}) {
  if (typeof value === 'string' || typeof value === 'number') {
    return (
      <Text
        variant={numeric ? 'metricSm' : emphasis ? 'label' : 'bodySm'}
        tone="primary"
        numberOfLines={2}
        style={numeric ? { textAlign: 'right' } : undefined}
      >
        {value}
      </Text>
    );
  }
  return <>{value}</>;
}

export function DataTable<Row>({
  columns,
  rows,
  keyExtractor,
  loading = false,
  loadingRows = 6,
  error,
  onRetry,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  sort,
  onSortChange,
  onRowPress,
  footer,
  accessibilityLabel,
  style,
  scrollEnabled = true,
}: DataTableProps<Row>) {
  const theme = useTheme();
  const { isCompact } = useResponsive();

  const cellFlex = useCallback(
    (column: DataTableColumn<Row>): ViewStyle => ({
      flex: column.width ?? 1,
      ...(column.minWidth === undefined ? {} : { minWidth: column.minWidth }),
      alignItems: column.numeric === true ? 'flex-end' : 'flex-start',
      justifyContent: 'center',
    }),
    [],
  );

  // ── States ───────────────────────────────────────────────────────────────
  // Same fixed precedence as ChartCard, for the same reason: a table showing a
  // spinner over stale rows is ambiguous about which rows are current.
  if (error !== undefined) {
    return (
      <Card variant="raised" style={style}>
        <ErrorState inline message={error} {...(onRetry === undefined ? {} : { onRetry })} />
      </Card>
    );
  }

  if (loading) {
    return (
      <Card variant="raised" padding="none" style={style}>
        <VStack gap={0}>
          {isCompact ? null : (
            <>
              <HStack gap={3} style={{ paddingHorizontal: theme.space[4], paddingVertical: theme.space[3] }}>
                {columns.map((column) => (
                  <View key={column.key} style={cellFlex(column)}>
                    <Skeleton width="70%" height={12} corner="xs" />
                  </View>
                ))}
              </HStack>
              <Divider />
            </>
          )}
          {Array.from({ length: loadingRows }, (_, index) => (
            <View key={index}>
              <HStack
                gap={3}
                style={{ paddingHorizontal: theme.space[4], paddingVertical: theme.space[3.5] }}
              >
                {(isCompact ? columns.slice(0, 2) : columns).map((column) => (
                  <View key={column.key} style={cellFlex(column)}>
                    <Skeleton width={column.numeric === true ? '50%' : '85%'} height={14} corner="xs" />
                  </View>
                ))}
              </HStack>
              {index === loadingRows - 1 ? null : <Divider subtle />}
            </View>
          ))}
        </VStack>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card variant="raised" style={style}>
        <EmptyState
          inline
          variant="firstRun"
          title={emptyTitle}
          {...(emptyDescription === undefined ? {} : { description: emptyDescription })}
        />
      </Card>
    );
  }

  // ── Compact: one card per row ────────────────────────────────────────────
  if (isCompact) {
    const primaryColumn = columns.find((column) => column.primary === true) ?? columns[0];
    const detailColumns = columns.filter(
      (column) => column !== primaryColumn && column.hideOnCompact !== true,
    );

    const renderCard = (row: Row) => {
      const content = (
        <VStack gap={2}>
          {primaryColumn === undefined ? null : (
            <HStack gap={2} justify="space-between" align="center">
              <View style={{ flex: 1 }}>
                {/* The primary cell may render a Badge or an Avatar row, so it is
                    not wrapped in Text — only plain values get typography here. */}
                <CellContent value={primaryColumn.render(row)} numeric={false} emphasis />
              </View>
              {onRowPress === undefined ? null : (
                <Icon name="chevronRight" size="md" tone="tertiary" />
              )}
            </HStack>
          )}
          {detailColumns.length === 0 ? null : (
            <VStack gap={1}>
              {detailColumns.map((column) => (
                <HStack key={column.key} gap={3} justify="space-between" align="flex-start">
                  <Text variant="caption" tone="tertiary" style={{ flexShrink: 0 }}>
                    {column.compactLabel ?? column.header}
                  </Text>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <CellContent value={column.render(row)} numeric={column.numeric === true} />
                  </View>
                </HStack>
              ))}
            </VStack>
          )}
        </VStack>
      );

      return onRowPress === undefined ? (
        <Card variant="raised">{content}</Card>
      ) : (
        <Card
          variant="raised"
          onPress={() => {
            onRowPress(row);
          }}
        >
          {content}
        </Card>
      );
    };

    if (!scrollEnabled) {
      return (
        <VStack gap={3} style={style} accessibilityLabel={accessibilityLabel}>
          {rows.map((row) => (
            <View key={keyExtractor(row)}>{renderCard(row)}</View>
          ))}
          {footer === undefined ? null : <View>{footer}</View>}
        </VStack>
      );
    }

    return (
      <FlatList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={({ item }) => renderCard(item)}
        ItemSeparatorComponent={() => <View style={{ height: theme.space[3] }} />}
        ListFooterComponent={footer === undefined ? null : <View>{footer}</View>}
        accessibilityLabel={accessibilityLabel}
        style={style}
      />
    );
  }

  // ── Wide: a real table ───────────────────────────────────────────────────
  const header = (
    <>
      <HStack
        gap={3}
        style={{
          paddingHorizontal: theme.space[4],
          paddingVertical: theme.space[3],
          backgroundColor: theme.colors.surfaceInset,
        }}
      >
        {columns.map((column) => {
          // Derived as a value rather than a boolean so `sort` narrows cleanly.
          const activeDirection: SortDirection | undefined =
            sort !== undefined && sort.columnKey === column.key ? sort.direction : undefined;
          const isSorted = activeDirection !== undefined;
          const label = (
            <HStack gap={1} align="center">
              <Text variant="labelSm" tone={isSorted ? 'primary' : 'secondary'} numberOfLines={1}>
                {column.header}
              </Text>
              {column.sortable === true ? (
                <Icon
                  name={
                    activeDirection === undefined
                      ? 'sort'
                      : activeDirection === 'asc'
                        ? 'arrowUp'
                        : 'arrowDown'
                  }
                  size="xs"
                  tone={isSorted ? 'primary' : 'tertiary'}
                />
              ) : null}
            </HStack>
          );

          if (column.sortable !== true || onSortChange === undefined) {
            return (
              <View key={column.key} style={cellFlex(column)}>
                {label}
              </View>
            );
          }

          return (
            <Pressable
              key={column.key}
              onPress={() => {
                // Figures usually want the largest first; text wants A–Z.
                onSortChange(nextSort(sort, column.key, column.numeric === true ? 'desc' : 'asc'));
              }}
              accessibilityRole="button"
              accessibilityLabel={describeSort(column.header, sort, column.key)}
              style={cellFlex(column)}
              hitSlop={6}
            >
              {label}
            </Pressable>
          );
        })}
      </HStack>
      <Divider />
    </>
  );

  const renderRow = (row: Row) => {
    const content = (
      <HStack
        gap={3}
        style={{ paddingHorizontal: theme.space[4], paddingVertical: theme.space[3.5] }}
      >
        {columns.map((column) => (
          <View key={column.key} style={cellFlex(column)}>
            <CellContent value={column.render(row)} numeric={column.numeric === true} />
          </View>
        ))}
      </HStack>
    );

    if (onRowPress === undefined) return content;

    return (
      <Pressable
        onPress={() => {
          onRowPress(row);
        }}
        accessibilityRole="button"
        android_ripple={{ color: theme.colors.surfaceHover }}
        style={({ pressed }) => (pressed ? { backgroundColor: theme.colors.surfacePressed } : null)}
      >
        {content}
      </Pressable>
    );
  };

  return (
    <Card variant="raised" padding="none" style={style}>
      <View accessibilityLabel={accessibilityLabel}>
        {header}
        {scrollEnabled ? (
          <FlatList
            data={rows}
            keyExtractor={keyExtractor}
            renderItem={({ item }) => renderRow(item)}
            ItemSeparatorComponent={() => <Divider subtle />}
            ListFooterComponent={
              footer === undefined ? null : (
                <>
                  <Divider />
                  <View style={{ padding: theme.space[3] }}>{footer}</View>
                </>
              )
            }
          />
        ) : (
          <VStack gap={0}>
            {rows.map((row, index) => (
              <View key={keyExtractor(row)}>
                {renderRow(row)}
                {index === rows.length - 1 ? null : <Divider subtle />}
              </View>
            ))}
            {footer === undefined ? null : (
              <>
                <Divider />
                <View style={{ padding: theme.space[3] }}>{footer}</View>
              </>
            )}
          </VStack>
        )}
      </View>
    </Card>
  );
}
