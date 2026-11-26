import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarPlus,
  Clock,
  Edit2,
  Loader2,
  Pause,
  Play,
  Square,
  Trash2,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTimer } from '@/contexts/TimerContext';
import { useToast } from '@/components/ui/toast';
import {
  createManualTimeEntry,
  deleteTimeEntry,
  fetchProjectsBundle,
  fetchTimeEntries,
  updateTimeEntry,
} from '@/services/api';
import {
  computeEffectiveSeconds,
  formatDurationHMS,
  formatDurationHuman,
  formatISTDate,
  formatISTTime,
  getISTDateString,
  utcIsoToISTTimeInput,
} from '@/lib/timezone';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Project, Task, TimeEntryWithRelations } from '@/types/database';

const NONE_TASK_VALUE = '__none__';

export function TimeTrackerPage() {
  const { user, getServerNowMs } = useAuth();
  const {
    activeTimer,
    elapsedSeconds,
    mutating,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    updateActiveDetails,
  } = useTimer();
  const { toast } = useToast();

  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [entries, setEntries] = useState<TimeEntryWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  // Live timer bar form state
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedTaskId, setSelectedTaskId] = useState<string>(NONE_TASK_VALUE);
  const [description, setDescription] = useState<string>('');

  // Manual entry dialog
  const [manualOpen, setManualOpen] = useState(false);
  const [manualProjectId, setManualProjectId] = useState('');
  const [manualTaskId, setManualTaskId] = useState(NONE_TASK_VALUE);
  const [manualDate, setManualDate] = useState(getISTDateString());
  const [manualStartTime, setManualStartTime] = useState('09:30');
  const [manualEndTime, setManualEndTime] = useState('11:00');
  const [manualDescription, setManualDescription] = useState('');
  const [manualSaving, setManualSaving] = useState(false);

  // Edit entry dialog
  const [editingEntry, setEditingEntry] = useState<TimeEntryWithRelations | null>(null);
  const [editProjectId, setEditProjectId] = useState('');
  const [editTaskId, setEditTaskId] = useState(NONE_TASK_VALUE);
  const [editDate, setEditDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [bundle, myEntries] = await Promise.all([
        fetchProjectsBundle(),
        fetchTimeEntries({ userId: user.id, includeActive: false, limit: 100 }),
      ]);
      const activeProjects = bundle.projects.filter((p) => p.status === 'active');
      setProjects(activeProjects);
      setTasks(bundle.tasks);
      setEntries(myEntries);

      if (activeProjects.length > 0) {
        setSelectedProjectId((prev) => prev || activeProjects[0].id);
        setManualProjectId((prev) => prev || activeProjects[0].id);
      }
    } catch (err) {
      toast({
        title: 'Failed to load tracker data',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [toast, user]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Sync live timer fields when activeTimer loads/changes (e.g., after page refresh)
  useEffect(() => {
    if (activeTimer) {
      setSelectedProjectId(activeTimer.project_id);
      setSelectedTaskId(activeTimer.task_id ?? NONE_TASK_VALUE);
      setDescription(activeTimer.description ?? '');
    }
  }, [activeTimer]);

  const availableTasksForActive = useMemo(
    () => tasks.filter((t) => t.project_id === selectedProjectId),
    [selectedProjectId, tasks],
  );

  const availableTasksForManual = useMemo(
    () => tasks.filter((t) => t.project_id === manualProjectId),
    [manualProjectId, tasks],
  );

  const availableTasksForEdit = useMemo(
    () => tasks.filter((t) => t.project_id === editProjectId),
    [editProjectId, tasks],
  );

  const handleStart = async () => {
    if (!selectedProjectId) {
      toast({
        title: 'Select a project first',
        description: 'Choose an assigned project before starting the timer.',
        variant: 'error',
      });
      return;
    }
    try {
      await startTimer({
        projectId: selectedProjectId,
        taskId: selectedTaskId === NONE_TASK_VALUE ? null : selectedTaskId,
        description,
      });
      toast({ title: 'Timer started', variant: 'success' });
    } catch (err) {
      toast({
        title: 'Could not start timer',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    }
  };

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
        title: 'Timer update failed',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    }
  };

  const handleStop = async () => {
    if (!activeTimer) return;
    try {
      await stopTimer({
        description,
        projectId: selectedProjectId || activeTimer.project_id,
        taskId: selectedTaskId === NONE_TASK_VALUE ? null : selectedTaskId,
      });
      setDescription('');
      setSelectedTaskId(NONE_TASK_VALUE);
      toast({ title: 'Work session saved', variant: 'success' });
      await loadData();
    } catch (err) {
      toast({
        title: 'Could not stop timer',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    }
  };

  const handleActiveFieldCommit = async (patch: {
    description?: string;
    project_id?: string;
    task_id?: string | null;
  }) => {
    if (!activeTimer) return;
    try {
      await updateActiveDetails(patch);
    } catch (err) {
      toast({
        title: 'Failed to update running timer',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !manualProjectId) return;
    setManualSaving(true);
    try {
      await createManualTimeEntry({
        user_id: user.id,
        project_id: manualProjectId,
        task_id: manualTaskId === NONE_TASK_VALUE ? null : manualTaskId,
        description: manualDescription,
        work_date: manualDate,
        start_time: manualStartTime,
        end_time: manualEndTime,
      });
      setManualOpen(false);
      setManualDescription('');
      setManualTaskId(NONE_TASK_VALUE);
      toast({ title: 'Manual time entry added', variant: 'success' });
      await loadData();
    } catch (err) {
      toast({
        title: 'Could not add entry',
        description: err instanceof Error ? err.message : 'Invalid entry details',
        variant: 'error',
      });
    } finally {
      setManualSaving(false);
    }
  };

  const openEditModal = (entry: TimeEntryWithRelations) => {
    setEditingEntry(entry);
    setEditProjectId(entry.project_id);
    setEditTaskId(entry.task_id ?? NONE_TASK_VALUE);
    setEditDate(entry.work_date);
    setEditStartTime(utcIsoToISTTimeInput(entry.started_at) || '09:30');
    setEditEndTime(utcIsoToISTTimeInput(entry.ended_at) || '10:30');
    setEditDescription(entry.description || '');
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;
    setEditSaving(true);
    try {
      await updateTimeEntry(editingEntry.id, {
        project_id: editProjectId,
        task_id: editTaskId === NONE_TASK_VALUE ? null : editTaskId,
        description: editDescription,
        work_date: editDate,
        start_time: editStartTime,
        end_time: editEndTime,
      });
      setEditingEntry(null);
      toast({ title: 'Time entry updated', variant: 'success' });
      await loadData();
    } catch (err) {
      toast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (entryId: string) => {
    if (!window.confirm('Delete this time entry permanently?')) return;
    try {
      await deleteTimeEntry(entryId);
      setEntries((prev) => prev.filter((item) => item.id !== entryId));
      toast({ title: 'Time entry deleted' });
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    }
  };

  // Group completed entries by IST work_date
  const groupedEntries = useMemo(() => {
    const groups = new Map<string, TimeEntryWithRelations[]>();
    for (const entry of entries) {
      const list = groups.get(entry.work_date) ?? [];
      list.push(entry);
      groups.set(entry.work_date, list);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [entries]);

  const nowMs = getServerNowMs();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Time Tracker</h1>
          <p className="text-sm text-muted-foreground">
            Track live work sessions or log manual entries in Asia/Kolkata (IST).
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setManualOpen(true)}
          disabled={projects.length === 0}
        >
          <CalendarPlus className="h-4 w-4" />
          Add Manual Entry
        </Button>
      </div>

      {/* Live Timer Control Bar */}
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">
                {activeTimer
                  ? activeTimer.status === 'running'
                    ? 'Active Timer Running'
                    : 'Active Timer Paused'
                  : 'Start a New Timer'}
              </CardTitle>
              <CardDescription className="text-xs">
                Only one active timer can run per employee. Timestamps are persisted on the server.
              </CardDescription>
            </div>
            {activeTimer && (
              <Badge variant={activeTimer.status === 'running' ? 'success' : 'warning'} className="capitalize">
                {activeTimer.status}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {projects.length === 0 && !loading ? (
            <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              You are not assigned to any active projects yet. Ask an administrator to assign you to a project.
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-12 lg:items-center">
              <div className="lg:col-span-4">
                <Input
                  placeholder="What are you working on?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => {
                    if (activeTimer && description !== activeTimer.description) {
                      void handleActiveFieldCommit({ description });
                    }
                  }}
                />
              </div>

              <div className="lg:col-span-3">
                <Select
                  value={selectedProjectId}
                  onValueChange={(val) => {
                    setSelectedProjectId(val);
                    setSelectedTaskId(NONE_TASK_VALUE);
                    if (activeTimer) {
                      void handleActiveFieldCommit({ project_id: val, task_id: null });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="lg:col-span-2">
                <Select
                  value={selectedTaskId}
                  onValueChange={(val) => {
                    setSelectedTaskId(val);
                    if (activeTimer) {
                      void handleActiveFieldCommit({
                        task_id: val === NONE_TASK_VALUE ? null : val,
                      });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Task (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_TASK_VALUE}>No specific task</SelectItem>
                    {availableTasksForActive.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-2 lg:col-span-3 lg:justify-end">
                <span className="font-mono text-xl font-semibold tabular-nums tracking-tight">
                  {formatDurationHMS(elapsedSeconds)}
                </span>

                {!activeTimer ? (
                  <Button onClick={handleStart} disabled={mutating || !selectedProjectId}>
                    <Play className="h-4 w-4" />
                    Start
                  </Button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handlePauseResume}
                      disabled={mutating}
                      title={activeTimer.status === 'running' ? 'Pause' : 'Resume'}
                    >
                      {activeTimer.status === 'running' ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleStop}
                      disabled={mutating}
                    >
                      <Square className="h-4 w-4" />
                      Stop
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Time Entries History Grouped by Date */}
      <div className="space-y-4">
        {loading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading your time entries...
            </CardContent>
          </Card>
        ) : groupedEntries.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Clock className="mb-3 h-8 w-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">No completed time entries yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Start the live timer above or add a manual entry to record your hours.
              </p>
            </CardContent>
          </Card>
        ) : (
          groupedEntries.map(([dateStr, dayEntries]) => {
            const dayTotalSec = dayEntries.reduce(
              (acc, item) => acc + computeEffectiveSeconds(item, nowMs),
              0,
            );
            return (
              <Card key={dateStr}>
                <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
                  <span className="text-xs font-semibold">
                    {formatISTDate(dateStr, {
                      weekday: 'short',
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                  <span className="font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                    Total: {formatDurationHuman(dayTotalSec)} ({formatDurationHMS(dayTotalSec)})
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {dayEntries.map((entry) => {
                    const secs = computeEffectiveSeconds(entry, nowMs);
                    return (
                      <div
                        key={entry.id}
                        className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: entry.project?.color || '#4f46e5' }}
                            />
                            <span className="text-sm font-medium">
                              {entry.project?.name || 'Project'}
                            </span>
                            {entry.task && (
                              <Badge variant="outline" className="text-[11px]">
                                {entry.task.title}
                              </Badge>
                            )}
                            {entry.entry_type === 'manual' && (
                              <Badge variant="secondary" className="text-[11px]">
                                Manual
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            {entry.description || 'No description provided'}
                          </p>
                        </div>

                        <div className="flex items-center justify-between gap-4 sm:justify-end">
                          <div className="text-right">
                            <p className="font-mono text-sm font-semibold tabular-nums">
                              {formatDurationHMS(secs)}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {formatISTTime(entry.started_at)} – {formatISTTime(entry.ended_at)}
                            </p>
                          </div>

                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => openEditModal(entry)}
                              title="Edit entry"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => void handleDelete(entry.id)}
                              title="Delete entry"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Add Manual Entry Modal */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Manual Time Entry</DialogTitle>
            <DialogDescription>
              Log completed work with exact IST start and end times.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Select
                value={manualProjectId}
                onValueChange={(val) => {
                  setManualProjectId(val);
                  setManualTaskId(NONE_TASK_VALUE);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Task (Optional)</Label>
              <Select value={manualTaskId} onValueChange={setManualTaskId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select task" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_TASK_VALUE}>No specific task</SelectItem>
                  {availableTasksForManual.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="manualDate">Work Date (IST)</Label>
                <Input
                  id="manualDate"
                  type="date"
                  required
                  value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manualStart">Start Time</Label>
                <Input
                  id="manualStart"
                  type="time"
                  required
                  value={manualStartTime}
                  onChange={(e) => setManualStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manualEnd">End Time</Label>
                <Input
                  id="manualEnd"
                  type="time"
                  required
                  value={manualEndTime}
                  onChange={(e) => setManualEndTime(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="manualDesc">Work Description</Label>
              <Input
                id="manualDesc"
                placeholder="Implemented API endpoints and unit tests"
                value={manualDescription}
                onChange={(e) => setManualDescription(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setManualOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={manualSaving || !manualProjectId}>
                {manualSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Entry
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Time Entry Modal */}
      <Dialog open={Boolean(editingEntry)} onOpenChange={(open) => !open && setEditingEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Time Entry</DialogTitle>
            <DialogDescription>
              Update project, task, description, or IST start/end times.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Select
                value={editProjectId}
                onValueChange={(val) => {
                  setEditProjectId(val);
                  setEditTaskId(NONE_TASK_VALUE);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Task (Optional)</Label>
              <Select value={editTaskId} onValueChange={setEditTaskId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select task" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_TASK_VALUE}>No specific task</SelectItem>
                  {availableTasksForEdit.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="editDate">Work Date (IST)</Label>
                <Input
                  id="editDate"
                  type="date"
                  required
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="editStart">Start Time</Label>
                <Input
                  id="editStart"
                  type="time"
                  required
                  value={editStartTime}
                  onChange={(e) => setEditStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="editEnd">End Time</Label>
                <Input
                  id="editEnd"
                  type="time"
                  required
                  value={editEndTime}
                  onChange={(e) => setEditEndTime(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="editDesc">Work Description</Label>
              <Input
                id="editDesc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingEntry(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={editSaving}>
                {editSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
