/**
 * ImportToNotebookExample — Exemple d'utilisation des composants d'import
 * 
 * Ce fichier montre comment utiliser les différents composants et hooks
 * pour importer dans un notebook avec création automatique.
 */

import React from 'react';
import { ImportToNotebookButton, importToNotebookAction } from './ImportToNotebookButton.js';
import { useNotebookId } from '../../hooks/index.js';

// Exemple 1: Bouton simple avec création automatique
function SimpleImportButtonExample() {
  return (
    <div className="p-4 border rounded-lg">
      <h3 className="text-sm font-semibold mb-2">Exemple 1: Bouton simple</h3>
      <p className="text-xs text-muted mb-3">
        Bouton qui ouvre un sélecteur de fichier et crée automatiquement un notebook si nécessaire.
      </p>
      <ImportToNotebookButton 
        onImported={(notebookId, filePath) => {
          console.log(`Fichier importé dans le notebook ${notebookId}`);
        }}
        autoCreate={true}
      />
    </div>
  );
}

// Exemple 2: Bouton compact
function CompactImportButtonExample() {
  return (
    <div className="p-4 border rounded-lg">
      <h3 className="text-sm font-semibold mb-2">Exemple 2: Bouton compact</h3>
      <p className="text-xs text-muted mb-3">
        Version compacte pour les barres d'outils.
      </p>
      <ImportToNotebookButton 
        compact={true}
        autoCreate={true}
      >
        Importer
      </ImportToNotebookButton>
    </div>
  );
}

// Exemple 3: Utilisation du hook useNotebookId
function UseNotebookIdExample() {
  const { notebookId, loading } = useNotebookId({
    defaultTitle: 'Mon notebook par défaut',
    defaultDescription: 'Notebook créé pour mes imports',
  });

  if (loading) {
    return <div>Chargement...</div>;
  }

  return (
    <div className="p-4 border rounded-lg">
      <h3 className="text-sm font-semibold mb-2">Exemple 3: Utilisation du hook</h3>
      <p className="text-xs text-muted mb-3">
        Le hook garantit qu'un notebook existe et retourne son ID.
      </p>
      <div className="text-sm">
        Notebook ID: <code className="bg-gray-100 px-2 py-1 rounded">{notebookId || 'Aucun'}</code>
      </div>
    </div>
  );
}

// Exemple 4: Zone de drop complète
function DropZoneExample() {
  return (
    <div className="p-4 border rounded-lg">
      <h3 className="text-sm font-semibold mb-2">Exemple 4: Zone de drop</h3>
      <p className="text-xs text-muted mb-3">
        Zone de drop avec création automatique de notebook.
      </p>
      <ImportToNotebookButton 
        compact={false}
        autoCreate={true}
      />
    </div>
  );
}

// Exemple 5: Utilisation de la fonction importToNotebookAction
async function programmaticImportExample(filePath: string, fileName: string) {
  try {
    const notebookId = await importToNotebookAction({
      filePath,
      fileName,
      autoCreate: true,
      onComplete: (id) => {
        console.log(`Import terminé dans le notebook: ${id}`);
      }
    });
    
    if (notebookId) {
      console.log(`Fichier importé avec succès dans: ${notebookId}`);
    } else {
      console.log(`L'import a échoué`);
    }
  } catch (error) {
    console.error('Erreur lors de l\'import:', error);
  }
}

// Composant principal d'exemple
export function ImportToNotebookExamples() {
  return (
    <div className="space-y-4 p-6">
      <h2 className="text-lg font-semibold">Exemples d'import dans un notebook</h2>
      <p className="text-sm text-muted">
        Ces exemples montrent comment utiliser les différents composants et hooks
        pour importer des fichiers dans un notebook, avec création automatique
        si aucun notebook n'existe.
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        <SimpleImportButtonExample />
        <CompactImportButtonExample />
        <UseNotebookIdExample />
        <DropZoneExample />
      </div>
      
      <div className="mt-6 p-4 border rounded-lg">
        <h3 className="text-sm font-semibold mb-2">Exemple 5: Import programmatique</h3>
        <p className="text-xs text-muted mb-3">
          Utilisation de la fonction <code>importToNotebookAction</code> pour un import direct.
        </p>
        <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto">
{`async function importFile() {
  const result = await importToNotebookAction({
    filePath: '/path/to/file.txt',
    fileName: 'file.txt',
    autoCreate: true
  });
}`}
        </pre>
      </div>
    </div>
  );
}

export default ImportToNotebookExamples;
