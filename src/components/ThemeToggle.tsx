import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext.js';
import { IconButton } from './ui/IconButton.js';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <IconButton
      variant="default"
      icon={theme === 'dark'
        ? <Sun className="w-5 h-5" />
        : <Moon className="w-5 h-5" />
      }
      onClick={toggleTheme}
      tooltip={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    />
  );
}
