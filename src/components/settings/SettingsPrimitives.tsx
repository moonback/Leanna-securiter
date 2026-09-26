import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Eye, EyeOff } from 'lucide-react';

// ─── Section wrapper ──────────────────────────────────────────────────────────

export function Section({ icon: Icon, title, description, children, badge }: {
  icon: React.FC<any>; title: string; description?: string;
  children: React.ReactNode; badge?: string;
}) {
  return (
    <section
      className="relative overflow-hidden rounded-2xl border p-4 sm:p-5"
      style={{
        backgroundColor: 'var(--bg-panel)',
        borderColor: 'var(--border-base)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: 'linear-gradient(90deg, var(--accent-primary), transparent)' }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: 'var(--accent-subtle)' }}>
              <Icon className="h-3.5 w-3.5" style={{ color: 'var(--accent-primary)' }} />
            </div>
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-primary)' }}>
                {title}
              </h2>
              {description && (
                <p className="mt-0.5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {description}
                </p>
              )}
            </div>
          </div>
        </div>
        {badge && (
          <span className="rounded-full px-2 py-0.5 text-xs font-mono font-semibold"
            style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>
            {badge}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {children}
      </div>
    </section>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────

export function SectionDivider({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      {label && (
        <span className="text-xs font-mono tracking-wider font-bold"
          style={{ color: 'var(--text-dimmed)' }}>
          {label}
        </span>
      )}
      <div className="h-px flex-1" style={{ backgroundColor: 'var(--border-base)' }} />
    </div>
  );
}

// ─── Field ───────────────────────────────────────────────────────────────────

export function Field({ label, hint, children, id, required }: {
  label: string; hint?: string; children: React.ReactNode;
  id?: string; required?: boolean;
}) {
  const generatedId = React.useId();
  const fieldId = id || generatedId;
  const hintId = `${fieldId}-hint`;

  const childrenWithAria = React.Children.map(children, child => {
    if (React.isValidElement(child)) {
      return React.cloneElement(child, {
        id: fieldId,
        'aria-describedby': hint ? hintId : undefined,
        ...(child.props as any),
      } as any);
    }
    return child;
  });

  return (
    <div className="grid grid-cols-1 gap-3 rounded-xl border border-transparent px-0 py-2 md:grid-cols-[minmax(0,220px)_1fr] md:items-start">
      <div className="flex flex-col pr-2">
        <label htmlFor={fieldId} className="text-xs font-semibold"
          style={{ color: 'var(--text-primary)' }}>
          {label}
          {required && <span className="ml-0.5" style={{ color: 'var(--color-error)' }}>*</span>}
        </label>
        {hint && (
          <p id={hintId} className="mt-0.5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {hint}
          </p>
        )}
      </div>
      <div className="md:col-span-1 flex flex-col gap-1.5 w-full">
        {childrenWithAria}
      </div>
    </div>
  );
}

// ─── TextInput ───────────────────────────────────────────────────────────────

export function TextInput({ value, onChange, placeholder, ...props }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  [key: string]: any;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl px-3 py-2 text-xs font-mono outline-none transition-all duration-150"
      style={{
        backgroundColor: 'var(--bg-input)',
        border: '1px solid var(--border-base)',
        color: 'var(--text-primary)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
      }}
      onFocus={e => {
        e.currentTarget.style.borderColor = 'var(--accent-primary)';
        e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-subtle)';
        e.currentTarget.style.backgroundColor = 'var(--bg-base)';
      }}
      onBlur={e => {
        e.currentTarget.style.borderColor = 'var(--border-base)';
        e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.02)';
        e.currentTarget.style.backgroundColor = 'var(--bg-input)';
      }}
      {...props}
    />
  );
}

// ─── SecretInput ─────────────────────────────────────────────────────────────

export function SecretInput({ value, onChange, placeholder, ...props }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  [key: string]: any;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative w-full">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? '••••••••'}
        className="w-full rounded-xl px-3 py-2 pr-8 text-xs font-mono outline-none transition-all duration-150"
        style={{
          backgroundColor: 'var(--bg-input)',
          border: '1px solid var(--border-base)',
          color: 'var(--text-primary)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
        }}
        onFocus={e => {
          e.currentTarget.style.borderColor = 'var(--accent-primary)';
          e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-subtle)';
        }}
        onBlur={e => {
          e.currentTarget.style.borderColor = 'var(--border-base)';
          e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.02)';
        }}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
        aria-label={show ? 'Masquer' : 'Afficher'}
      >
        {show
          ? <EyeOff className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
          : <Eye className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />}
      </button>
    </div>
  );
}

// ─── ToggleSwitch ─────────────────────────────────────────────────────────────

export function ToggleSwitch({ value, onChange, label, hint }: {
  value: boolean; onChange: (v: boolean) => void; label: string; hint?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 py-1.5 md:grid-cols-[minmax(0,220px)_1fr] md:items-center">
      <div className="flex flex-col pr-2">
        <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</p>
        {hint && <p className="mt-0.5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
      </div>
      <div className="md:col-span-1 flex items-center">
        <button
          type="button"
          onClick={() => onChange(!value)}
          className="relative flex-shrink-0 h-6 w-11 rounded-full border transition-all duration-150"
          style={{
            backgroundColor: value ? 'var(--accent-primary)' : 'var(--bg-secondary)',
            borderColor: value ? 'var(--accent-primary)' : 'var(--border-base)',
          }}
          role="switch"
          aria-checked={value}
          aria-label={label}
        >
          <motion.div
            className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm"
            animate={{ left: value ? 20 : 2 }}
            transition={{ type: 'spring', stiffness: 600, damping: 35 }}
          />
        </button>
      </div>
    </div>
  );
}

// ─── ChipGroup ────────────────────────────────────────────────────────────────

export function ChipGroup<T extends string>({ options, value, onChange, ...props }: {
  options: { id: T; label: string; desc?: string; flag?: string }[];
  value: T; onChange: (v: T) => void;
  [key: string]: any;
}) {
  const columns = options.length <= 3 ? 'grid-cols-3' : 'grid-cols-2';
  return (
    <div role="radiogroup" className={`grid ${columns} gap-1.5`} {...props}>
      {options.map(o => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            className="flex min-w-0 flex-col items-start rounded-xl border px-2.5 py-2 text-left text-sm transition-all duration-150"
            style={{
              backgroundColor: active ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
              borderColor: active ? 'var(--accent-primary)' : 'var(--border-base)',
              color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
              boxShadow: active ? '0 0 0 1px var(--accent-subtle)' : 'none',
            }}
          >
            <span className="truncate font-semibold">{o.flag ? `${o.flag} ${o.label}` : o.label}</span>
            {o.desc && (
              <span className="mt-0.5 truncate text-xs font-normal opacity-70 leading-tight">{o.desc}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── InfoRow ─────────────────────────────────────────────────────────────────

export function InfoRow({ label, value, mono = false }: {
  label: string; value: React.ReactNode; mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5" style={{ borderBottom: '1px solid var(--border-base)' }}>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span
        className={`text-xs ${mono ? 'font-mono' : 'font-medium'}`}
        style={{ color: 'var(--text-secondary)' }}
      >
        {value}
      </span>
    </div>
  );
}
