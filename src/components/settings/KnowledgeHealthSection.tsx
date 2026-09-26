import React from 'react';
import { KnowledgeHealthDashboard } from '../knowledge/KnowledgeHealthDashboard.js';

export function KnowledgeHealthSection() {
  return (
    <div className="space-y-6">
      <div className="border-b pb-4" style={{ borderColor: 'var(--border-base)' }}>
        <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
          Knowledge System & Extraction Documentaire
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Supervisez l'indexation du workspace, l'extraction automatique des documents, la mémoire projet et les métriques temps réel.
        </p>
      </div>

      <KnowledgeHealthDashboard />
    </div>
  );
}
