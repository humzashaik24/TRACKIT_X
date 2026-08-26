/**
 * Trackit X — AI assistant placeholder.
 *
 * No chat input is rendered here, deliberately. A text box that accepts a question
 * and cannot answer it from the user's own records would either fail or answer from
 * the model's general knowledge, and the second failure mode is the dangerous one:
 * a confident answer about a business, sourced from nothing about that business.
 * The assistant ships when there is data to ground it in.
 */
import { ComingNext } from '@/components/navigation/ComingNext';
import { destinationFor } from '@/navigation/destinations';

export default function AIScreen() {
  return <ComingNext destination={destinationFor('/ai')} />;
}
