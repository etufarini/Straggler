import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './style.css';
import { PromptPresetsProvider } from './features/prompts/PromptPresets';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PromptPresetsProvider>
      <App />
    </PromptPresetsProvider>
  </StrictMode>,
);
