import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/slate.css';
import './styles/play.css';
import './styles/app.css';
import './styles/story.css';
import './styles/features.css';
import './styles/motion.css';
import { App } from './Root';
import { app, restoreLook } from './app';

restoreLook();
void app.init();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
