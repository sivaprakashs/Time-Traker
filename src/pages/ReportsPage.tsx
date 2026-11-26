import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/toast';
import {
  fetchProjectsBundle,
  fetchTeamProfiles,
  fetchTimeEntries,
} from '@/services/api';
import { exportEntriesToCSV, exportEntriesToExcel } from '@/lib/export';
import {
  addDaysToDateString,
  computeEffectiveSeconds,
  formatDurationHMS,
  formatDurationHuman,
  formatHoursDecimal,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Profile, Project, TimeEntryWithRelations } from '@/types/database';

type ViewMode = 'daily' | 'weekly' | 'monthly' | 'custom';
const ALL_VALUE = '__all__';

export function ReportsPage() {
  const { user, profile, getServerNowMs } = useAuth();
  const { toast } = useToast();
  const isAdmin = profile?.role === 'admin';

  const [viewMode, setViewMode] = useState<ViewMode>('weekly');
  const [anchorDate, setAnchorDate] = useState<string>(getISTDateString());
  const [customStart, setCustomStart] = useState<string>(getISTWeekBounds().start);
  const [customEnd, setCustomEnd] = useState<string>(getISTWeekBounds().end);
  const [projectFilter, setProjectFilter] = useState<string>(ALL_VALUE);
  const [employeeFilter, setEmployeeFilter] = useState<string>(ALL_VALUE);

  const [projects, setProjects] = useState<Project[]>([]);
  const [teamProfiles, setTeamProfiles] = useState<Profile[]>([]);
  const [entries, setEntries] = useState<TimeEntryWithRelations[]>([]);
  const [monthlyTotalSeconds, setMonthlyTotalSeconds] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const dateRange = useMemo(() => {
    if (viewMode === 'daily') {
      return { start: anchorDate, end: anchorDate };
    }
    if (viewMode === 'weekly') {
      return getISTWeekBounds(anchorDate);
    }
    if (viewMode === 'monthly') {
      return getISTMonthBounds(anchorDate);
    }
    return {
      start: customStart <= customEnd ? customStart : customEnd,
      end: customEnd >= customStart ? customEnd : customStart,
    };
  }, [anchorDate, customEnd, customStart, viewMode]);

  const monthBounds = useMemo(() => getISTMonthBounds(anchorDate), [anchorDate]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const [bundle, profilesList] = await Promise.all([
          fetchProjectsBundle(),
          isAdmin ? fetchTeamProfiles() : Promise.resolve([] as Profile[]),
        ]);
        setProjects(bundle.projects);
        setTeamProfiles(profilesList);
      } catch {
        // Handled cleanly in main fetch
      }
    })();
  }, [isAdmin, user]);

  const loadReports = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const targetUserId = isAdmin
        ? employeeFilter !== ALL_VALUE
          ? employeeFilter
          : undefined
        : user.id;

      const [rangeEntries, monthEntries] = await Promise.all([
        fetchTimeEntries({
          startDate: dateRange.start,
          endDate: dateRange.end,
          projectId: projectFilter !== ALL_VALUE ? projectFilter : undefined,
          userId: targetUserId,
          includeActive: true,
        }),
        fetchTimeEntries({
          startDate: monthBounds.start,
          endDate: monthBounds.end,
          projectId: projectFilter !== ALL_VALUE ? projectFilter : undefined,
          userId: targetUserId,
          includeActive: true,
        }),
      ]);

      setEntries(rangeEntries);
      const nowMs = getServerNowMs();
      setMonthlyTotalSeconds(
        monthEntries.reduce((acc, item) => acc + computeEffectiveSeconds(item, nowMs), 0),
      );
    } catch (err) {
      toast({
        title: 'Failed to load reports',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [
    dateRange.end,
    dateRange.start,
    employeeFilter,
    getServerNowMs,
    isAdmin,
    monthBounds.end,
    monthBounds.start,
    projectFilter,
    toast,
    user,
  ]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const nowMs = getServerNowMs();

  const totalRangeSeconds = useMemo(
    () => entries.reduce((acc, e) => acc + computeEffectiveSeconds(e, nowMs), 0),
    [entries, nowMs],
  );

  // Employee-wise summary
  const employeeSummary = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; email: string; entriesCount: number; seconds: number }
    >();
    for (const e of entries) {
      const id = e.user_id;
      const existing = map.get(id) ?? {
        id,
        name: e.profile?.full_name || e.profile?.email || profile?.full_name || 'Member',
        email: e.profile?.email || profile?.email || '',
        entriesCount: 0,
        seconds: 0,
      };
      existing.entriesCount += 1;
      existing.seconds += computeEffectiveSeconds(e, nowMs);
      map.set(id, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.seconds - a.seconds);
  }, [entries, nowMs, profile?.email, profile?.full_name]);

  // Project-wise summary
  const projectSummary = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; color: string; entriesCount: number; seconds: number }
    >();
    for (const e of entries) {
      const id = e.project_id;
      const existing = map.get(id) ?? {
        id,
        name: e.project?.name || 'Project',
        color: e.project?.color || '#4f46e5',
        entriesCount: 0,
        seconds: 0,
      };
      existing.entriesCount += 1;
      existing.seconds += computeEffectiveSeconds(e, nowMs);
      map.set(id, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.seconds - a.seconds);
  }, [entries, nowMs]);

  // Chart data across selected range (capped cleanly)
  const chartData = useMemo(() => {
    const days = getISTDaysInRange(dateRange.start, dateRange.end);
    return days.map((day) => {
      const daySeconds = entries
        .filter((e) => e.work_date === day)
        .reduce((acc, e) => acc + computeEffectiveSeconds(e, nowMs), 0);
      return {
        date: day,
        label:
          days.length <= 7
            ? formatISTDate(day, { weekday: 'short', day: '2-digit' })
            : day.slice(8, 10),
        hours: Number(formatHoursDecimal(daySeconds)),
      };
    });
  }, [dateRange.end, dateRange.start, entries, nowMs]);

  const shiftPeriod = (direction: -1 | 1) => {
    if (viewMode === 'daily') {
      setAnchorDate((prev) => addDaysToDateString(prev, direction));
    } else if (viewMode === 'weekly') {
      setAnchorDate((prev) => addDaysToDateString(prev, direction * 7));
    } else if (viewMode === 'monthly') {
      const [y, m] = anchorDate.split('-').map(Number);
      const nextDate = new Date(Date.UTC(y, m - 1 + direction, 1));
      const ny = nextDate.getUTCFullYear();
      const nm = String(nextDate.getUTCMonth() + 1).padStart(2, '0');
      setAnchorDate(`${ny}-${nm}-01`);
    }
  };

  const filePrefix = `mexro-timesheet-${dateRange.start}-to-${dateRange.end}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Timesheet &amp; Reports</h1>
          <p className="text-sm text-muted-foreground">
            Daily, weekly, and monthly working-hour breakdowns with CSV and Excel export.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={entries.length === 0}
            onClick={() => exportEntriesToCSV(entries, filePrefix, nowMs)}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button
            size="sm"
            disabled={entries.length === 0}
            onClick={() => exportEntriesToExcel(entries, filePrefix, nowMs)}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export Excel
          </Button>
        </div>
      </div>

      {/* Filters Bar */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
              <TabsList>
                <TabsTrigger value="daily">Daily</TabsTrigger>
                <TabsTrigger value="weekly">Weekly</TabsTrigger>
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
                <TabsTrigger value="custom">Custom Range</TabsTrigger>
              </TabsList>
            </Tabs>

            {viewMode !== 'custom' ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon-sm" onClick={() => shiftPeriod(-1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[180px] text-center text-xs font-medium">
                  {viewMode === 'daily'
                    ? formatISTDate(dateRange.start)
                    : `${formatISTDate(dateRange.start, { day: '2-digit', month: 'short' })} – ${formatISTDate(dateRange.end)}`}
                </span>
                <Button variant="outline" size="icon-sm" onClick={() => shiftPeriod(1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAnchorDate(getISTDateString())}
                >
                  Today
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="repStart" className="text-xs">
                    From
                  </Label>
                  <Input
                    id="repStart"
                    type="date"
                    className="h-8 w-36 text-xs"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="repEnd" className="text-xs">
                    To
                  </Label>
                  <Input
                    id="repEnd"
                    type="date"
                    className="h-8 w-36 text-xs"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Filter by Project</Label>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All Projects</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isAdmin && (
              <div className="space-y-1">
                <Label className="text-xs">Filter by Employee</Label>
                <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="All team members" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_VALUE}>All Team Members</SelectItem>
                    {teamProfiles.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.full_name || m.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Selected Period Total</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {formatDurationHuman(totalRangeSeconds)}
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {formatHoursDecimal(totalRangeSeconds)} decimal hrs
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">
              Monthly Total ({formatISTDate(anchorDate, { month: 'short', year: 'numeric' })})
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {formatDurationHuman(monthlyTotalSeconds)}
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {formatHoursDecimal(monthlyTotalSeconds)} decimal hrs
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Time Entries</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{entries.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">Recorded sessions in range</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Projects Active</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{projectSummary.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">With logged hours in range</p>
          </CardContent>
        </Card>
      </div>

      {/* Working-hour Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Working Hours Chart</CardTitle>
          <CardDescription className="text-xs">
            Daily working hours from {formatISTDate(dateRange.start)} to{' '}
            {formatISTDate(dateRange.end)} (IST)
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
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
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
                    formatter={(val: unknown) => [`${val} hrs`, 'Logged']}
                  />
                  <Bar dataKey="hours" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Employee-wise & Project-wise Breakdown */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Employee-wise Working Hours</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {employeeSummary.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No hours recorded for this filter.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead className="text-right">Entries</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employeeSummary.map((emp) => (
                    <TableRow key={emp.id}>
                      <TableCell>
                        <p className="font-medium leading-none">{emp.name}</p>
                        {emp.email && (
                          <p className="mt-1 text-xs text-muted-foreground">{emp.email}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs">{emp.entriesCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                        {formatDurationHuman(emp.seconds)} ({formatHoursDecimal(emp.seconds)}h)
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Project-wise Working Hours</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {projectSummary.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No project hours recorded for this filter.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Entries</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projectSummary.map((proj) => (
                    <TableRow key={proj.id}>
                      <TableCell>
                        <div className="flex items-center gap-2 font-medium">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: proj.color }}
                          />
                          {proj.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-xs">{proj.entriesCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                        {formatDurationHuman(proj.seconds)} ({formatHoursDecimal(proj.seconds)}h)
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Daily Time Records Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Daily Time Records</CardTitle>
          <CardDescription className="text-xs">
            Complete audit table of entries matching the selected filters
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading records...
            </div>
          ) : entries.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No daily time records match your current filter.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date (IST)</TableHead>
                  {isAdmin && <TableHead>Employee</TableHead>}
                  <TableHead>Project / Task</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Time (IST)</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatISTDate(entry.work_date)}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="whitespace-nowrap text-xs font-medium">
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
                          <p className="text-xs font-medium truncate">
                            {entry.project?.name || 'Project'}
                          </p>
                          {entry.task && (
                            <p className="text-[11px] text-muted-foreground truncate">
                              {entry.task.title}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                      {entry.description || '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatISTTime(entry.started_at)} – {formatISTTime(entry.ended_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize text-[11px]">
                        {entry.entry_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                      {formatDurationHMS(computeEffectiveSeconds(entry, nowMs))}
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
