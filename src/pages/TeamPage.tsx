import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Copy,
  Eye,
  Loader2,
  MailPlus,
  Shield,
  UserCheck,
  UserX,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/toast';
import {
  fetchInvitations,
  fetchTeamProfiles,
  fetchTimeEntries,
  inviteTeamMember,
  revokeInvitation,
  updateTeamMemberProfile,
} from '@/services/api';
import {
  computeEffectiveSeconds,
  formatDurationHMS,
  formatDurationHuman,
  formatISTDate,
  formatISTTime,
  getISTDateString,
  getISTMonthBounds,
  getISTWeekBounds,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  AccountStatus,
  Invitation,
  Profile,
  TimeEntryWithRelations,
  UserRole,
} from '@/types/database';

export function TeamPage() {
  const { user, getServerNowMs } = useAuth();
  const { toast } = useToast();

  const [members, setMembers] = useState<Profile[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [entries, setEntries] = useState<TimeEntryWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite modal state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('employee');
  const [inviteDept, setInviteDept] = useState('');
  const [inviteTitle, setInviteTitle] = useState('');
  const [inviting, setInviting] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);

  // Inspect individual member hours modal
  const [selectedMember, setSelectedMember] = useState<Profile | null>(null);
  const [memberPeriod, setMemberPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  // Edit member account modal
  const [editingMember, setEditingMember] = useState<Profile | null>(null);
  const [editName, setEditName] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('employee');
  const [editStatus, setEditStatus] = useState<AccountStatus>('active');
  const [savingEdit, setSavingEdit] = useState(false);

  const todayIST = getISTDateString();
  const weekBounds = useMemo(() => getISTWeekBounds(todayIST), [todayIST]);
  const monthBounds = useMemo(() => getISTMonthBounds(todayIST), [todayIST]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const fetchStart =
        weekBounds.start < monthBounds.start ? weekBounds.start : monthBounds.start;
      const [profilesData, invitesData, entriesData] = await Promise.all([
        fetchTeamProfiles(),
        fetchInvitations(),
        fetchTimeEntries({
          startDate: fetchStart,
          endDate: monthBounds.end > weekBounds.end ? monthBounds.end : weekBounds.end,
          includeActive: true,
        }),
      ]);
      setMembers(profilesData);
      setInvitations(invitesData);
      setEntries(entriesData);
    } catch (err) {
      toast({
        title: 'Failed to load team data',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [monthBounds.end, monthBounds.start, toast, weekBounds.end, weekBounds.start]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const nowMs = getServerNowMs();

  const memberHoursMap = useMemo(() => {
    const map = new Map<
      string,
      { todaySec: number; weekSec: number; monthSec: number; isTracking: boolean }
    >();
    for (const m of members) {
      map.set(m.id, { todaySec: 0, weekSec: 0, monthSec: 0, isTracking: false });
    }
    for (const e of entries) {
      const stat = map.get(e.user_id) ?? {
        todaySec: 0,
        weekSec: 0,
        monthSec: 0,
        isTracking: false,
      };
      const secs = computeEffectiveSeconds(e, nowMs);
      if (e.status === 'running') stat.isTracking = true;
      if (e.work_date === todayIST) stat.todaySec += secs;
      if (e.work_date >= weekBounds.start && e.work_date <= weekBounds.end) {
        stat.weekSec += secs;
      }
      if (e.work_date >= monthBounds.start && e.work_date <= monthBounds.end) {
        stat.monthSec += secs;
      }
      map.set(e.user_id, stat);
    }
    return map;
  }, [entries, members, monthBounds.end, monthBounds.start, nowMs, todayIST, weekBounds.end, weekBounds.start]);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setInviting(true);
    setLastInviteLink(null);
    try {
      const res = await inviteTeamMember({
        email: inviteEmail,
        full_name: inviteName,
        role: inviteRole,
        department: inviteDept,
        job_title: inviteTitle,
        invited_by: user.id,
      });

      setLastInviteLink(res.inviteLink);
      toast({
        title: res.emailSent ? 'Invitation email dispatched' : 'Invitation link created',
        description: res.note,
        variant: 'success',
      });
      setInviteEmail('');
      setInviteName('');
      setInviteDept('');
      setInviteTitle('');
      await loadData();
    } catch (err) {
      toast({
        title: 'Invitation failed',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    } finally {
      setInviting(false);
    }
  };

  const handleCopyInviteLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: 'Invite link copied to clipboard', variant: 'success' });
    } catch {
      toast({ title: 'Could not copy automatically', description: link });
    }
  };

  const handleRevokeInvite = async (id: string) => {
    try {
      await revokeInvitation(id);
      toast({ title: 'Invitation revoked' });
      await loadData();
    } catch (err) {
      toast({
        title: 'Revoke failed',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    }
  };

  const openEditMember = (member: Profile) => {
    setEditingMember(member);
    setEditName(member.full_name);
    setEditDept(member.department);
    setEditTitle(member.job_title);
    setEditRole(member.role);
    setEditStatus(member.status);
  };

  const handleSaveMemberEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;
    if (editingMember.id === user?.id && editStatus === 'inactive') {
      toast({
        title: 'Action blocked',
        description: 'You cannot deactivate your own admin account.',
        variant: 'error',
      });
      return;
    }
    setSavingEdit(true);
    try {
      await updateTeamMemberProfile(editingMember.id, {
        full_name: editName.trim(),
        department: editDept.trim(),
        job_title: editTitle.trim(),
        role: editRole,
        status: editStatus,
      });
      setEditingMember(null);
      toast({ title: 'Employee account updated', variant: 'success' });
      await loadData();
    } catch (err) {
      toast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Unexpected error',
        variant: 'error',
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const selectedMemberEntries = useMemo(() => {
    if (!selectedMember) return [];
    return entries.filter((e) => {
      if (e.user_id !== selectedMember.id) return false;
      if (memberPeriod === 'daily') return e.work_date === todayIST;
      if (memberPeriod === 'weekly') {
        return e.work_date >= weekBounds.start && e.work_date <= weekBounds.end;
      }
      return e.work_date >= monthBounds.start && e.work_date <= monthBounds.end;
    });
  }, [
    entries,
    memberPeriod,
    monthBounds.end,
    monthBounds.start,
    selectedMember,
    todayIST,
    weekBounds.end,
    weekBounds.start,
  ]);

  const selectedMemberTotalSeconds = useMemo(
    () =>
      selectedMemberEntries.reduce(
        (acc, e) => acc + computeEffectiveSeconds(e, nowMs),
        0,
      ),
    [nowMs, selectedMemberEntries],
  );

  const pendingInvitations = invitations.filter((inv) => inv.status === 'pending');

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Team Management</h1>
          <p className="text-sm text-muted-foreground">
            Invite Mexro Technologies team members, inspect daily/weekly/monthly hours, and manage accounts.
          </p>
        </div>

        <Button
          size="sm"
          onClick={() => {
            setLastInviteLink(null);
            setInviteOpen(true);
          }}
        >
          <MailPlus className="h-4 w-4" />
          Invite Team Member
        </Button>
      </div>

      {/* Team Members Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Team Members ({members.length})</CardTitle>
          <CardDescription className="text-xs">
            Hours calculated in Asia/Kolkata (IST) for today, current week, and current month.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading team...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Today</TableHead>
                  <TableHead className="text-right">This Week</TableHead>
                  <TableHead className="text-right">This Month</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const stats = memberHoursMap.get(member.id);
                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              stats?.isTracking ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/30'
                            }`}
                            title={stats?.isTracking ? 'Currently tracking' : 'Idle'}
                          />
                          <div>
                            <p className="font-medium leading-none">
                              {member.full_name || 'Unnamed Member'}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {member.email}
                              {member.job_title ? ` · ${member.job_title}` : ''}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={member.role === 'admin' ? 'default' : 'secondary'}
                          className="capitalize"
                        >
                          {member.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={member.status === 'active' ? 'success' : 'destructive'}
                          className="capitalize"
                        >
                          {member.status === 'active' ? (
                            <UserCheck className="h-3 w-3" />
                          ) : (
                            <UserX className="h-3 w-3" />
                          )}
                          {member.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatDurationHuman(stats?.todaySec ?? 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatDurationHuman(stats?.weekSec ?? 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                        {formatDurationHuman(stats?.monthSec ?? 0)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setMemberPeriod('daily');
                              setSelectedMember(member);
                            }}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Records
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditMember(member)}
                          >
                            <Shield className="h-3.5 w-3.5" />
                            Manage
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pending Invitations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            Pending Invitations ({pendingInvitations.length})
          </CardTitle>
          <CardDescription className="text-xs">
            Invited users receive their assigned role automatically when they register with the invited email.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {pendingInvitations.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No pending invitations.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvitations.map((inv) => {
                  const link = `${window.location.origin}/signup?invite=${inv.token}`;
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.email}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {inv.full_name || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {inv.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatISTDate(inv.expires_at)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleCopyInviteLink(link)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy Link
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => void handleRevokeInvite(inv.id)}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Revoke
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Invite Modal */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Create a role-assigned invitation for a new Mexro Technologies team member.
            </DialogDescription>
          </DialogHeader>

          {lastInviteLink ? (
            <div className="space-y-4">
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300">
                Invitation created! Share this signup link with your team member:
              </div>
              <div className="flex items-center gap-2">
                <Input readOnly value={lastInviteLink} className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleCopyInviteLink(lastInviteLink)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => setInviteOpen(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleInviteSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="invEmail">Work Email</Label>
                <Input
                  id="invEmail"
                  type="email"
                  required
                  placeholder="member@mexrotechnologies.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="invName">Full Name</Label>
                  <Input
                    id="invName"
                    placeholder="Priya Nair"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(v) => setInviteRole(v as UserRole)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Employee</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="invDept">Department</Label>
                  <Input
                    id="invDept"
                    placeholder="Engineering"
                    value={inviteDept}
                    onChange={(e) => setInviteDept(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invTitle">Job Title</Label>
                  <Input
                    id="invTitle"
                    placeholder="Full Stack Developer"
                    value={inviteTitle}
                    onChange={(e) => setInviteTitle(e.target.value)}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={inviting}>
                  {inviting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send Invitation
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Individual Member Time Records Modal */}
      <Dialog
        open={Boolean(selectedMember)}
        onOpenChange={(open) => !open && setSelectedMember(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selectedMember?.full_name || selectedMember?.email} — Time Records
            </DialogTitle>
            <DialogDescription>
              Daily, weekly, and monthly working hours recorded in Asia/Kolkata (IST).
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={memberPeriod}
            onValueChange={(v) => setMemberPeriod(v as 'daily' | 'weekly' | 'monthly')}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="daily">Daily (Today)</TabsTrigger>
                <TabsTrigger value="weekly">Weekly</TabsTrigger>
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
              </TabsList>
              <span className="font-mono text-sm font-semibold tabular-nums">
                Total: {formatDurationHuman(selectedMemberTotalSeconds)} (
                {formatDurationHMS(selectedMemberTotalSeconds)})
              </span>
            </div>

            <TabsContent value={memberPeriod} className="mt-3">
              {selectedMemberEntries.length === 0 ? (
                <div className="rounded-md border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
                  No time entries recorded for this period.
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>IST Time</TableHead>
                        <TableHead className="text-right">Duration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedMemberEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="whitespace-nowrap text-xs">
                            {formatISTDate(entry.work_date)}
                          </TableCell>
                          <TableCell className="text-xs font-medium">
                            {entry.project?.name || 'Project'}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                            {entry.description || '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatISTTime(entry.started_at)} – {formatISTTime(entry.ended_at)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">
                            {formatDurationHMS(computeEffectiveSeconds(entry, nowMs))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Manage Employee Account Modal */}
      <Dialog
        open={Boolean(editingMember)}
        onOpenChange={(open) => !open && setEditingMember(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Employee Account</DialogTitle>
            <DialogDescription>{editingMember?.email}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveMemberEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="editEmpName">Full Name</Label>
              <Input
                id="editEmpName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="editEmpDept">Department</Label>
                <Input
                  id="editEmpDept"
                  value={editDept}
                  onChange={(e) => setEditDept(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="editEmpTitle">Job Title</Label>
                <Input
                  id="editEmpTitle"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={editRole} onValueChange={(v) => setEditRole(v as UserRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Account Status</Label>
                <Select
                  value={editStatus}
                  onValueChange={(v) => setEditStatus(v as AccountStatus)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingMember(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingEdit}>
                {savingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
