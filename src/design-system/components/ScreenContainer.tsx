/**
 * Trackit X — ScreenContainer.
 *
 * Every screen's outermost element. It owns the four things that go inconsistent
 * when each screen does them itself:
 *
 *  · THE GUTTER, ONCE. Exactly one horizontal padding is applied, here. Screens
 *    that also pad their sections end up with 40px of dead space on a phone, so
 *    children get the full width and pad nothing.
 *  · THE READING WIDTH. Content is centred and capped at `maxContentWidth`. A
 *    1520px cap is not a mobile layout stretched out — a table row spanning a
 *    2560px monitor cannot be scanned from label to value.
 *  · SAFE AREA. Bottom inset by default, because that is where the home indicator
 *    and the gesture bar are. The top inset is opt-in: a screen inside a router
 *    stack or tab layout already has its header inset applied, and applying it
 *    twice leaves a visible band of canvas.
 *  · SCREEN-LEVEL STATE. `loading` and `error` render full-screen rather than
 *    inside the content, so a failed screen is never a half-drawn one.
 *
 * `stickyFooter` sits OUTSIDE the scroll view and above the bottom inset — a
 * primary action that scrolls away is a primary action the user cannot find.
 *
 * Deliberately no KeyboardAvoidingView. Its correct behaviour differs by platform
 * and by whether the screen scrolls, and a wrong one is worse than none: it is the
 * component that hides the field you are typing in. Forms that need it wrap their
 * own, where the field positions are known.
 */
import { RefreshControl, ScrollView, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useResponsive } from '../hooks/useResponsive';
import { useTheme } from '../hooks/useTheme';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';

export interface ScreenContainerProps {
  children?: React.ReactNode;
  /** Set false for a screen that owns its own scrolling — a FlatList, a map. */
  scroll?: boolean;
  /**
   * Vertical gap between direct children, in PIXELS.
   *
   * Pixels rather than a spacing token because the default comes from
   * `useResponsive().sectionGap`, which is already resolved to a number for the
   * active density. Pass `theme.space[n]` for a fixed value.
   */
  gap?: number;
  /** Set false when a child must bleed to the screen edge — a full-width chart. */
  padded?: boolean;
  /** Caps the content width. `'none'` opts a wide dashboard out of the cap. */
  maxWidth?: number | 'none';
  /** Which safe-area insets to apply. Bottom only by default — see above. */
  edges?: readonly ('top' | 'bottom')[];
  /** Fixed above the scroll area: a screen title row, a filter bar, tabs. */
  header?: React.ReactNode;
  /** Fixed below it, above the bottom inset: the primary action, a total bar. */
  stickyFooter?: React.ReactNode;
  /** Replaces the content with a full-screen loading treatment. */
  loading?: boolean;
  loadingLabel?: string;
  /** Already-safe message. Replaces the content with a full-screen ErrorState. */
  error?: string | undefined;
  onRetry?: () => void;
  /** Pull-to-refresh. Both are required together for the control to appear. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Applied to the outer surface. */
  style?: ViewStyle;
  /** Applied to the centred content column. */
  contentStyle?: ViewStyle;
  testID?: string;
}

export function ScreenContainer({
  children,
  scroll = true,
  gap,
  padded = true,
  maxWidth,
  edges = ['bottom'],
  header,
  stickyFooter,
  loading = false,
  loadingLabel,
  error,
  onRetry,
  refreshing,
  onRefresh,
  style,
  contentStyle,
  testID,
}: ScreenContainerProps) {
  const theme = useTheme();
  const { screenPaddingX, sectionGap } = useResponsive();
  const insets = useSafeAreaInsets();

  const applyTop = edges.includes('top');
  const applyBottom = edges.includes('bottom');

  const horizontalPadding = padded ? screenPaddingX : 0;
  const resolvedGap = gap ?? sectionGap;
  const resolvedMaxWidth = maxWidth === 'none' ? undefined : (maxWidth ?? theme.layout.maxContentWidth);

  // The centred column. One gutter, one cap, one vertical rhythm.
  const columnStyle: ViewStyle = {
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: horizontalPadding,
    gap: resolvedGap,
    ...(resolvedMaxWidth === undefined ? {} : { maxWidth: resolvedMaxWidth }),
  };

  const content = (() => {
    if (error !== undefined) {
      return (
        <ErrorState message={error} {...(onRetry === undefined ? {} : { onRetry })} />
      );
    }
    if (loading) {
      return (
        <LoadingState
          variant="skeleton"
          fill
          {...(loadingLabel === undefined ? {} : { label: loadingLabel })}
        />
      );
    }
    return children;
  })();

  // A full-screen state fills the available space instead of sitting at the top.
  const isFullScreenState = error !== undefined || loading;

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[
        {
          paddingTop: theme.space[4],
          // The scroll content clears the bottom inset itself only when nothing
          // is pinned over it; otherwise the footer owns that space.
          paddingBottom: theme.space[6] + (stickyFooter === undefined && applyBottom ? insets.bottom : 0),
          ...(isFullScreenState ? { flexGrow: 1, justifyContent: 'center' } : {}),
        },
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        refreshing !== undefined && onRefresh !== undefined ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent.fg}
            colors={[theme.colors.accent.fg]}
            progressBackgroundColor={theme.colors.surface}
          />
        ) : undefined
      }
    >
      <View style={[columnStyle, contentStyle]}>{content}</View>
    </ScrollView>
  ) : (
    <View
      style={[
        {
          flex: 1,
          paddingTop: theme.space[4],
          ...(stickyFooter === undefined && applyBottom ? { paddingBottom: insets.bottom } : {}),
          ...(isFullScreenState ? { justifyContent: 'center' } : {}),
        },
        columnStyle,
        contentStyle,
      ]}
    >
      {content}
    </View>
  );

  return (
    <View
      testID={testID}
      style={[
        {
          flex: 1,
          backgroundColor: theme.colors.canvas,
          ...(applyTop ? { paddingTop: insets.top } : {}),
        },
        style,
      ]}
    >
      {header === undefined ? null : (
        <View style={{ paddingHorizontal: horizontalPadding, paddingTop: theme.space[3] }}>
          <View style={{ width: '100%', alignSelf: 'center', ...(resolvedMaxWidth === undefined ? {} : { maxWidth: resolvedMaxWidth }) }}>
            {header}
          </View>
        </View>
      )}

      {body}

      {stickyFooter === undefined ? null : (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: theme.colors.borderSubtle,
            backgroundColor: theme.colors.surface,
            paddingHorizontal: horizontalPadding,
            paddingTop: theme.space[3],
            // The footer, not the scroll content, clears the home indicator.
            paddingBottom: theme.space[3] + (applyBottom ? insets.bottom : 0),
          }}
        >
          <View
            style={{
              width: '100%',
              alignSelf: 'center',
              ...(resolvedMaxWidth === undefined ? {} : { maxWidth: resolvedMaxWidth }),
            }}
          >
            {stickyFooter}
          </View>
        </View>
      )}
    </View>
  );
}
