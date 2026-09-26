import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface ViewHeaderProps {
  /** Main title of the view */
  title: string;
  /** Lucide icon component */
  icon: LucideIcon;
  /** Short description below the title */
  description?: string;
  /** Badge text next to the title */
  badge?: string;
  /** Actions rendered on the right side */
  actions?: React.ReactNode;
}

/**
 * Unified header component for all views.
 * Ensures consistent design across the entire app.
 */
export function ViewHeader({ title, icon: Icon, description, badge, actions }: ViewHeaderProps) {
  return (
    <header
      className="flex min-h-[60px] flex-shrink-0 items-center gap-4 border-b px-5 py-3 lg:px-7"
      style={{ borderColor: 'var(--border-base)', backgroundColor: 'var(--bg-base)' }}
    >
      {/* Left — Icon + Title + Badge + Description */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: 'var(--accent-subtle)' }}
        >
          <Icon aria-hidden="true" className="h-4 w-4" style={{ color: 'var(--accent-secondary)' }} />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1
              className="truncate text-sm font-semibold tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              {title}
            </h1>
            {badge && (
              <span
                className="flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap"
                style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-secondary)' }}
              >
                {badge}
              </span>
            )}
          </div>
          {description && (
            <p
              className="mt-0.5 truncate text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              {description}
            </p>
          )}
        </div>
      </div>

      {/* Right — Actions */}
      {actions && (
        <div className="flex flex-shrink-0 items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}