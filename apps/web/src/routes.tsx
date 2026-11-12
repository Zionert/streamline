import { Navigate, type RouteObject } from 'react-router';

import { AppLayout } from '@/components/layout/AppLayout';
import { AuthBootstrap } from '@/features/auth/AuthBootstrap';
import { GuestRoute } from '@/features/auth/GuestRoute';
import { LoginPage } from '@/features/auth/LoginPage';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { HOME_PATH, LOGIN_PATH, REGISTER_PATH } from '@/features/auth/redirect';
import { BoardPage } from '@/features/boards/BoardPage';
import { BoardsPage } from '@/features/boards/BoardsPage';
import { BOARDS_PATH, BOARD_PATH_PATTERN, CARD_ROUTE_PATH } from '@/features/boards/paths';
import { CardDetailsRoute } from '@/features/cards/CardDetailsRoute';

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
            children: [
              { path: '/', element: <Navigate to={HOME_PATH} replace /> },
              { path: BOARDS_PATH, element: <BoardsPage /> },
              {
                path: BOARD_PATH_PATTERN,
                element: <BoardPage />,
                // Card details open as a modal over the board, which stays rendered behind.
                children: [{ path: CARD_ROUTE_PATH, element: <CardDetailsRoute /> }],
              },
            ],
          },
        ],
      },
    ],
  },
];
