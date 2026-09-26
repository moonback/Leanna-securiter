import { useHotkeys as useHotkeysLib } from 'react-hotkeys-hook';

/**
 * Thin wrapper around react-hotkeys-hook.
 * Ignores shortcuts when focus is inside an input/textarea.
 */
export function useHotkeys(
  key: string,
  handler: (e: KeyboardEvent) => void,
  deps: any[] = [],
) {
  useHotkeysLib(
    key,
    handler,
    {
      enableOnFormTags: false,
      preventDefault: true,
    },
    deps,
  );
}
