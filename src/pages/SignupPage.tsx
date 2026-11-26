import React, { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, Loader2, Mail } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { lookupInvitationByToken } from '@/services/api';
import { SetupRequired } from '@/components/auth/SetupRequired';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { InvitationLookup } from '@/types/database';

export function SignupPage() {
  const { isConfigured, user, loading, signUp, resendVerification } = useAuth();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');

  const [inviteInfo, setInviteInfo] = useState<InvitationLookup | null>(null);
  const [inviteLoading, setInviteLoading] = useState<boolean>(Boolean(inviteToken));

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);
  const [resendInfo, setResendInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured || !inviteToken) {
      setInviteLoading(false);
      return;
    }
    let mounted = true;
    void (async () => {
      try {
        const info = await lookupInvitationByToken(inviteToken);
        if (!mounted) return;
        setInviteInfo(info);
        if (info?.is_valid) {
          setEmail(info.email);
          if (info.full_name) setFullName(info.full_name);
        }
      } catch {
        // Ignore lookup failure; user can still sign up normally
      } finally {
        if (mounted) setInviteLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [inviteToken, isConfigured]);

  if (!isConfigured) return <SetupRequired />;
  if (!loading && user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const result = await signUp({ email, password, fullName });
    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (result.needsEmailVerification) {
      setVerificationSent(true);
    }
  };

  const handleResend = async () => {
    setResendInfo(null);
    const { error: err } = await resendVerification(email);
    if (err) {
      setError(err);
    } else {
      setResendInfo('A fresh verification email has been sent.');
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
        {verificationSent ? (
          <>
            <CardHeader>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                <Mail className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg">Verify your email address</CardTitle>
              <CardDescription>
                We sent a confirmation link to <span className="font-medium text-foreground">{email}</span>.
                Click the link in your inbox before signing in.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {resendInfo && (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300">
                  {resendInfo}
                </p>
              )}
              {error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                  {error}
                </p>
              )}
              <Button variant="outline" className="w-full" onClick={handleResend}>
                Resend verification email
              </Button>
              <Button asChild className="w-full">
                <Link to="/login">Return to sign in</Link>
              </Button>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="text-lg">Create your workspace account</CardTitle>
              <CardDescription>
                Register with your Mexro Technologies email address. Email verification is required.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {inviteLoading ? (
                <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking invitation...
                </div>
              ) : (
                inviteInfo && (
                  <div className="mb-4 rounded-md border border-border bg-muted/50 p-3 text-xs">
                    {inviteInfo.is_valid ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                          Invitation verified for {inviteInfo.email}
                        </span>
                        <Badge variant="default" className="capitalize">
                          {inviteInfo.role}
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">
                        This invitation link is {inviteInfo.status} or expired.
                      </span>
                    )}
                  </div>
                )
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                    {error}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input
                    id="fullName"
                    required
                    placeholder="Aarav Sharma"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="signupEmail">Work Email</Label>
                  <Input
                    id="signupEmail"
                    type="email"
                    required
                    readOnly={Boolean(inviteInfo?.is_valid)}
                    placeholder="name@mexrotechnologies.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="signupPassword">Password</Label>
                  <Input
                    id="signupPassword"
                    type="password"
                    required
                    minLength={8}
                    placeholder="Minimum 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    required
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create account
                </Button>
              </form>

              <p className="mt-4 text-center text-xs text-muted-foreground">
                Already have an account?{' '}
                <Link to="/login" className="font-medium text-primary hover:underline">
                  Sign in
                </Link>
              </p>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
