import type { RouteObject } from 'react-router';

import { AppLayout } from '@/components/layout/AppLayout';
import { AuthBootstrap } from '@/features/auth/AuthBootstrap';
import { GuestRoute } from '@/features/auth/GuestRoute';
import { LoginPage } from '@/features/auth/LoginPage';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { HOME_PATH, LOGIN_PATH, REGISTER_PATH } from '@/features/auth/redirect';
import { HomePage } from '@/pages/HomePage';

export const routes: RouteObject[] = [
  {
    element: <AuthBootstrap />,
    children: [
      {
        element: <GuestRoute />,
        children: [
          { path: LOGIN_PATH, element: <LoginPage /> },
          { path: REGISTER_PATH, element: <RegisterPage /> },
        ],
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppLayout />,
            children: [{ path: HOME_PATH, element: <HomePage /> }],
          },
        ],
      },
    ],
  },
];
