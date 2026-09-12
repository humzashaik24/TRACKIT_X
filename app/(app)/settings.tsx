/**
 * Trackit X — settings placeholder.
 *
 * Phase 29 shell. A consolidated settings screen will collect what More shows
 * today into one place. Until then this says so honestly — see
 * `organizations.tsx` for the placeholder rationale.
 */
import { ComingNext } from '@/components/navigation/ComingNext';
import { destinationFor } from '@/navigation/destinations';

export default function SettingsScreen() {
  return <ComingNext destination={destinationFor('/settings')} />;
}