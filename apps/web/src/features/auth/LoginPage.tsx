import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@streamline/shared';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';

import { AuthCard } from './AuthCard';
import { AuthField } from './AuthField';
import { login } from './authApi';
import { getAuthErrorMessage } from './authErrorMessage';
import { REGISTER_PATH, getRedirectTarget } from './redirect';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Carries the location a guest was redirected from; passed on so it survives page switches.
  const redirectState: unknown = location.state;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginInput) => {
    try {
      await login(values);
      await navigate(getRedirectTarget(redirectState), { replace: true });
    } catch (error) {
      setError('root.server', { message: getAuthErrorMessage(error) });
    }
  };

  return (
    <AuthCard
      title="Log in to StreamLine"
      description="Welcome back. Enter your details to continue."
      footer={
        <>
          No account yet?{' '}
          <Link
            to={REGISTER_PATH}
            state={redirectState}
            className="text-primary underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      >
        {errors.root?.server && (
          <p role="alert" className="text-sm text-destructive">
            {errors.root.server.message}
          </p>
        )}
        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Logging in...' : 'Log in'}
        </Button>
      </form>
    </AuthCard>
  );
}
