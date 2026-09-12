/**
 * Trackit X — Escape-to-close for overlay surfaces.
 *
 * Modals close on the Android back button (via `onRequestClose`); this restores
 * the equivalent on the web, where the modal has no hardware back button. Keyed
 * to Escape only, which is the one key every desktop user expects to dismiss an
 * overlay — no keyboard shortcuts are invented here.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';

export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;

    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
}