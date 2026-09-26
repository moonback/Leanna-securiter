/**
 * useOverlay — Fondations comportementales pour tous les overlays.
 *
 * Exporte trois hooks unitaires :
 *   - useFocusTrap      : piège le focus à l'intérieur d'un conteneur
 *   - useScrollLock     : verrouille le défilement du body
 *   - useEscapeStack    : gère l'empilement des gestionnaires Escape
 *   - useBackdropClick  : détecte un vrai clic sur le voile (ignore les drags)
 *
 * Et un hook composite :
 *   - useOverlay        : combine les quatre pour une modale complète
 *
 * Utilisation :
 *   const { containerRef, backdropProps } = useOverlay({ onClose, enabled });
 */

import { useCallback, useEffect, useRef } from 'react';

// ─── useFocusTrap ──────────────────────────────────────────────────────────────

/** Liste des sélecteurs d'éléments naturellement focusables */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'details > summary',
  'audio[controls]',
  'video[controls]',
].join(', ');

export interface UseFocusTrapOptions {
  /** Active ou désactive le piège */
  enabled: boolean;
  /** Mettre le focus sur le premier élément focusable à l'ouverture */
  autoFocus?: boolean;
  /** Élément sur lequel remettre le focus à la fermeture */
  returnFocusTo?: HTMLElement | null;
}

/**
 * useFocusTrap — Piège le focus dans un conteneur.
 * À la fermeture, le focus revient à returnFocusTo (ou au dernier élément
 * actif avant l'ouverture).
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  options: UseFocusTrapOptions,
) {
  const { enabled, autoFocus = true, returnFocusTo } = options;
  const containerRef = useRef<T>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Sauvegarder l'élément actif et déplacer le focus à l'ouverture
  useEffect(() => {
    if (!enabled) return;

    previousFocusRef.current = document.activeElement as HTMLElement;

    if (autoFocus) {
      // Attendre la fin de l'animation avant de déplacer le focus
      const id = requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) return;
        const first = container.querySelectorAll<HTMLElement>(FOCUSABLE)[0];
        (first ?? container).focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [enabled, autoFocus]);

  // Restituer le focus à la fermeture
  useEffect(() => {
    if (enabled) return;
    const target = returnFocusTo ?? previousFocusRef.current;
    if (target && typeof target.focus === 'function') {
      // requestAnimationFrame au lieu de setTimeout(fn, 10) :
      // reste dans le cycle de peinture du navigateur sans forcer
      // un layout supplémentaire synchrone.
      const id = requestAnimationFrame(() => target.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [enabled, returnFocusTo]);

  // Intercepter Tab / Shift+Tab pour garder le focus dans le conteneur
  useEffect(() => {
    if (!enabled) return;

    /**
     * Cache des éléments focusables : invalider via MutationObserver
     * évite de recalculer la liste (+ offsetParent layout query) à chaque
     * frappe de Tab — principale source de forced-reflow dans ce hook.
     */
    let cachedFocusable: HTMLElement[] | null = null;

    const invalidateCache = () => { cachedFocusable = null; };

    const observer = new MutationObserver(invalidateCache);
    const container = containerRef.current;
    if (container) {
      observer.observe(container, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['disabled', 'tabindex', 'hidden'],
      });
    }

    const getFocusable = (): HTMLElement[] => {
      if (cachedFocusable !== null) return cachedFocusable;
      const c = containerRef.current;
      if (!c) return [];
      // Toutes les lectures DOM sont groupées ici (batch read) —
      // aucune écriture ne les précède dans ce chemin.
      cachedFocusable = Array.from(
        c.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter(el => !el.closest('[hidden]') && el.offsetParent !== null);
      return cachedFocusable;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      // Lecture groupée : pas d'élément DOM écrit avant cette ligne
      const focusable = getFocusable();

      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();   // écriture DOM après toutes les lectures
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();  // écriture DOM après toutes les lectures
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      observer.disconnect();
      cachedFocusable = null;
    };
  }, [enabled]);

  return { containerRef };
}

// ─── useScrollLock ─────────────────────────────────────────────────────────────

/**
 * useScrollLock — Bloque le défilement du body et compense le saut de layout
 * causé par la disparition de la scrollbar.
 *
 * Utilise un compteur de référence (ref-counting) pour que plusieurs overlays
 * empilés ne se marchent pas dessus.
 */

let scrollLockCount = 0;

export function useScrollLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    if (scrollLockCount === 0) {
      // Calculer la largeur de la scrollbar avant de verrouiller
      const scrollbarWidth =
        window.innerWidth - document.documentElement.clientWidth;
      document.documentElement.style.setProperty(
        '--scrollbar-width',
        `${scrollbarWidth}px`,
      );
      document.body.classList.add('scroll-locked');
    }
    scrollLockCount++;

    return () => {
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) {
        document.body.classList.remove('scroll-locked');
        document.documentElement.style.removeProperty('--scrollbar-width');
      }
    };
  }, [enabled]);
}

// ─── useEscapeStack ────────────────────────────────────────────────────────────

/**
 * Pile LIFO des gestionnaires Escape.
 * Seul le dernier overlay enregistré reçoit l'événement Escape.
 * Les overlays plus profonds dans la pile sont ignorés.
 */
const escapeStack: Array<() => void> = [];

export interface UseEscapeStackOptions {
  /** Active ou désactive la gestion Escape */
  enabled: boolean;
  /** Callback appelé lors de l'appui sur Escape */
  onEscape: () => void;
}

export function useEscapeStack({ enabled, onEscape }: UseEscapeStackOptions) {
  // Stocker onEscape dans une ref pour éviter de re-enregistrer à chaque render
  const onEscapeRef = useRef(onEscape);
  useEffect(() => { onEscapeRef.current = onEscape; }, [onEscape]);

  useEffect(() => {
    if (!enabled) return;

    const handler = () => onEscapeRef.current();
    escapeStack.push(handler);

    const keyListener = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Seul le dernier gestionnaire dans la pile est déclenché
      const top = escapeStack[escapeStack.length - 1];
      if (top === handler) {
        e.stopPropagation();
        top();
      }
    };

    document.addEventListener('keydown', keyListener);

    return () => {
      document.removeEventListener('keydown', keyListener);
      const idx = escapeStack.lastIndexOf(handler);
      if (idx !== -1) escapeStack.splice(idx, 1);
    };
  }, [enabled]);
}

// ─── useBackdropClick ──────────────────────────────────────────────────────────

/**
 * useBackdropClick — Distingue un vrai clic sur le voile d'un glisser-déposer.
 * Un drag qui commence dans la boîte de dialogue et se termine sur le voile
 * ne doit PAS fermer la modale.
 */
export interface UseBackdropClickOptions {
  /** Active ou désactive la détection */
  enabled: boolean;
  /** Callback appelé lors d'un vrai clic sur le voile */
  onBackdropClick: () => void;
}

export function useBackdropClick({ enabled, onBackdropClick }: UseBackdropClickOptions) {
  // Enregistrer le point de départ du pointeur (mousedown)
  const pointerDownTargetRef = useRef<EventTarget | null>(null);
  const onBackdropClickRef = useRef(onBackdropClick);
  useEffect(() => { onBackdropClickRef.current = onBackdropClick; }, [onBackdropClick]);

  const onPointerDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    pointerDownTargetRef.current = e.target;
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!enabled) return;
      // Le clic doit avoir commencé ET fini sur le voile (pas dans la boîte)
      if (
        e.target === e.currentTarget &&
        pointerDownTargetRef.current === e.currentTarget
      ) {
        onBackdropClickRef.current();
      }
    },
    [enabled],
  );

  return { onPointerDown, onClick };
}

// ─── useOverlay (composite) ────────────────────────────────────────────────────

export interface UseOverlayOptions {
  /** L'overlay est-il ouvert ? */
  open: boolean;
  /** Callback de fermeture (Escape, clic voile) */
  onClose: () => void;
  /** Désactiver la fermeture par Escape */
  disableEscape?: boolean;
  /** Désactiver la fermeture par clic sur le voile */
  disableBackdropClick?: boolean;
  /** Désactiver le verrouillage du défilement */
  disableScrollLock?: boolean;
  /** Élément sur lequel remettre le focus à la fermeture */
  returnFocusTo?: HTMLElement | null;
}

/**
 * useOverlay — Hook composite qui combine :
 *   - Piège de focus
 *   - Verrou de défilement
 *   - Pile Escape
 *   - Clic voile sécurisé
 *
 * Retourne :
 *   - containerRef : à attacher à l'élément de la boîte de dialogue
 *   - backdropProps : { onPointerDown, onClick } à attacher au voile
 */
export function useOverlay<T extends HTMLElement = HTMLDivElement>(
  options: UseOverlayOptions,
) {
  const {
    open,
    onClose,
    disableEscape = false,
    disableBackdropClick = false,
    disableScrollLock = false,
    returnFocusTo,
  } = options;

  const { containerRef } = useFocusTrap<T>({
    enabled: open,
    returnFocusTo,
  });

  useScrollLock(open && !disableScrollLock);

  useEscapeStack({
    enabled: open && !disableEscape,
    onEscape: onClose,
  });

  const { onPointerDown, onClick } = useBackdropClick({
    enabled: open && !disableBackdropClick,
    onBackdropClick: onClose,
  });

  return {
    /** Ref à attacher à la boîte de dialogue (focus trap) */
    containerRef,
    /** Props à attacher au voile (clic backdrop) */
    backdropProps: { onPointerDown, onClick } as {
      onPointerDown: React.MouseEventHandler<HTMLElement>;
      onClick: React.MouseEventHandler<HTMLElement>;
    },
  };
}
