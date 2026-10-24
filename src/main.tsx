import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/app';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('React のマウント先が見つかりません');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
