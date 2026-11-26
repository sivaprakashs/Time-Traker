import { Database, FileCode2, KeyRound, Terminal } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function SetupRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-semibold">
              M
            </div>
            <div>
              <CardTitle className="text-lg">Mexro Time Tracker — Supabase Setup Required</CardTitle>
              <CardDescription>
                Connect your Supabase project to enable authentication, RLS security, and live time tracking.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-5 text-sm">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3.5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            Environment variables <code className="font-mono text-xs">VITE_SUPABASE_URL</code> and{' '}
            <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code> are not configured yet.
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="font-medium">1. Create your .env file</p>
                <p className="text-muted-foreground">
                  Copy <code className="font-mono text-xs">.env.example</code> to{' '}
                  <code className="font-mono text-xs">.env</code> and paste your Supabase Project URL and Anon Key.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Database className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="font-medium">2. Run the database migration</p>
                <p className="text-muted-foreground">
                  Execute <code className="font-mono text-xs">supabase/migrations/001_initial_schema.sql</code> in the
                  Supabase SQL Editor to create tables, RLS policies, and server-side timer RPCs.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <FileCode2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="font-medium">3. Deploy the invite Edge Function (optional for email invites)</p>
                <p className="text-muted-foreground">
                  Deploy <code className="font-mono text-xs">supabase/functions/invite-member</code> to dispatch
                  email invitations automatically via Supabase Auth Admin API.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="font-medium">4. Restart the dev server</p>
                <p className="text-muted-foreground">
                  Restart <code className="font-mono text-xs">npm run dev</code> after updating{' '}
                  <code className="font-mono text-xs">.env</code>. The first registered user is automatically assigned
                  the Admin role.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
