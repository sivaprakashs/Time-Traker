import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Clock, Loader2, MailCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { SetupRequired } from '@/components/auth/SetupRequired';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LoginPage() {
  const { isConfigured, user, loading, signIn, resendVerification } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resentMessage, setResentMessage] = useState<string | null>(null);

  if (!isConfigured) return <SetupRequired />;
  if (!loading && user) return <Navigate to={from} replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResentMessage(null);
    setUnverifiedEmail(null);
    setSubmitting(true);

    const result = await signIn(email, password);
    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      if (result.error.toLowerCase().includes('email not confirmed')) {
        setUnverifiedEmail(email.trim());
      }
      return;
    }
    navigate(from, { replace: true });
  };

  const handleResend = async () => {
    if (!unverifiedEmail) return;
    setResentMessage(null);
    const { error: resendErr } = await resendVerification(unverifiedEmail);
    if (resendErr) {
      setError(resendErr);
    } else {
      setResentMessage('Verification link sent. Please check your inbox.');
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="mb-6 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Clock className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-none tracking-tight">Mexro Time Tracker</p>
          <p className="mt-1 text-xs text-muted-foreground">Mexro Technologies</p>
        </div>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-lg">Sign in to your workspace</CardTitle>
          <CardDescription>
            Enter your Mexro Technologies email and password to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                <p>{error}</p>
                {unverifiedEmail && (
                  <button
                    type="button"
                    onClick={handleResend}
                    className="mt-1.5 inline-flex items-center gap-1 font-medium underline cursor-pointer"
                  >
                    <MailCheck className="h-3.5 w-3.5" />
                    Resend verification email
                  </button>
                )}
              </div>
            )}

            {resentMessage && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300">
                {resentMessage}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">Work Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="name@mexrotechnologies.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Have an invite or creating the initial workspace account?{' '}
            <Link to="/signup" className="font-medium text-primary hover:underline">
              Create account
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
