import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@streamline/shared';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';

import { AuthCard } from './AuthCard';
import { AuthField } from './AuthField';
import { register as registerAccount } from './authApi';
import { getAuthErrorMessage } from './authErrorMessage';
import { LOGIN_PATH, getRedirectTarget } from './redirect';

export function RegisterPage() {
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
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = async (values: RegisterInput) => {
    try {
      await registerAccount(values);
      await navigate(getRedirectTarget(redirectState), { replace: true });
    } catch (error) {
      setError('root.server', { message: getAuthErrorMessage(error) });
    }
  };

  return (
    <AuthCard
      title="Create your StreamLine account"
      description="Start organizing your work with StreamLine."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to={LOGIN_PATH}
            state={redirectState}
            className="text-primary underline-offset-4 hover:underline"
          >
            Log in
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
          id="name"
          label="Name"
          autoComplete="name"
          error={errors.name?.message}
          {...register('name')}
        />
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
          autoComplete="new-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account...' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  );
}
