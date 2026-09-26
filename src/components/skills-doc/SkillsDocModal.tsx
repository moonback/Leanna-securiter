import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, BookOpen, ExternalLink } from 'lucide-react';
import { SkillsDocumentation } from './SkillsDocumentation.js';

interface SkillsDocModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialToolName?: string;
}

export function SkillsDocModal({ isOpen, onClose, initialToolName }: SkillsDocModalProps) {
  // Touche Echap pour fermer
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-sm" style={{ zIndex: 'var(--z-modal)' as any }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="w-full max-w-8xl max-h-[92vh] flex flex-col rounded-3xl border shadow-2xl overflow-hidden"
            style={{
              backgroundColor: 'var(--bg-primary)',
              borderColor: 'var(--border-strong, var(--border-base))',
            }}
          >
            {/* Header de la modale */}
            <div
              className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                borderColor: 'var(--border-base)',
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="p-2 rounded-xl flex items-center justify-center"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)',
                    color: 'var(--accent-primary)',
                  }}
                >
                  <BookOpen className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    Documentation interactive des Skills & Outils
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Auto-générée
                    </span>
                  </h2>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Explorez les déclarations d'outils, inspectez les schémas et testez les exécutions en direct.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="p-2 rounded-xl border hover:bg-white/5 transition-colors cursor-pointer"
                  style={{ borderColor: 'var(--border-base)', color: 'var(--text-muted)' }}
                  title="Fermer (Échap)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Contenu principal défilable */}
            <div className="flex-1 overflow-y-auto p-6">
              <SkillsDocumentation embedded initialToolName={initialToolName} />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
export default SkillsDocModal;
