/**
 * Trackit X — the hero action pair.
 *
 * The same two buttons open the page and close it, so they live in one component:
 * a filled gradient primary that carries the accent, and a quieter secondary beside
 * it. Keeping green on exactly one of the two is the restraint the brand asks for —
 * two green buttons side by side would make neither of them the answer.
 *
 * On a phone the pair becomes a full-width column. A row of two buttons at 390pt
 * either wraps mid-label or shrinks both below a comfortable target, and the primary
 * action is worth the whole width.
 */
import { Button, Stack, useResponsive, useTheme } from '@/design-system';

export interface HeroCTAProps {
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
  /** `lg` in the hero, `md` where the pair is a footnote to something else. */
  size?: 'md' | 'lg';
}

export function HeroCTA({
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  size = 'lg',
}: HeroCTAProps) {
  const theme = useTheme();
  const { isCompact } = useResponsive();

  return (
    <Stack
      direction={isCompact ? 'column' : 'row'}
      gap={3}
      align={isCompact ? 'stretch' : 'center'}
    >
      <Button
        label={primaryLabel}
        size={size}
        gradient
        iconRight="arrowRight"
        onPress={onPrimary}
        fullWidth={isCompact}
        // The one place the accent glow is used: it reads as the button emitting
        // light rather than as a drop shadow, which is what separates it from the
        // secondary without needing a second colour.
        style={theme.shadows.glowAccent}
      />
      <Button
        label={secondaryLabel}
        variant="secondary"
        size={size}
        onPress={onSecondary}
        fullWidth={isCompact}
      />
    </Stack>
  );
}
