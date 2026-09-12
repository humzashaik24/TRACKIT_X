/**
 * Trackit X — organizations placeholder.
 *
 * Part of the Phase 29 application shell. Every module in the information
 * architecture is wired in front, and a module with no tables behind it states
 * that plainly on its own screen rather than impersonating an empty list.
 * Copy comes from the destination table so the sidebar and this screen cannot
 * describe the module differently.
 */
import { ComingNext } from '@/components/navigation/ComingNext';
import { destinationFor } from '@/navigation/destinations';

export default function OrganizationsScreen() {
  return <ComingNext destination={destinationFor('/organizations')} />;
}