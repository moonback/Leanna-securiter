import React from 'react';
import { BookOpen } from 'lucide-react';
import { Section } from './SettingsPrimitives.js';
import { SkillsDocumentation } from '../skills-doc/SkillsDocumentation.js';

export function SkillsDocumentationSection() {
  return (
    <Section
      id="skills-doc-settings"
      icon={BookOpen}
      title="Documentation des Skills"
      description="Documentation interactive auto-générée depuis les déclarations d'outils et de skills. Explorez les paramètres, schémas et exécutez des tests en direct."
    >
      <div className="pt-2">
        <SkillsDocumentation embedded />
      </div>
    </Section>
  );
}
export default SkillsDocumentationSection;
