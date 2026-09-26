import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Database } from 'lucide-react';
import { Section, Field } from './SettingsPrimitives.js';
import type { AuditEntry } from './constants.js';

export function AuditSection() {
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditBusy, setAuditBusy] = useState(false);

  React.useEffect(() => {
    const loadAuditEntries = async () => {
      setAuditBusy(true);
      try {
        const res = await fetch('/api/audit/logs');
        if (!res.ok) throw new Error('Unable to load audit entries');
        const data = await res.json();
        if (Array.isArray(data?.entries)) setAuditEntries(data.entries as AuditEntry[]);
      } catch { setAuditEntries([]); }
      finally { setAuditBusy(false); }
    };
    loadAuditEntries();
  }, []);

  return (
    <Section icon={Database} title="Journal d'audit" description="Suivi des opérations récentes">
      <Field label="Opérations tracées depuis l'IDE">
        <div className="rounded-xl p-3 max-h-96 overflow-y-auto custom-scrollbar"
          style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-base)' }}>
          {auditBusy && (
            <div className="flex items-center gap-2 py-4 justify-center">
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                className="w-4 h-4 border-2 rounded-full"
                style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Chargement...</span>
            </div>
          )}
          {!auditBusy && auditEntries.length === 0 && (
            <p className="text-xs text-center py-4" style={{ color: 'var(--text-dimmed)' }}>Aucune action enregistrée.</p>
          )}
          {!auditBusy && auditEntries.length > 0 && (
            <ul className="space-y-1.5">
              {auditEntries.map((entry, index) => (
                <motion.li key={`${entry.timestamp}-${index}`}
                  initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.02 }}
                  className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-base)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{entry.action}</span>
                    <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--text-dimmed)' }}>
                      {new Date(entry.timestamp).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="mt-0.5 text-sm truncate" style={{ color: 'var(--text-muted)' }}>{entry.target}</div>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </Field>
    </Section>
  );
}
