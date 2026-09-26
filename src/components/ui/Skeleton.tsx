/**
 * Skeleton — Composants de loading states
 *
 * Animations pulse pour indiquer le chargement de contenu.
 * Réutilisables à travers toute l'app.
 */

import React from 'react';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

/** Ligne de texte skeleton */
export function SkeletonLine({ className = '', style }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-md ${className}`}
      style={{ backgroundColor: 'var(--border-base)', height: '12px', ...style }}
    />
  );
}

/** Bloc rectangle skeleton */
export function SkeletonBlock({ className = '', style }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-xl ${className}`}
      style={{ backgroundColor: 'var(--border-base)', ...style }}
    />
  );
}

/** Circle skeleton (pour avatar/icône) */
export function SkeletonCircle({ className = '', style }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-full ${className}`}
      style={{ backgroundColor: 'var(--border-base)', ...style }}
    />
  );
}

/** Skeleton pour une carte de source */
export function SourceSkeleton() {
  return (
    <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-base)' }}>
      <div className="flex items-start gap-3">
        <SkeletonBlock className="w-10 h-10 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <SkeletonLine className="w-3/4" />
          <SkeletonLine className="w-full" style={{ height: '10px' }} />
          <SkeletonLine className="w-1/2" style={{ height: '10px' }} />
          <div className="flex gap-2 pt-1">
            <SkeletonBlock className="w-16 h-5 rounded-full" />
            <SkeletonBlock className="w-12 h-5 rounded-full" />
            <SkeletonBlock className="w-14 h-5 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Skeleton pour un message de chat */
export function ChatMessageSkeleton({ align = 'left' }: { align?: 'left' | 'right' }) {
  return (
    <div className={`flex ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
      <div
        className="p-4 rounded-2xl space-y-2"
        style={{
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border-base)',
          width: align === 'right' ? '40%' : '70%',
        }}
      >
        <SkeletonLine className="w-full" />
        <SkeletonLine className="w-4/5" />
        {align === 'left' && <SkeletonLine className="w-3/5" />}
      </div>
    </div>
  );
}

/** Skeleton pour une note */
export function NoteSkeleton() {
  return (
    <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-base)' }}>
      <div className="space-y-2">
        <SkeletonLine className="w-2/3" style={{ height: '14px' }} />
        <SkeletonLine className="w-full" style={{ height: '10px' }} />
        <SkeletonLine className="w-4/5" style={{ height: '10px' }} />
        <div className="flex gap-2 pt-2">
          <SkeletonBlock className="w-10 h-4 rounded" />
          <SkeletonBlock className="w-14 h-4 rounded" />
        </div>
      </div>
    </div>
  );
}

/** Skeleton pour le panel de chat complet */
export function ChatPanelSkeleton() {
  return (
    <div className="h-full flex flex-col p-5 lg:p-7 space-y-4">
      {/* Suggestions skeleton */}
      <div className="flex gap-2 flex-wrap">
        <SkeletonBlock className="w-40 h-9 rounded-xl" />
        <SkeletonBlock className="w-32 h-9 rounded-xl" />
        <SkeletonBlock className="w-36 h-9 rounded-xl" />
      </div>
      {/* Messages skeleton */}
      <div className="flex-1 space-y-4">
        <ChatMessageSkeleton align="right" />
        <ChatMessageSkeleton align="left" />
        <ChatMessageSkeleton align="right" />
        <ChatMessageSkeleton align="left" />
      </div>
    </div>
  );
}

/** Skeleton pour la liste de sources */
export function SourcesPanelSkeleton() {
  return (
    <div className="p-5 lg:p-7 space-y-4">
      {/* Header skeleton */}
      <div className="flex items-center gap-3">
        <SkeletonBlock className="w-32 h-10 rounded-xl" />
        <SkeletonBlock className="w-24 h-10 rounded-xl" />
        <SkeletonBlock className="flex-1 h-10 rounded-xl" />
      </div>
      {/* Sources */}
      <div className="space-y-3">
        <SourceSkeleton />
        <SourceSkeleton />
        <SourceSkeleton />
      </div>
    </div>
  );
}

/** Skeleton pour le panel de notes */
export function NotesPanelSkeleton() {
  return (
    <div className="p-5 lg:p-7 space-y-4">
      <div className="flex items-center gap-3">
        <SkeletonBlock className="w-32 h-10 rounded-xl" />
        <SkeletonBlock className="w-28 h-10 rounded-xl" />
        <SkeletonBlock className="flex-1 h-10 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <NoteSkeleton />
        <NoteSkeleton />
        <NoteSkeleton />
        <NoteSkeleton />
      </div>
    </div>
  );
}
