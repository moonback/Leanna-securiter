import React, { useState } from 'react';
import {
  GitBranch, Plus, Trash2, ArrowDown, AlertCircle,
  HelpCircle, Settings, Layers, Code, Sparkles, X
} from 'lucide-react';
import { motion } from 'motion/react';

export interface WorkflowStepForm {
  id: string;
  action: string;
  label: string;
  argsString: string;
  onError: 'stop' | 'skip' | 'retry';
  maxRetries: number;
}

interface VisualWorkflowBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const COMMON_ACTIONS = [
  { action: 'automation_search', label: 'Recherche Web (Puppeteer)', category: 'Web' },
  { action: 'github_list_prs', label: 'Lister Pull Requests GitHub', category: 'GitHub' },
  { action: 'github_create_issue', label: 'Créer Issue GitHub', category: 'GitHub' },
  { action: 'memory_store', label: 'Enregistrer en Mémoire', category: 'Mémoire' },
  { action: 'memory_search', label: 'Rechercher en Mémoire', category: 'Mémoire' },
  { action: 'codebase_read', label: 'Lire un fichier de code', category: 'Codebase' },
  { action: 'codebase_search', label: 'Rechercher dans le code', category: 'Codebase' },
  { action: 'system_notify', label: 'Envoyer une Notification OS', category: 'Système' },
];

export function VisualWorkflowBuilder({ isOpen, onClose, onSaved }: VisualWorkflowBuilderProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [schedule, setSchedule] = useState('');
  const [steps, setSteps] = useState<WorkflowStepForm[]>([
    {
      id: 'step_1',
      action: 'automation_search',
      label: 'Rechercher les actualités',
      argsString: '{\n  "query": "Dernières nouveautés IA"\n}',
      onError: 'stop',
      maxRetries: 2
    }
  ]);
  const [selectedStepIdx, setSelectedStepIdx] = useState<number | null>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const addStep = () => {
    const newId = `step_${steps.length + 1}`;
    const newStep: WorkflowStepForm = {
      id: newId,
      action: 'memory_store',
      label: `Étape ${steps.length + 1}`,
      argsString: '{\n  "key": "result",\n  "value": "{{prev.result}}"\n}',
      onError: 'stop',
      maxRetries: 2
    };
    setSteps([...steps, newStep]);
    setSelectedStepIdx(steps.length);
  };

  const removeStep = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (steps.length <= 1) return;
    const newSteps = steps.filter((_, i) => i !== idx);
    setSteps(newSteps);
    if (selectedStepIdx === idx) {
      setSelectedStepIdx(Math.max(0, idx - 1));
    } else if (selectedStepIdx !== null && selectedStepIdx > idx) {
      setSelectedStepIdx(selectedStepIdx - 1);
    }
  };

  const updateSelectedStep = (field: keyof WorkflowStepForm, value: any) => {
    if (selectedStepIdx === null) return;
    const updated = [...steps];
    updated[selectedStepIdx] = {
      ...updated[selectedStepIdx],
      [field]: value
    };
    setSteps(updated);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Le nom du workflow est requis.');
      return;
    }
    setError(null);
    setIsSubmitting(true);

    try {
      const parsedSteps = steps.map(s => {
        let argsObj = {};
        if (s.argsString.trim()) {
          try {
            argsObj = JSON.parse(s.argsString);
          } catch (err: any) {
            throw new Error(`Erreur de syntaxe JSON dans les arguments de l'étape "${s.label}": ${err.message}`);
          }
        }
        return {
          id: s.id,
          action: s.action,
          label: s.label || s.action,
          args: argsObj,
          onError: s.onError,
          maxRetries: s.maxRetries
        };
      });

      const payload = {
        name,
        description,
        schedule: schedule.trim() || undefined,
        steps: parsedSteps
      };

      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.status === 'success') {
        onSaved();
        onClose();
      } else {
        setError(data.error || 'Erreur lors de la création du workflow');
      }
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentStep = selectedStepIdx !== null ? steps[selectedStepIdx] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        className="flex flex-col w-full max-w-5xl h-[85vh] rounded-2xl border border-[var(--border-base)] shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--bg-base)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-base)] bg-[var(--bg-panel)]">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--accent-subtle)] text-[var(--accent-primary)]">
              <GitBranch className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--text-primary)]">Créateur de Workflow Visuel</h2>
              <p className="text-xs text-[var(--text-muted)]">Assemblez des chaînes d'actions intelligentes low-code</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-ctrl)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex flex-1 min-h-0">
          {/* Left / Main Canvas Pipeline */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-[var(--border-base)] bg-[var(--bg-base)] custom-scrollbar overflow-y-auto p-6">
            {/* Form General */}
            <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl border border-[var(--border-base)] bg-[var(--bg-panel)]">
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Nom du Workflow *</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Ex: Sync Repos & Rapport Synthèse"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Planification (Ex: 30m, 24h)</label>
                <input
                  type="text"
                  value={schedule}
                  onChange={e => setSchedule(e.target.value)}
                  placeholder="Optionnel (ex: 1h)"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Décrivez ce que réalise cette chaîne d'automatisations"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                />
              </div>
            </div>

            {/* Steps Node Pipeline Visualizer */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
                <Layers className="w-4 h-4 text-[var(--accent-primary)]" />
                Pipeline d'étapes ({steps.length})
              </h3>
              <button
                onClick={addStep}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-subtle)] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)] hover:text-white transition-colors flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Ajouter une étape
              </button>
            </div>

            <div className="flex flex-col items-center gap-3 py-2">
              {steps.map((step, idx) => {
                const isSelected = selectedStepIdx === idx;
                return (
                  <React.Fragment key={step.id}>
                    <div
                      onClick={() => setSelectedStepIdx(idx)}
                      className={`w-full max-w-xl p-4 rounded-xl border cursor-pointer transition-all ${
                        isSelected
                          ? 'border-[var(--accent-primary)] shadow-lg bg-[var(--bg-panel)] ring-2 ring-[var(--accent-primary)]/20'
                          : 'border-[var(--border-base)] bg-[var(--bg-panel)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="w-7 h-7 rounded-lg bg-[var(--accent-subtle)] text-[var(--accent-primary)] flex items-center justify-center text-xs font-bold">
                            {idx + 1}
                          </span>
                          <div>
                            <h4 className="text-sm font-bold text-[var(--text-primary)]">{step.label || step.action}</h4>
                            <p className="text-xs font-mono text-[var(--text-muted)]">{step.action}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--bg-ctrl)] text-[var(--text-muted)] border border-[var(--border-base)]">
                            ID: {step.id}
                          </span>
                          {steps.length > 1 && (
                            <button
                              onClick={e => removeStep(idx, e)}
                              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                              title="Supprimer cette étape"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Code snippet preview */}
                      <div className="mt-2.5 pt-2 border-t border-[var(--border-base)] flex items-center justify-between text-xs text-[var(--text-muted)] font-mono">
                        <span className="truncate max-w-[320px]">Args: {step.argsString.replace(/\s+/g, ' ')}</span>
                        <span className={`px-1.5 py-0.5 rounded font-sans text-xs ${
                          step.onError === 'retry' ? 'bg-amber-500/10 text-amber-500' : step.onError === 'skip' ? 'bg-gray-500/10 text-gray-400' : 'bg-red-500/10 text-red-400'
                        }`}>
                          onError: {step.onError}
                        </span>
                      </div>
                    </div>

                    {idx < steps.length - 1 && (
                      <div className="flex flex-col items-center text-[var(--accent-primary)]">
                        <div className="w-0.5 h-4 bg-[var(--accent-primary)]/40"></div>
                        <ArrowDown className="w-4 h-4 my-[-2px]" />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Right Panel: Step Inspector & Configurator */}
          <div className="w-96 flex flex-col border-l border-[var(--border-base)] bg-[var(--bg-panel)] custom-scrollbar overflow-y-auto p-5">
            {currentStep ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-[var(--border-base)]">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
                    <Settings className="w-4 h-4 text-[var(--accent-primary)]" />
                    Inspecteur d'Étape ({selectedStepIdx! + 1})
                  </h3>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Identifiant d'étape (ID)</label>
                  <input
                    type="text"
                    value={currentStep.id}
                    onChange={e => updateSelectedStep('id', e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                  />
                  <p className="text-xs text-[var(--text-muted)] mt-1">Utilisable comme template: <code className="text-[var(--accent-primary)] font-mono">{`{{steps.${currentStep.id}.result}}`}</code></p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Nom / Libellé de l'étape</label>
                  <input
                    type="text"
                    value={currentStep.label}
                    onChange={e => updateSelectedStep('label', e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Action / Skill à exécuter</label>
                  <input
                    type="text"
                    value={currentStep.action}
                    onChange={e => updateSelectedStep('action', e.target.value)}
                    placeholder="Nom du skill (ex: github_list_prs)"
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] mb-2"
                  />

                  {/* Actions suggestions */}
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-[var(--text-muted)]">Actions fréquentes :</span>
                    <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto p-1 border border-[var(--border-base)] rounded-lg bg-[var(--bg-base)]">
                      {COMMON_ACTIONS.map(act => (
                        <button
                          key={act.action}
                          type="button"
                          onClick={() => {
                            updateSelectedStep('action', act.action);
                            if (!currentStep.label || currentStep.label.startsWith('Étape')) {
                              updateSelectedStep('label', act.label);
                            }
                          }}
                          className={`text-xs px-2 py-1 rounded transition-colors text-left truncate max-w-full ${
                            currentStep.action === act.action
                              ? 'bg-[var(--accent-primary)] text-white'
                              : 'bg-[var(--bg-ctrl)] text-[var(--text-secondary)] hover:bg-[var(--ctrl-hover)]'
                          }`}
                        >
                          {act.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5">
                      <Code className="w-3.5 h-3.5 text-[var(--accent-primary)]" /> Arguments (JSON)
                    </label>
                  </div>
                  <textarea
                    rows={6}
                    value={currentStep.argsString}
                    onChange={e => updateSelectedStep('argsString', e.target.value)}
                    className="w-full p-2.5 text-xs font-mono rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)] leading-relaxed"
                  />
                  <div className="p-2 rounded bg-[var(--bg-ctrl)] border border-[var(--border-base)] mt-1.5 text-xs text-[var(--text-muted)] space-y-1">
                    <p className="font-semibold text-[var(--text-secondary)]">Variables disponibles :</p>
                    <p><code className="text-[var(--accent-primary)]">{`{{prev.result}}`}</code> : Résultat étape précédente</p>
                    <p><code className="text-[var(--accent-primary)]">{`{{steps.ID.result}}`}</code> : Résultat par ID d'étape</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">En cas d'erreur</label>
                    <select
                      value={currentStep.onError}
                      onChange={e => updateSelectedStep('onError', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                    >
                      <option value="stop">Arrêter (stop)</option>
                      <option value="skip">Ignorer (skip)</option>
                      <option value="retry">Réessayer (retry)</option>
                    </select>
                  </div>

                  {currentStep.onError === 'retry' && (
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">Max Retries</label>
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={currentStep.maxRetries}
                        onChange={e => updateSelectedStep('maxRetries', Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center text-[var(--text-muted)]">
                <HelpCircle className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-xs">Sélectionnez une étape dans le pipeline pour la configurer.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Bar */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--border-base)] bg-[var(--bg-panel)]">
          {error ? (
            <div className="flex items-center gap-2 text-xs text-red-500 font-medium">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <span className="text-xs text-[var(--text-muted)]">
              {steps.length} étape{steps.length > 1 ? 's' : ''} configurée{steps.length > 1 ? 's' : ''}
            </span>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-ctrl)] transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-[var(--accent-primary)] text-white hover:opacity-90 transition-all flex items-center gap-2 shadow-md disabled:opacity-50"
            >
              {isSubmitting ? (
                <span>Création...</span>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> Sauvegarder le Workflow
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
