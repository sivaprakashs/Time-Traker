import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Clock,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Pause,
  Play,
  Settings,
  Square,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useTimer } from '@/contexts/TimerContext';
import { useToast } from '@/components/ui/toast';
import { formatDurationHMS } from '@/lib/timezone';
import { cn, getInitials } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tracker', label: 'Time Tracker', icon: Clock },
  { to: '/reports', label: 'Timesheet & Reports', icon: BarChart3 },
  { to: '/projects', label: 'Projects & Tasks', icon: FolderKanban },
  { to: '/team', label: 'Team Management', icon: Users, adminOnly: true },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppLayout() {
  const { profile, user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { activeTimer, elapsedSeconds, mutating, pauseTimer, resumeTimer, stopTimer } = useTimer();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isAdmin = profile?.role === 'admin';
  const visibleNav = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  const handlePauseResume = async () => {
    if (!activeTimer) return;
    try {
      if (activeTimer.status === 'running') {
        await pauseTimer();
        toast({ title: 'Timer paused' });
      } else {
        await resumeTimer();
        toast({ title: 'Timer resumed' });
      }
    } catch (err) {
      toast({
        title: 'Timer action failed',
        description: err instanceof Error ? err.message : 'Unable to update timer',
        variant: 'error',
      });
    }
  };

  const handleStop = async () => {
    try {
      await stopTimer();
      toast({ title: 'Time entry saved', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Unable to stop timer',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    }
  };

  const renderSidebarContent = () => (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Clock className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">Mexro</p>
            <p className="text-[11px] text-muted-foreground">Time Tracker</p>
          </div>
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent lg:hidden cursor-pointer"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {visibleNav.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="rounded-md bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">Timezone: Asia/Kolkata (IST)</p>
          <p className="mt-0.5">Server-synced timestamp tracking</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop Sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
        <div className="sticky top-0 h-screen">{renderSidebarContent()}</div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-64 border-r border-sidebar-border bg-sidebar">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/85 lg:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </Button>
            <span className="hidden text-xs font-medium text-muted-foreground sm:inline-block">
              Mexro Technologies Workspace
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Persistent Live Timer Bar */}
            {activeTimer ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    activeTimer.status === 'running'
                      ? 'animate-pulse bg-emerald-500'
                      : 'bg-amber-500',
                  )}
                />
                <button
                  type="button"
                  onClick={() => navigate('/tracker')}
                  className="hidden max-w-[160px] truncate text-xs font-medium hover:underline sm:inline-block cursor-pointer"
                >
                  {activeTimer.project?.name || 'Active Project'}
                </button>
                <span className="font-mono text-xs font-semibold tabular-nums">
                  {formatDurationHMS(elapsedSeconds)}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={mutating}
                  onClick={handlePauseResume}
                  title={activeTimer.status === 'running' ? 'Pause timer' : 'Resume timer'}
                >
                  {activeTimer.status === 'running' ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  size="icon-sm"
                  variant="destructive"
                  className="h-7 w-7"
                  disabled={mutating}
                  onClick={handleStop}
                  title="Stop & save timer"
                >
                  <Square className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/tracker')}
                className="hidden sm:inline-flex"
              >
                <Clock className="h-3.5 w-3.5" />
                Start Timer
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label="Toggle color theme"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-left hover:bg-accent cursor-pointer"
                >
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                    {getInitials(profile?.full_name, profile?.email || user?.email)}
                  </div>
                  <div className="hidden text-xs leading-tight md:block">
                    <p className="font-medium max-w-[140px] truncate">
                      {profile?.full_name || user?.email}
                    </p>
                  </div>
                  <Badge variant={isAdmin ? 'default' : 'secondary'} className="hidden capitalize sm:inline-flex">
                    {profile?.role || 'employee'}
                  </Badge>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2.5 py-2">
                  <p className="text-sm font-medium truncate">
                    {profile?.full_name || 'Team Member'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {profile?.email || user?.email}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/settings')}>
                  <Settings className="h-4 w-4" />
                  Account Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => void signOut()}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
