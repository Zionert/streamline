import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';

import './index.css';
import { AppToaster } from './components/layout/AppToaster';
import { routes } from './routes';
import { initTheme } from './stores/theme';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

initTheme();

const router = createBrowserRouter(routes);

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
    <AppToaster />
  </StrictMode>,
);
