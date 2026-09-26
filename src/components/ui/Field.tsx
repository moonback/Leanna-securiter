/**
 * Field — Primitives de formulaire avec ARIA câblé automatiquement.
 *
 * Composants exportés :
 *   Field       — Conteneur label + champ + aide + erreur
 *   Input       — <input> stylisé, à utiliser à l'intérieur de <Field>
 *   Textarea    — <textarea> stylisé, à utiliser à l'intérieur de <Field>
 *   Select      — <select> stylisé, à utiliser à l'intérieur de <Field>
 *   FieldGroup  — Rangée horizontale de champs (ex. prénom + nom)
 *
 * Utilisation basique :
 *   <Field label="Nom" required hint="Max 64 caractères">
 *     <Input placeholder="Jean Dupont" />
 *   </Field>
 *
 * Utilisation avec erreur :
 *   <Field label="Email" error={errors.email}>
 *     <Input type="email" aria-invalid={!!errors.email} />
 *   </Field>
 *
 * Sans Field (accès direct) :
 *   <Input id="my-input" aria-label="Recherche" />
 *
 * Garanties ARIA :
 *   - htmlFor du <label> ↔ id du champ (auto-généré si absent)
 *   - aria-describedby câblé vers le texte d'aide ET le message d'erreur
 *   - aria-invalid positionné automatiquement si `error` est présent
 *   - aria-required câblé si `required` est vrai
 */

import React, {
  createContext,
  forwardRef,
  useContext,
  useId,
  type ReactNode,
} from 'react';
import { clsx } from 'clsx';
import { AlertCircle } from 'lucide-react';

// ─── Context interne ────────────────────────────────────────────────────────────

interface FieldContextValue {
  /** id du champ de saisie (généré ou fourni) */
  inputId: string;
  /** id du texte d'aide */
  hintId:  string;
  /** id du message d'erreur */
  errorId: string;
  /** Un message d'erreur est-il actif ? */
  hasError: boolean;
  /** Le champ est-il requis ? */
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

function useFieldContext() {
  return useContext(FieldContext);
}

// ─── Field ──────────────────────────────────────────────────────────────────────

export interface FieldProps {
  /** Texte du label */
  label?: string;
  /** Message d'erreur (présence active aria-invalid) */
  error?: string;
  /** Texte d'aide affiché sous le champ */
  hint?: string;
  /** Marque le champ comme requis (étoile + aria-required) */
  required?: boolean;
  /** Désactiver visuellement (grise le label) */
  disabled?: boolean;
  /** id à passer au champ de saisie enfant (auto-généré si absent) */
  inputId?: string;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  error,
  hint,
  required = false,
  disabled = false,
  inputId: providedInputId,
  children,
  className,
}: FieldProps) {
  const generatedId = useId();
  const inputId = providedInputId ?? generatedId;
  const hintId  = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const hasError = Boolean(error);

  return (
    <FieldContext.Provider value={{ inputId, hintId, errorId, hasError, required }}>
      <div className={clsx('flex flex-col gap-1.5', className)}>
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium"
            style={{
              color: disabled
                ? 'var(--text-muted)'
                : hasError
                  ? 'var(--color-error)'
                  : 'var(--text-primary)',
            }}
          >
            {label}
            {required && (
              <span
                aria-hidden="true"
                className="ml-1"
                style={{ color: 'var(--color-error)' }}
              >
                *
              </span>
            )}
          </label>
        )}

        {children}

        {/* Texte d'aide (visible uniquement en l'absence d'erreur) */}
        {hint && !hasError && (
          <p
            id={hintId}
            className="text-xs"
            style={{ color: 'var(--text-muted)' }}
          >
            {hint}
          </p>
        )}

        {/* Message d'erreur */}
        {hasError && (
          <p
            id={errorId}
            role="alert"
            className="flex items-center gap-1.5 text-xs font-medium"
            style={{ color: 'var(--color-error)' }}
          >
            <AlertCircle size={12} aria-hidden />
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

// ─── Styles communs aux champs de saisie ────────────────────────────────────────

function useFieldInputProps(
  id?: string,
  extraDescribedBy?: string,
): {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
} {
  const ctx = useFieldContext();
  // Si pas dans un Field, utiliser l'id fourni ou en générer un
  const fallbackId = useId();
  const resolvedId = id ?? ctx?.inputId ?? fallbackId;

  const parts: string[] = [];
  if (ctx?.hintId  && !ctx.hasError) parts.push(ctx.hintId);
  if (ctx?.errorId && ctx.hasError)  parts.push(ctx.errorId);
  if (extraDescribedBy)              parts.push(extraDescribedBy);

  return {
    id: resolvedId,
    'aria-describedby': parts.length > 0 ? parts.join(' ') : undefined,
    'aria-invalid': ctx?.hasError ? true : undefined,
    'aria-required': ctx?.required ? true : undefined,
  };
}

const INPUT_BASE = clsx(
  'w-full rounded-md border px-3 py-2 text-sm',
  'outline-none transition-all duration-150',
  'placeholder:text-[var(--text-muted)]',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  'focus-visible:outline-2 focus-visible:outline-offset-0',
  'focus-visible:outline-[var(--accent-primary)]',
  'focus-visible:shadow-[0_0_0_4px_var(--accent-subtle)]',
);

const inputBaseStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-input)',
  borderColor: 'var(--border-base)',
  color: 'var(--text-primary)',
};

const inputErrorStyle: React.CSSProperties = {
  borderColor: 'color-mix(in srgb, var(--color-error) 60%, transparent)',
  backgroundColor: 'color-mix(in srgb, var(--color-error) 4%, transparent)',
};

// ─── Input ──────────────────────────────────────────────────────────────────────

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Si précisé, remplace l'id auto-généré par Field */
  id?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ id, className, style, 'aria-describedby': describedBy, ...rest }, ref) {
    const ctx = useFieldContext();
    const fieldProps = useFieldInputProps(id, describedBy);

    return (
      <input
        ref={ref}
        {...fieldProps}
        className={clsx(INPUT_BASE, className)}
        style={{
          ...inputBaseStyle,
          ...(ctx?.hasError ? inputErrorStyle : {}),
          ...style,
        }}
        {...rest}
      />
    );
  },
);

// ─── Textarea ───────────────────────────────────────────────────────────────────

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  id?: string;
  /** Hauteur minimale en px (défaut : 80) */
  minHeight?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { id, className, style, minHeight = 80, 'aria-describedby': describedBy, ...rest },
    ref,
  ) {
    const ctx = useFieldContext();
    const fieldProps = useFieldInputProps(id, describedBy);

    return (
      <textarea
        ref={ref}
        {...fieldProps}
        rows={3}
        className={clsx(INPUT_BASE, 'resize-y', className)}
        style={{
          ...inputBaseStyle,
          ...(ctx?.hasError ? inputErrorStyle : {}),
          minHeight,
          ...style,
        }}
        {...rest}
      />
    );
  },
);

// ─── Select ─────────────────────────────────────────────────────────────────────

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  id?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ id, className, style, 'aria-describedby': describedBy, ...rest }, ref) {
    const ctx = useFieldContext();
    const fieldProps = useFieldInputProps(id, describedBy);

    return (
      <select
        ref={ref}
        {...fieldProps}
        className={clsx(INPUT_BASE, 'cursor-pointer', className)}
        style={{
          ...inputBaseStyle,
          ...(ctx?.hasError ? inputErrorStyle : {}),
          ...style,
        }}
        {...rest}
      />
    );
  },
);

// ─── FieldGroup ─────────────────────────────────────────────────────────────────

export interface FieldGroupProps {
  /** Champs <Field> enfants, disposés en rangée */
  children: ReactNode;
  /** Classe CSS additionnelle */
  className?: string;
  /** Légende accessible pour le groupe (affiché visuellement) */
  legend?: string;
}

/**
 * FieldGroup — Range plusieurs <Field> côte à côte.
 * Utilise un <fieldset> pour la sémantique de groupe de formulaire.
 */
export function FieldGroup({ children, className, legend }: FieldGroupProps) {
  return (
    <fieldset
      className={clsx('border-0 p-0 m-0 min-w-0', className)}
    >
      {legend && (
        <legend
          className="text-xs font-semibold mb-2 uppercase tracking-wider"
          style={{ color: 'var(--text-muted)' }}
        >
          {legend}
        </legend>
      )}
      <div className="flex flex-wrap gap-4">
        {children}
      </div>
    </fieldset>
  );
}
