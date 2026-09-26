/**
 * Button — Bouton de texte unifié.
 *
 * Remplace les 616 <button> écrits à la main dans le projet.
 * Distinct d'IconButton (qui est pour les boutons icône seuls dans les barres).
 *
 * Variantes :
 *   primary    — Accent plein (action principale)
 *   secondary  — Fond subtil + bordure (action secondaire)
 *   ghost      — Transparent, juste du texte (action tertiaire)
 *   danger     — Rouge (action destructive)
 *   danger-ghost — Rouge transparent (destructive discret)
 *
 * Tailles :
 *   xs   — 24px de haut, text-xs   (barres d'outils compactes)
 *   sm   — 30px de haut, text-sm   (panneaux, cartes)
 *   md   — 36px de haut, text-sm   (formulaires, modales) ← défaut
 *   lg   — 44px de haut, text-base (actions principales de vue)
 *
 * États :
 *   hover, focus-visible, active (scale 0.97), disabled (opacity 50%),
 *   loading (spinner, largeur conservée pour éviter le saut)
 *
 * Utilisation :
 *   <Button variant="primary" size="md" onClick={save}>Enregistrer</Button>
 *   <Button variant="danger" loading={deleting}>Supprimer</Button>
 *   <Button as="a" href="/docs" variant="ghost">Documentation</Button>
 */

import React, { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'danger-ghost';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Afficher un spinner et désactiver l'interaction */
  loading?: boolean;
  /** Icône à gauche du label */
  iconLeft?: React.ReactNode;
  /** Icône à droite du label */
  iconRight?: React.ReactNode;
  /** Rendre le bouton en pleine largeur */
  fullWidth?: boolean;
  /**
   * Rendre en tant qu'autre élément (ex. 'a' pour un lien stylisé en bouton).
   * Seul 'a' est supporté en dehors de 'button'.
   */
  as?: 'button' | 'a';
  /** Requis quand as="a" */
  href?: string;
}

// ─── Styles ─────────────────────────────────────────────────────────────────────

const BASE = [
  'inline-flex items-center justify-center gap-2',
  'rounded-md font-medium',
  'border transition-all duration-150',
  'cursor-pointer select-none',
  'focus-visible:outline-2 focus-visible:outline-offset-2',
  'focus-visible:outline-[var(--accent-primary)]',
  'focus-visible:shadow-[0_0_0_4px_var(--accent-subtle)]',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  'active:scale-[0.97]',
].join(' ');

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary: clsx(
    'border-transparent',
    'text-white',
    // background + hover inline via style — Tailwind ne peut pas interpoler les tokens CSS
    // on utilise onMouseEnter/Leave dans le composant.
  ),
  secondary: clsx(
    'bg-transparent',
  ),
  ghost: clsx(
    'border-transparent bg-transparent',
  ),
  danger: clsx(
    'border-transparent',
    'text-white',
  ),
  'danger-ghost': clsx(
    'border-transparent bg-transparent',
  ),
};

const SIZE_STYLES: Record<ButtonSize, { cls: string; iconSize: number }> = {
  xs: { cls: 'h-6    px-2   text-xs  gap-1',  iconSize: 12 },
  sm: { cls: 'h-[30px] px-3 text-sm  gap-1.5', iconSize: 14 },
  md: { cls: 'h-9    px-4   text-sm  gap-2',  iconSize: 14 },
  lg: { cls: 'h-11   px-5   text-base gap-2', iconSize: 16 },
};

// ─── Utilitaire : couleurs inline par variante ──────────────────────────────────
// On utilise des styles inline pour les variables CSS car Tailwind v4 ne peut
// pas générer de classes utilitaires pour des valeurs dynamiques de tokens.

interface VariantInlineStyle {
  base: React.CSSProperties;
  hover: React.CSSProperties;
}

const VARIANT_INLINE: Record<ButtonVariant, VariantInlineStyle> = {
  primary: {
    base: {
      backgroundColor: 'var(--accent-primary)',
      borderColor: 'transparent',
      color: 'white',
    },
    hover: {
      backgroundColor: 'var(--accent-hover)',
    },
  },
  secondary: {
    base: {
      backgroundColor: 'var(--accent-subtle)',
      borderColor: 'var(--border-base)',
      color: 'var(--text-primary)',
    },
    hover: {
      backgroundColor: 'color-mix(in srgb, var(--accent-primary) 16%, transparent)',
      borderColor: 'var(--border-strong)',
    },
  },
  ghost: {
    base: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      color: 'var(--text-secondary)',
    },
    hover: {
      backgroundColor: 'var(--ctrl-hover)',
      color: 'var(--text-primary)',
    },
  },
  danger: {
    base: {
      backgroundColor: 'var(--color-error)',
      borderColor: 'transparent',
      color: 'white',
    },
    hover: {
      backgroundColor: 'color-mix(in srgb, var(--color-error) 85%, black)',
    },
  },
  'danger-ghost': {
    base: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      color: 'var(--color-error)',
    },
    hover: {
      backgroundColor: 'var(--color-error-subtle)',
    },
  },
};

// ─── Composant ──────────────────────────────────────────────────────────────────

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'secondary',
      size = 'md',
      loading = false,
      iconLeft,
      iconRight,
      fullWidth = false,
      as: Tag = 'button',
      href,
      disabled,
      children,
      className,
      style,
      onMouseEnter,
      onMouseLeave,
      ...rest
    },
    ref,
  ) {
    const isDisabled = disabled || loading;
    const sizeConfig = SIZE_STYLES[size];
    const variantInline = VARIANT_INLINE[variant];

    // Gestion hover via state pour styles inline dynamiques
    const [hovered, setHovered] = React.useState(false);

    const computedStyle: React.CSSProperties = {
      ...variantInline.base,
      ...(hovered && !isDisabled ? variantInline.hover : {}),
      ...style,
    };

    const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
      setHovered(true);
      onMouseEnter?.(e);
    };
    const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
      setHovered(false);
      onMouseLeave?.(e);
    };

    const commonProps = {
      className: clsx(
        BASE,
        VARIANT_STYLES[variant],
        sizeConfig.cls,
        fullWidth && 'w-full',
        loading && 'cursor-wait',
        className,
      ),
      style: computedStyle,
      disabled: Tag === 'button' ? isDisabled : undefined,
      'aria-disabled': isDisabled ? true : undefined,
      onMouseEnter: handleMouseEnter as React.MouseEventHandler<HTMLButtonElement>,
      onMouseLeave: handleMouseLeave as React.MouseEventHandler<HTMLButtonElement>,
      ...rest,
    };

    const inner = (
      <>
        {loading ? (
          <Loader2
            size={sizeConfig.iconSize}
            className="animate-spin flex-shrink-0"
            aria-hidden
          />
        ) : iconLeft ? (
          <span className="flex-shrink-0" aria-hidden>
            {iconLeft}
          </span>
        ) : null}

        {/* Wrapper invisible pour conserver la largeur pendant le loading */}
        <span className={clsx(loading && 'invisible', 'leading-none')}>
          {children}
        </span>
        {/* Overlay du spinner par-dessus le label fantôme */}
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2
              size={sizeConfig.iconSize}
              className="animate-spin"
              aria-hidden
            />
          </span>
        )}

        {!loading && iconRight && (
          <span className="flex-shrink-0" aria-hidden>
            {iconRight}
          </span>
        )}
      </>
    );

    if (Tag === 'a') {
      return (
        <a
          href={href}
          className={commonProps.className}
          style={commonProps.style}
          aria-disabled={isDisabled}
          onMouseEnter={handleMouseEnter as unknown as React.MouseEventHandler<HTMLAnchorElement>}
          onMouseLeave={handleMouseLeave as unknown as React.MouseEventHandler<HTMLAnchorElement>}
        >
          {inner}
        </a>
      );
    }

    return (
      <button
        ref={ref}
        type="button"
        {...commonProps}
        // position relative nécessaire pour le spinner overlay
        style={{ ...computedStyle, position: 'relative' }}
      >
        {inner}
      </button>
    );
  },
);
