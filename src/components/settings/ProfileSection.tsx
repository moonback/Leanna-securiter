import { User, AtSign, Briefcase } from 'lucide-react';
import { useProfile } from '../../context/UserProfileContext.js';
import { Section, Field, TextInput } from './SettingsPrimitives.js';

export function ProfileSection() {
  const { profile, setField } = useProfile();

  return (
    <Section
      icon={User}
      title="Qui êtes-vous ?"
      description="Les informations qui personnalisent vos échanges avec L'IA."
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Votre prénom"
          hint="L'IA vous appellera par ce prénom dans chaque conversation."
        >
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2">
              <AtSign className="h-3.5 w-3.5" style={{ color: 'var(--text-dimmed)' }} />
            </div>
            <TextInput
              value={profile.userName}
              onChange={v => setField('userName', v)}
              placeholder="Ex : Mayss"
              style={{ paddingLeft: '2rem' }}
            />
          </div>
        </Field>

        <Field
          label="Votre rôle"
          hint="Fournit le contexte professionnel à l'IA pour des réponses mieux adaptées."
        >
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2">
              <Briefcase className="h-3.5 w-3.5" style={{ color: 'var(--text-dimmed)' }} />
            </div>
            <TextInput
              value={profile.userRole}
              onChange={v => setField('userRole', v)}
              placeholder="Ex : développeur full-stack"
              style={{ paddingLeft: '2rem' }}
            />
          </div>
        </Field>
      </div>

      
    </Section>
  );
}
