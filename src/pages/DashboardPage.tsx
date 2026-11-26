import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  CalendarDays,
  Clock,
  Layers,
  Loader2,
  Play,
  Users,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import { useTimer } from '@/contexts/TimerContext';
import { fetchTeamDashboardSummary, fetchTimeEntries } from '@/services/api';
import {
  computeEffectiveSeconds,
  formatDurationHMS,
  formatDurationHuman,
  formatISTDate,
  formatISTTime,
  getISTDateString,
  getISTDaysInRange,
  getISTMonthBounds,
  getISTWeekBounds,
} from '@/lib/timezone';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { TeamDashboardSummary, TimeEntryWithRelations } from '@/types/database';

export function DashboardPage() {
  const { user, profile, getServerNowMs } = useAuth();
  const { activeTimer, elapsedSeconds } = useTimer();

  const [entries, setEntries] = useState<TimeEntryWithRelations[]>([]);
  const [teamSummary, setTeamSummary] = useState<TeamDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin';
  const todayIST = getISTDateString();
  const weekBounds = useMemo(() => getISTWeekBounds(todayIST), [todayIST]);
  const monthBounds = useMemo(() => getISTMonthBounds(todayIST), [todayIST]);

  const loadDashboard = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const fetchStart =
        weekBounds.start < monthBounds.start ? weekBounds.start : monthBounds.start;
      const fetchEnd = weekBounds.end > monthBounds.end ? weekBounds.end : monthBounds.end;

      const [entriesData, summaryData] = await Promise.all([
        fetchTimeEntries({
          startDate: fetchStart,
          endDate: fetchEnd,
          includeActive: true,
        }),
        fetchTeamDashboardSummary(),
      ]);

      setEntries(entriesData);
      setTeamSummary(summaryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, [monthBounds.end, monthBounds.start, user, weekBounds.end, weekBounds.start]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard, activeTimer?.id, activeTimer?.status]);

  const nowMs = getServerNowMs();

  // Employee's own hours (or personal metrics for the logged-in user)
  const myEntries = useMemo(
    () => entries.filter((e) => e.user_id === user?.id),
    [entries, user?.id],
  );

  const getEntrySeconds = useCallback(
    (entry: TimeEntryWithRelations) => {
      if (activeTimer && entry.id === activeTimer.id) {
        return elapsedSeconds;
      }
      return computeEffectiveSeconds(entry, nowMs);
    },
    [activeTimer, elapsedSeconds, nowMs],
  );

  const myTodaySeconds = useMemo(
    () =>
      myEntries
        .filter((e) => e.work_date === todayIST)
        .reduce((acc, e) => acc + getEntrySeconds(e), 0),
    [getEntrySeconds, myEntries, todayIST],
  );

  const myWeekSeconds = useMemo(
    () =>
      myEntries
        .filter((e) => e.work_date >= weekBounds.start && e.work_date <= weekBounds.end)
        .reduce((acc, e) => acc + getEntrySeconds(e), 0),
    [getEntrySeconds, myEntries, weekBounds.end, weekBounds.start],
  );

  const myMonthSeconds = useMemo(
    () =>
      myEntries
        .filter((e) => e.work_date >= monthBounds.start && e.work_date <= monthBounds.end)
        .reduce((acc, e) => acc + getEntrySeconds(e), 0),
    [getEntrySeconds, monthBounds.end, monthBounds.start, myEntries],
  );

  const chartSourceEntries = isAdmin ? entries : myEntries;

  const weeklyChartData = useMemo(() => {
    const days = getISTDaysInRange(weekBounds.start, weekBounds.end);
    return days.map((day) => {
      const totalSec = chartSourceEntries
        .filter((e) => e.work_date === day)
        .reduce((acc, e) => acc + getEntrySeconds(e), 0);
      return {
        date: day,
        label: formatISTDate(day, { weekday: 'short' }),
        hours: Number((totalSec / 3600).toFixed(2)),
      };
    });
  }, [chartSourceEntries, getEntrySeconds, weekBounds.end, weekBounds.start]);

  const monthlyChartData = useMemo(() => {
    const days = getISTDaysInRange(monthBounds.start, monthBounds.end);
    return days.map((day) => {
      const totalSec = chartSourceEntries
        .filter((e) => e.work_date === day)
        .reduce((acc, e) => acc + getEntrySeconds(e), 0);
      return {
        date: day,
        label: day.slice(8, 10),
        hours: Number((totalSec / 3600).toFixed(2)),
      };
    });
  }, [chartSourceEntries, getEntrySeconds, monthBounds.end, monthBounds.start]);

  const recentEntries = useMemo(() => entries.slice(0, 8), [entries]);

  const liveTeamMonthSeconds = useMemo(() => {
    const base = teamSummary?.team_month_seconds ?? 0;
    if (!activeTimer) return base;
    return base;
  }, [activeTimer, teamSummary?.team_month_seconds]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Overview for {formatISTDate(todayIST, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (IST)
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTimer ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/tracker">
                <Activity className="h-4 w-4 text-emerald-500" />
                Active: {formatDurationHMS(elapsedSeconds)}
              </Link>
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link to="/tracker">
                <Play className="h-4 w-4" />
                Start Time Tracker
              </Link>
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription className="text-xs font-medium">Today&apos;s Hours</CardDescription>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {formatDurationHuman(myTodaySeconds)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Your logged time today</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription className="text-xs font-medium">This Week</CardDescription>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {formatDurationHuman(myWeekSeconds)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatISTDate(weekBounds.start, { day: '2-digit', month: 'short' })} –{' '}
              {formatISTDate(weekBounds.end, { day: '2-digit', month: 'short' })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription className="text-xs font-medium">This Month</CardDescription>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {formatDurationHuman(myMonthSeconds)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatISTDate(todayIST, { month: 'long', year: 'numeric' })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription className="text-xs font-medium">Total Team Hours</CardDescription>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {formatDurationHuman(liveTeamMonthSeconds)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDurationHuman(teamSummary?.team_week_seconds ?? 0)} this week
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription className="text-xs font-medium">Active Team Members</CardDescription>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {teamSummary?.active_members_count ?? 0}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {teamSummary?.running_timers_count ?? 0} tracking live now
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">
              Weekly Working Hours {isAdmin ? '(Team)' : '(Personal)'}
            </CardTitle>
            <CardDescription className="text-xs">
              Hours tracked per day across the current week (Mon–Sun IST)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              {loading ? (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading chart...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyChartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                      axisLine={false}
                      tickLine={false}
                      unit="h"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--card)',
                        borderColor: 'var(--border)',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      formatter={(val: unknown) => [`${val} hrs`, 'Hours']}
                    />
                    <Bar dataKey="hours" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">
              Monthly Working Hours {isAdmin ? '(Team)' : '(Personal)'}
            </CardTitle>
            <CardDescription className="text-xs">
              Daily trend for {formatISTDate(todayIST, { month: 'long', year: 'numeric' })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              {loading ? (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading chart...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyChartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                      axisLine={false}
                      tickLine={false}
                      interval={2}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                      axisLine={false}
                      tickLine={false}
                      unit="h"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--card)',
                        borderColor: 'var(--border)',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      labelFormatter={(day) => `Day ${day}`}
                      formatter={(val: unknown) => [`${val} hrs`, 'Hours']}
                    />
                    <Area
                      type="monotone"
                      dataKey="hours"
                      stroke="var(--primary)"
                      fill="var(--primary)"
                      fillOpacity={0.14}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Work Activities */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold">Recent Work Activities</CardTitle>
            <CardDescription className="text-xs">
              {isAdmin
                ? 'Latest time entries recorded across Mexro Technologies'
                : 'Your latest recorded work sessions'}
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/tracker">View all</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading activities...
            </div>
          ) : recentEntries.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No time entries logged yet for this period. Head to{' '}
              <Link to="/tracker" className="font-medium text-primary hover:underline">
                Time Tracker
              </Link>{' '}
              to start logging work.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {isAdmin && <TableHead>Member</TableHead>}
                  <TableHead>Project / Task</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Date &amp; Time (IST)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    {isAdmin && (
                      <TableCell className="font-medium whitespace-nowrap">
                        {entry.profile?.full_name || entry.profile?.email || 'Member'}
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: entry.project?.color || '#4f46e5' }}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {entry.project?.name || 'Project'}
                          </p>
                          {entry.task && (
                            <p className="text-xs text-muted-foreground truncate">
                              {entry.task.title}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-muted-foreground">
                      {entry.description || '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      <div>{formatISTDate(entry.work_date)}</div>
                      <div>
                        {formatISTTime(entry.started_at)}
                        {entry.ended_at ? ` – ${formatISTTime(entry.ended_at)}` : ''}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          entry.status === 'running'
                            ? 'success'
                            : entry.status === 'paused'
                              ? 'warning'
                              : 'secondary'
                        }
                        className="capitalize"
                      >
                        {entry.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium tabular-nums">
                      {formatDurationHMS(getEntrySeconds(entry))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
