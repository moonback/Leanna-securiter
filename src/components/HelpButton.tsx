import React from 'react';
import { HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IconButton } from './ui/IconButton.js';

export function HelpButton() {
  const navigate = useNavigate();

  const handleHelp = () => {
    console.log('Affichage de l\'aide...');
    navigate('/help');
  };

  return (
    <IconButton
      icon={<HelpCircle className="w-5 h-5" />}
      tooltip="Aide & Documentation"
      onClick={handleHelp}
      aria-label="Aide et documentation"
    />
  );
}
