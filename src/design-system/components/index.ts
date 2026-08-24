/**
 * Trackit X — component barrel.
 *
 * One import site for the design system's components. Application code imports
 * from `@/design-system`; this file is what that resolves to.
 */
export { AIInsightCard, confidenceTier } from './AIInsightCard';
export type { AIInsightCardProps, ConfidenceTier, InsightKind } from './AIInsightCard';

export { Avatar, AvatarGroup, initialsFrom } from './Avatar';
export type { AvatarGroupProps, AvatarProps, PresenceStatus } from './Avatar';

export { Badge } from './Badge';
export type { BadgeIntent, BadgeProps, BadgeSize, BadgeVariant } from './Badge';

export { BottomSheet } from './BottomSheet';
export type { BottomSheetProps } from './BottomSheet';

export { Button } from './Button';
export type { ButtonIntent, ButtonProps, ButtonVariant } from './Button';

export { Card } from './Card';
export type { CardIntent, CardProps, CardVariant } from './Card';

export { ChartCard, resolveSeries } from './ChartCard';
export type { ChartCardProps, ChartSeries, ResolvedChartSeries } from './ChartCard';

export { DataTable, nextSort } from './DataTable';
export type { DataTableColumn, DataTableProps, DataTableSort, SortDirection } from './DataTable';

export { Divider } from './Divider';
export type { DividerProps } from './Divider';

export { EmptyState } from './EmptyState';
export type { EmptyStateAction, EmptyStateProps, EmptyStateVariant } from './EmptyState';

export { ErrorState } from './ErrorState';
export type { ErrorStateKind, ErrorStateProps } from './ErrorState';

export { FieldShell, hasFieldError, suppressWebOutline, useFieldBorder } from './Field';
export type { FieldShellProps } from './Field';

export { FilterBar, FilterChip } from './FilterBar';
export type { FilterBarProps, FilterChipProps, FilterOption } from './FilterBar';

export { GlassSurface } from './GlassSurface';
export type { GlassSurfaceProps } from './GlassSurface';

export { Icon, icons } from './Icon';
export type { IconName, IconProps } from './Icon';

export { IconButton } from './IconButton';
export type { IconButtonIntent, IconButtonProps, IconButtonVariant } from './IconButton';

export { Input } from './Input';
export type { InputProps } from './Input';

export { LoadingState } from './LoadingState';
export type { LoadingStateProps, LoadingVariant } from './LoadingState';

export { deltaVerdict, MetricCard, normaliseTrend } from './MetricCard';
export type { MetricCardProps, MetricDelta, MetricPolarity } from './MetricCard';

export { Modal } from './Modal';
export type { ModalIntent, ModalProps, ModalSize } from './Modal';

export { ProgressBar } from './ProgressBar';
export type { ProgressBarProps, ProgressIntent } from './ProgressBar';

export { ScreenContainer } from './ScreenContainer';
export type { ScreenContainerProps } from './ScreenContainer';

export { SearchBar } from './SearchBar';
export type { SearchBarProps } from './SearchBar';

export { Select } from './Select';
export type { SelectOption, SelectProps } from './Select';

export { Skeleton, SkeletonCard, SkeletonText } from './Skeleton';
export type { SkeletonProps } from './Skeleton';

export { HStack, Spacer, Stack, VStack } from './Stack';
export type { StackProps } from './Stack';

export { Text, toneColor } from './Text';
export type { TextProps, TextTone } from './Text';

export { ToastProvider, useToast } from './Toast';
export type { ToastAction, ToastController, ToastIntent, ToastOptions } from './Toast';
