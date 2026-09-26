/**
 * documentTemplates.ts — Library of pre-built document templates for Leanna Phase 7.
 */

export interface DocumentTemplate {
  id: string;
  title: string;
  category: 'Produit' | 'Architecture' | 'Ingénierie' | 'Management' | 'Notes';
  description: string;
  iconName: string;
  badge: string;
  content: string;
  suggestedFilename: string;
  tags: string[];
}

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'mvp-specification',
    title: 'Template MVP (Minimum Viable Product)',
    category: 'Produit',
    description: 'Cadre synthétique pour cadrer la vision, le problème utilisateur, la solution proposée et les métriques de succès.',
    iconName: 'Rocket',
    badge: 'Produit',
    suggestedFilename: 'spec-mvp.md',
    tags: ['MVP', 'Vision', 'Métriques', 'Produit'],
    content: `# 🚀 Spécification MVP — {nom_projet}

**Auteur :** {auteur}  
**Date :** {date}  
**Version :** {version}  
**Statut :** En cours de rédaction  

---

## 📌 1. Vision & Contexte
Brève présentation du produit **{nom_projet}** et du problème clé qu'il cherche à résoudre.

- **Problème identifié :** {description}
- **Public cible :** {cible}
- **Proposition de valeur :** Une solution moderne et intuitive simplifiant les flux de travail quotidiens.

---

## 🎯 2. Périmètre du MVP

### Core Features (Incluses dans la v1)
- [ ] **Fonctionnalité 1 :** Description du besoin critique.
- [ ] **Fonctionnalité 2 :** Interaction utilisateur principale.
- [ ] **Fonctionnalité 3 :** Intégration / Exportation initiale.

### Out of Scope (Reporté aux versions ultérieures)
- Fonctionnalités avancées d'automatisation.
- Multi-tenancy ou rôles complexes.

---

## 📊 3. Métriques clés (KPIs)
| Indicateur | Objectif MVP | Mode de mesure |
| :--- | :---: | :--- |
| Taux d'adoption | > 70% | Analytics d'usage |
| Temps de traitement | < 2s | Logs applicatifs |
| Satisfaction (CSAT) | > 4.5/5 | Feedback utilisateurs |

---

## ⚠️ 4. Risques & Hypothèses
1. **Hypothèse majeure :** Les utilisateurs préfèrent une interface unifiée.
2. **Risque technique :** Performance du traitement en temps réel.
`,
  },
  {
    id: 'design-report',
    title: 'Template Rapport de Conception',
    category: 'Architecture',
    description: 'Document complet de conception logicielle : architecture, choix techniques, contraintes et modèle de données.',
    iconName: 'Cpu',
    badge: 'Architecture',
    suggestedFilename: 'rapport-conception.md',
    tags: ['Architecture', 'Conception', 'Choix Techniques', 'Système'],
    content: `# 🏗️ Rapport de Conception — {nom_projet}

**Auteur :** {auteur}  
**Organisme / Entreprise :** {entreprise}  
**Date :** {date}  
**Version :** {version}  

---

## 🏛️ 1. Vue d'Ensemble & Architecture
Ce document détaille les choix d'architecture logicielle pour l'application **{nom_projet}**.

- **Stack technique retenue :** {stack}
- **Pattern architectural :** Modulaire, orienté composants et services découplés.

---

## ⚙️ 2. Choix Techniques & Justifications

### Composants Principaux
1. **Frontend / UI :** React + Vite avec TailwindCSS / Vanilla CSS variables pour une thématisation dynamique rapide et réactive.
2. **Gestion de l'État :** Context API et hooks personnalisés modulaires.
3. **Backend / API :** Serveur Node.js / Express sécurisé avec injection de jetons d'accès.

### Compromis & Arbitrages (Trade-offs)
- *Choix A vs Choix B :* Retenu Choix A pour garantir une faible latence et une compatibilité hors-ligne.

---

## 🔒 3. Contraintes & Sécurité
- **Contraintes de Performance :** Rendu initial sous 500ms.
- **Sécurité des données :** Chiffrement local (AES-256) pour les secrets et tokens API.
- **Compatibilité :** Support multi-navigateurs et mode responsive tablette/mobile.

---

## 🔄 4. Modèle de Données & Flux
\`\`\`mermaid
graph TD
    User([Utilisateur]) --> UI[Interface React]
    UI --> Context[UserProfile & Theme Context]
    UI --> API[Services API Node.js]
    API --> DB[(Base de données / LocalStorage)]
\`\`\`
`,
  },
  {
    id: 'cahier-des-charges',
    title: 'Template Cahier des Charges (CdC)',
    category: 'Ingénierie',
    description: 'Spécification formelle des exigences fonctionnelles, non-fonctionnelles et critères de recette.',
    iconName: 'ClipboardList',
    badge: 'Ingénierie',
    suggestedFilename: 'cahier-des-charges.md',
    tags: ['Spécifications', 'Exigences', 'Recette', 'CDC'],
    content: `# 📋 Cahier des Charges — {nom_projet}

**Projet :** {nom_projet}  
**Client / Commanditaire :** {entreprise}  
**Rédacteur :** {auteur}  
**Date de publication :** {date}  

---

## 🎯 1. Objectifs du Projet
Présentation générale du projet **{nom_projet}** :  
{description}

---

## 🧩 2. Exigences Fonctionnelles (User Stories)

### EF-01 : Gestion du profil et des thèmes
- **En tant qu' :** utilisateur de Leanna.
- **Je veux :** personnaliser le thème d'interface (Sombre, Clair, Cyberpunk, Sepia, High Contrast) et les couleurs d'accent.
- **Afin de :** adapter mon environnement de travail à mon confort visuel.

### EF-02 : Bibliothèque de Templates Dynamiques
- **En tant qu' :** auteur ou développeur.
- **Je veux :** insérer des modèles de documents pré-remplis avec variables dynamiques.
- **Afin de :** accélérer la rédaction de spécifications techniques et de rapports.

---

## ⚡ 3. Exigences Non-Fonctionnelles
- **Performance :** Temps de réponse des interactions UI < 100ms.
- **Ergonomie :** Respect des normes WCAG AA pour le thème Haut Contraste.
- **Fiabilité :** Sauvegarde automatique locale des données utilisateur.

---

## ✅ 4. Critères de Recette
- [ ] Tous les tests unitaires et d'intégration sont au vert.
- [ ] La validation visuelle sur écrans mobiles et tablettes est validée.
- [ ] La documentation utilisateur est à jour.
`,
  },
  {
    id: 'tech-spec',
    title: 'Template Spécification Technique',
    category: 'Ingénierie',
    description: 'Spécification technique détaillée des APIs, endpoints, schémas de données et contrats d\'interface.',
    iconName: 'Code2',
    badge: 'Technique',
    suggestedFilename: 'spec-technique.md',
    tags: ['API', 'Endpoints', 'JSON Schema', 'Technique'],
    content: `# 🛠️ Spécification Technique — {nom_projet}

**Composant :** API & Modules  
**Auteur :** {auteur}  
**Date :** {date}  
**Version API :** {version}  

---

## 🌐 1. Contrats d'API & Endpoints

### POST /api/templates/render
Génère le rendu d'un template Markdown avec injection des variables.

**Request Payload :**
\`\`\`json
{
  "templateId": "design-report",
  "variables": {
    "nom_projet": "{nom_projet}",
    "auteur": "{auteur}",
    "date": "{date}"
  }
}
\`\`\`

**Response (200 OK) :**
\`\`\`json
{
  "success": true,
  "renderedContent": "# 🏗️ Rapport de Conception...",
  "wordCount": 340
}
\`\`\`

---

## 🗄️ 2. Schémas de Données

\`\`\`typescript
interface TemplatePayload {
  id: string;
  title: string;
  category: string;
  content: string;
}
\`\`\`

---

## 🔒 3. Authentification & Sécurité
- En-tête requis : \`x-Leanna-token: <TOKEN_SECRETS>\`
- Validation systématique des types de données en entrée.
`,
  },
  {
    id: 'project-plan',
    title: 'Template Plan de Projet & Roadmap',
    category: 'Management',
    description: 'Planification stratégique avec objectifs, jalons chronologiques, livrables et matrice des risques.',
    iconName: 'Calendar',
    badge: 'Management',
    suggestedFilename: 'plan-de-projet.md',
    tags: ['Roadmap', 'Jalons', 'Risques', 'Gestion de Projet'],
    content: `# 📅 Plan de Projet — {nom_projet}

**Responsable du projet :** {responsable}  
**Équipe :** {auteur}  
**Date de démarrage :** {date}  
**Version du plan :** {version}  

---

## 🚩 1. Jalons & Calendrier (Milestones)

| Phase | Description | Livrable principal | Date cible | Statut |
| :--- | :--- | :--- | :---: | :---: |
| **Phase 1** | Cadrage & Spécifications | Spécification MVP & CdC | J+7 | ✅ |
| **Phase 2** | Développement Core & UI | Prototype interactif | J+21 | 🔄 |
| **Phase 3** | Tests & Validation | Rapport de recette | J+30 | 🔲 |
| **Phase 4** | Déploiement v1.0 | Release v{version} | J+45 | 🔲 |

---

## 📦 2. Livrables Attendus
1. **Documentation technique complète :** Rapport de conception & Specs API.
2. **Code source testé :** Couverture de tests > 80%.
3. **Guide utilisateur & Changelog :** Notice d'utilisation.

---

## ⚡ 3. Matrice des Risques

| Risque | Impact | Probabilité | Plan d'atténuation |
| :--- | :---: | :---: | :--- |
| Retard d'intégration API | Élevé | Moyenne | Mocker les données API dès la Phase 1. |
| Non-conformité responsive | Moyen | Faible | Tests continus sur formats tablette/mobile. |
`,
  },
];
