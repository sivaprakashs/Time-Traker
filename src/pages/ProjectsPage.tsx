import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  FolderKanban,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  UserPlus,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/toast';
import {
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  fetchProjectsBundle,
  fetchTeamProfiles,
  fetchTimeEntries,
  setProjectMembers,
  updateProject,
  updateTask,
} from '@/services/api';
import { computeEffectiveSeconds, formatDurationHuman, formatHoursDecimal } from '@/lib/timezone';
import { cn, PROJECT_COLORS } from '@/lib/utils';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type {
  Profile,
  Project,
  ProjectMember,
  Task,
  TaskStatus,
  TimeEntryWithRelations,
} from '@/types/database';

export function ProjectsPage() {
  const { user, profile, getServerNowMs } = useAuth();
  const { toast } = useToast();
  const isAdmin = profile?.role === 'admin';

  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [entries, setEntries] = useState<TimeEntryWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');

  // Create Project Dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newClient, setNewClient] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newColor, setNewColor] = useState<string>(PROJECT_COLORS[0]);
  const [newMemberIds, setNewMemberIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  // Add Task Dialog
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskSaving, setTaskSaving] = useState(false);

  // Assign Members Dialog
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignMemberIds, setAssignMemberIds] = useState<string[]>([]);
  const [assignSaving, setAssignSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [bundle, timeData, teamList] = await Promise.all([
        fetchProjectsBundle(),
        fetchTimeEntries({ includeActive: true }),
        isAdmin ? fetchTeamProfiles() : Promise.resolve([] as Profile[]),
      ]);
      setProjects(bundle.projects);
      setTasks(bundle.tasks);
      setMembers(bundle.members);
      setEntries(timeData);
      setProfiles(teamList);

      if (bundle.projects.length > 0) {
        setSelectedProjectId((prev) =>
          prev && bundle.projects.some((p) => p.id === prev) ? prev : bundle.projects[0].id,
        );
      } else {
        setSelectedProjectId(null);
      }
    } catch (err) {
      toast({
        title: 'Failed to load projects',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, toast, user]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const nowMs = getServerNowMs();

  const secondsByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      map.set(e.project_id, (map.get(e.project_id) ?? 0) + computeEffectiveSeconds(e, nowMs));
    }
    return map;
  }, [entries, nowMs]);

  const secondsByTask = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (!e.task_id) continue;
      map.set(e.task_id, (map.get(e.task_id) ?? 0) + computeEffectiveSeconds(e, nowMs));
    }
    return map;
  }, [entries, nowMs]);

  const visibleProjects = useMemo(() => {
    if (statusFilter === 'all') return projects;
    return projects.filter((p) => p.status === statusFilter);
  }, [projects, statusFilter]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const selectedProjectTasks = useMemo(
    () => tasks.filter((t) => t.project_id === selectedProjectId),
    [selectedProjectId, tasks],
  );

  const selectedProjectMembers = useMemo(() => {
    const userIds = new Set(
      members.filter((m) => m.project_id === selectedProjectId).map((m) => m.user_id),
    );
    return profiles.filter((p) => userIds.has(p.id));
  }, [members, profiles, selectedProjectId]);

  const projectReportChartData = useMemo(
    () =>
      projects
        .map((p) => {
          const secs = secondsByProject.get(p.id) ?? 0;
          return {
            id: p.id,
            name: p.name,
            code: p.code,
            color: p.color,
            seconds: secs,
            hours: Number(formatHoursDecimal(secs)),
            taskCount: tasks.filter((t) => t.project_id === p.id).length,
            memberCount: members.filter((m) => m.project_id === p.id).length,
          };
        })
        .sort((a, b) => b.seconds - a.seconds),
    [members, projects, secondsByProject, tasks],
  );

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newName.trim()) return;
    setCreating(true);
    try {
      const created = await createProject({
        name: newName,
        code: newCode,
        client_name: newClient,
        description: newDesc,
        color: newColor,
        created_by: user.id,
        memberIds: newMemberIds,
      });
      setCreateOpen(false);
      setNewName('');
      setNewCode('');
      setNewClient('');
      setNewDesc('');
      setNewMemberIds([]);
      toast({ title: 'Project created', variant: 'success' });
      await loadData();
      setSelectedProjectId(created.id);
    } catch (err) {
      toast({
        title: 'Failed to create project',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleArchiveToggle = async (project: Project) => {
    try {
      await updateProject(project.id, {
        status: project.status === 'active' ? 'archived' : 'active',
      });
      toast({
        title: project.status === 'active' ? 'Project archived' : 'Project restored',
      });
      await loadData();
    } catch (err) {
      toast({
        title: 'Action failed',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    }
  };

  const handleDeleteProject = async (project: Project) => {
    if (
      !window.confirm(
        `Delete project "${project.name}"? Note: projects with existing time entries cannot be deleted; archive them instead.`,
      )
    ) {
      return;
    }
    try {
      await deleteProject(project.id);
      toast({ title: 'Project deleted' });
      await loadData();
    } catch (err) {
      toast({
        title: 'Cannot delete project',
        description:
          err instanceof Error
            ? err.message
            : 'Archive this project instead if it has logged time entries.',
        variant: 'error',
      });
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedProjectId || !taskTitle.trim()) return;
    setTaskSaving(true);
    try {
      await createTask({
        project_id: selectedProjectId,
        title: taskTitle,
        description: taskDesc,
        created_by: user.id,
      });
      setTaskOpen(false);
      setTaskTitle('');
      setTaskDesc('');
      toast({ title: 'Task added', variant: 'success' });
      await loadData();
    } catch (err) {
      toast({
        title: 'Failed to add task',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    } finally {
      setTaskSaving(false);
    }
  };

  const handleTaskStatusChange = async (taskId: string, status: TaskStatus) => {
    try {
      await updateTask(taskId, { status });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
    } catch (err) {
      toast({
        title: 'Failed to update task',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm('Delete this task?')) return;
    try {
      await deleteTask(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      toast({ title: 'Task deleted' });
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    }
  };

  const openAssignDialog = () => {
    if (!selectedProjectId) return;
    const currentIds = members
      .filter((m) => m.project_id === selectedProjectId)
      .map((m) => m.user_id);
    setAssignMemberIds(currentIds);
    setAssignOpen(true);
  };

  const handleSaveAssignments = async () => {
    if (!selectedProjectId || !user) return;
    setAssignSaving(true);
    try {
      await setProjectMembers(selectedProjectId, assignMemberIds, user.id);
      setAssignOpen(false);
      toast({ title: 'Project members updated', variant: 'success' });
      await loadData();
    } catch (err) {
      toast({
        title: 'Failed to update members',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    } finally {
      setAssignSaving(false);
    }
  };

  const toggleIdInList = (list: string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects &amp; Tasks</h1>
          <p className="text-sm text-muted-foreground">
            Organize client deliverables, tasks, member assignments, and project-wise hours.
          </p>
        </div>

        {isAdmin && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        )}
      </div>

      <Tabs defaultValue="workspace">
        <TabsList>
          <TabsTrigger value="workspace">Projects &amp; Tasks</TabsTrigger>
          <TabsTrigger value="reports">Project-wise Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="workspace" className="space-y-4">
          {loading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading projects...
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-12">
              {/* Project List */}
              <Card className="lg:col-span-5">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm font-semibold">Projects</CardTitle>
                    <Select
                      value={statusFilter}
                      onValueChange={(v) => setStatusFilter(v as 'active' | 'archived' | 'all')}
                    >
                      <SelectTrigger className="h-8 w-28 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                        <SelectItem value="all">All</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {visibleProjects.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      <FolderKanban className="mx-auto mb-2 h-7 w-7 opacity-50" />
                      No projects found.
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {visibleProjects.map((proj) => {
                        const totalSec = secondsByProject.get(proj.id) ?? 0;
                        const taskCount = tasks.filter((t) => t.project_id === proj.id).length;
                        const isSelected = proj.id === selectedProjectId;
                        return (
                          <button
                            key={proj.id}
                            type="button"
                            onClick={() => setSelectedProjectId(proj.id)}
                            className={cn(
                              'flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 cursor-pointer',
                              isSelected && 'bg-primary/5',
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: proj.color }}
                                />
                                <span className="truncate text-sm font-medium">{proj.name}</span>
                                {proj.code && (
                                  <Badge variant="outline" className="text-[10px]">
                                    {proj.code}
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {proj.client_name ? `${proj.client_name} · ` : ''}
                                {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="font-mono text-xs font-semibold tabular-nums">
                                {formatDurationHuman(totalSec)}
                              </p>
                              {proj.status === 'archived' && (
                                <Badge variant="secondary" className="mt-1 text-[10px]">
                                  Archived
                                </Badge>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Selected Project Details */}
              <Card className="lg:col-span-7">
                {!selectedProject ? (
                  <CardContent className="flex flex-col items-center justify-center py-16 text-center text-sm text-muted-foreground">
                    Select a project to view tasks, assigned members, and tracked time.
                  </CardContent>
                ) : (
                  <>
                    <CardHeader className="border-b border-border pb-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: selectedProject.color }}
                            />
                            <CardTitle className="text-base">{selectedProject.name}</CardTitle>
                            {selectedProject.code && (
                              <Badge variant="outline">{selectedProject.code}</Badge>
                            )}
                          </div>
                          <CardDescription className="mt-1">
                            {selectedProject.description || 'No description added.'}
                          </CardDescription>
                        </div>

                        {isAdmin && (
                          <div className="flex items-center gap-1.5">
                            <Button variant="outline" size="sm" onClick={openAssignDialog}>
                              <UserPlus className="h-3.5 w-3.5" />
                              Assign Members
                            </Button>
                            <Button
                              variant="outline"
                              size="icon-sm"
                              onClick={() => void handleArchiveToggle(selectedProject)}
                              title={
                                selectedProject.status === 'active'
                                  ? 'Archive project'
                                  : 'Restore project'
                              }
                            >
                              {selectedProject.status === 'active' ? (
                                <Archive className="h-3.5 w-3.5" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => void handleDeleteProject(selectedProject)}
                              title="Delete project"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <span>
                          Total Logged:{' '}
                          <strong className="font-mono text-foreground">
                            {formatDurationHuman(secondsByProject.get(selectedProject.id) ?? 0)}
                          </strong>
                        </span>
                        {isAdmin && (
                          <span>
                            Assigned Members:{' '}
                            <strong className="text-foreground">
                              {selectedProjectMembers.length}
                            </strong>
                          </span>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-5 pt-5">
                      {isAdmin && (
                        <div>
                          <p className="mb-2 text-xs font-medium text-muted-foreground">
                            Assigned Team Members
                          </p>
                          {selectedProjectMembers.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              No team members assigned yet. Click &ldquo;Assign Members&rdquo; to grant access.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {selectedProjectMembers.map((member) => (
                                <Badge key={member.id} variant="secondary">
                                  {member.full_name || member.email}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div>
                        <div className="mb-2.5 flex items-center justify-between">
                          <p className="text-xs font-medium text-muted-foreground">
                            Project Tasks ({selectedProjectTasks.length})
                          </p>
                          {isAdmin && (
                            <Button size="sm" variant="outline" onClick={() => setTaskOpen(true)}>
                              <Plus className="h-3.5 w-3.5" />
                              Add Task
                            </Button>
                          )}
                        </div>

                        {selectedProjectTasks.length === 0 ? (
                          <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                            No tasks created under this project yet.
                          </div>
                        ) : (
                          <div className="divide-y divide-border rounded-md border border-border">
                            {selectedProjectTasks.map((task) => (
                              <div
                                key={task.id}
                                className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium truncate">{task.title}</p>
                                  {task.description && (
                                    <p className="text-xs text-muted-foreground truncate">
                                      {task.description}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                    {formatDurationHuman(secondsByTask.get(task.id) ?? 0)}
                                  </span>
                                  {isAdmin ? (
                                    <>
                                      <Select
                                        value={task.status}
                                        onValueChange={(val) =>
                                          void handleTaskStatusChange(task.id, val as TaskStatus)
                                        }
                                      >
                                        <SelectTrigger className="h-7 w-28 text-xs">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="todo">To do</SelectItem>
                                          <SelectItem value="in_progress">In progress</SelectItem>
                                          <SelectItem value="done">Done</SelectItem>
                                        </SelectContent>
                                      </Select>
                                      <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        className="h-7 w-7 text-destructive hover:text-destructive"
                                        onClick={() => void handleDeleteTask(task.id)}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </>
                                  ) : (
                                    <Badge variant="outline" className="capitalize">
                                      {task.status.replace('_', ' ')}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </>
                )}
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Project-wise Reports Tab */}
        <TabsContent value="reports" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Hours Tracked by Project</CardTitle>
              <CardDescription className="text-xs">
                Total logged hours across each project
              </CardDescription>
            </CardHeader>
            <CardContent>
              {projectReportChartData.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No projects available to report.
                </p>
              ) : (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={projectReportChartData}
                      margin={{ top: 8, right: 16, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis
                        dataKey="name"
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
                        formatter={(val: unknown) => [`${val} hrs`, 'Logged Hours']}
                      />
                      <Bar dataKey="hours" radius={[4, 4, 0, 0]} maxBarSize={48}>
                        {projectReportChartData.map((entry) => (
                          <Cell key={entry.id} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Project Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Tasks</TableHead>
                    {isAdmin && <TableHead>Members</TableHead>}
                    <TableHead className="text-right">Logged Time</TableHead>
                    <TableHead className="text-right">Decimal Hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projectReportChartData.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: row.color }}
                          />
                          {row.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.code || '—'}</TableCell>
                      <TableCell>{row.taskCount}</TableCell>
                      {isAdmin && <TableCell>{row.memberCount}</TableCell>}
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatDurationHuman(row.seconds)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {row.hours.toFixed(2)}h
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Project Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
            <DialogDescription>
              Set up a new project and optionally assign team members.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateProject} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="projName">Project Name</Label>
                <Input
                  id="projName"
                  required
                  placeholder="Mexro Core Platform"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="projCode">Code</Label>
                <Input
                  id="projCode"
                  placeholder="MX-CORE"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="projClient">Client / Department</Label>
              <Input
                id="projClient"
                placeholder="Internal / Client Name"
                value={newClient}
                onChange={(e) => setNewClient(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="projDesc">Description</Label>
              <Textarea
                id="projDesc"
                placeholder="Brief scope of this project"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Color Tag</Label>
              <div className="flex flex-wrap gap-2">
                {PROJECT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewColor(color)}
                    className={cn(
                      'h-6 w-6 rounded-full border-2 cursor-pointer transition-transform',
                      newColor === color ? 'scale-110 border-foreground' : 'border-transparent',
                    )}
                    style={{ backgroundColor: color }}
                    aria-label={`Select color ${color}`}
                  />
                ))}
              </div>
            </div>

            {profiles.length > 0 && (
              <div className="space-y-1.5">
                <Label>Assign Team Members</Label>
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {profiles
                    .filter((p) => p.status === 'active')
                    .map((member) => (
                      <label
                        key={member.id}
                        className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={newMemberIds.includes(member.id)}
                          onChange={() =>
                            setNewMemberIds((prev) => toggleIdInList(prev, member.id))
                          }
                        />
                        <span className="font-medium">{member.full_name || member.email}</span>
                        <span className="text-muted-foreground capitalize">({member.role})</span>
                      </label>
                    ))}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                Create Project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Task Dialog */}
      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Task</DialogTitle>
            <DialogDescription>
              Create a trackable task under {selectedProject?.name}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateTask} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="taskTitle">Task Title</Label>
              <Input
                id="taskTitle"
                required
                placeholder="Authentication & RLS hardening"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="taskDesc">Description (Optional)</Label>
              <Textarea
                id="taskDesc"
                value={taskDesc}
                onChange={(e) => setTaskDesc(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTaskOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={taskSaving}>
                {taskSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Add Task
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Assign Members Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Team Members</DialogTitle>
            <DialogDescription>
              Choose which employees can view and log time against {selectedProject?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {profiles.map((member) => {
              const checked = assignMemberIds.includes(member.id);
              return (
                <label
                  key={member.id}
                  className="flex items-center justify-between rounded px-2.5 py-2 text-sm hover:bg-muted/50 cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setAssignMemberIds((prev) => toggleIdInList(prev, member.id))
                      }
                    />
                    <div>
                      <p className="font-medium leading-none">{member.full_name || member.email}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{member.email}</p>
                    </div>
                  </div>
                  {checked && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </label>
              );
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAssignments} disabled={assignSaving}>
              {assignSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Assignments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
