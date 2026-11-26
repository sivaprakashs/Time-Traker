import { requireSupabase } from '@/lib/supabase';
import { istDateTimeToUtcIso } from '@/lib/timezone';
import type {
  AccountStatus,
  Invitation,
  InvitationLookup,
  Profile,
  Project,
  ProjectMember,
  ProjectStatus,
  Task,
  TaskStatus,
  TeamDashboardSummary,
  TimeEntryWithRelations,
  UserRole,
} from '@/types/database';

const TIME_ENTRY_SELECT = `
  *,
  project:projects(id, name, code, color),
  task:tasks(id, title, status),
  profile:profiles(id, full_name, email, department, role)
`;

export interface ProjectBundle {
  projects: Project[];
  tasks: Task[];
  members: ProjectMember[];
}

export async function fetchProjectsBundle(): Promise<ProjectBundle> {
  const client = requireSupabase();
  const [projectsRes, tasksRes, membersRes] = await Promise.all([
    client.from('projects').select('*').order('created_at', { ascending: false }),
    client.from('tasks').select('*').order('created_at', { ascending: true }),
    client.from('project_members').select('*'),
  ]);

  if (projectsRes.error) throw new Error(projectsRes.error.message);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  if (membersRes.error) throw new Error(membersRes.error.message);

  return {
    projects: (projectsRes.data ?? []) as Project[],
    tasks: (tasksRes.data ?? []) as Task[],
    members: (membersRes.data ?? []) as ProjectMember[],
  };
}

export async function createProject(payload: {
  name: string;
  code?: string;
  description?: string;
  client_name?: string;
  color: string;
  created_by: string;
  memberIds?: string[];
}): Promise<Project> {
  const client = requireSupabase();
  const { memberIds, ...projectData } = payload;
  const { data, error } = await client
    .from('projects')
    .insert({
      name: projectData.name.trim(),
      code: projectData.code?.trim() ?? '',
      description: projectData.description?.trim() ?? '',
      client_name: projectData.client_name?.trim() ?? '',
      color: projectData.color,
      created_by: projectData.created_by,
      status: 'active',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  const project = data as Project;

  const uniqueMemberIds = Array.from(new Set(memberIds ?? []));
  if (uniqueMemberIds.length > 0) {
    const { error: memberError } = await client.from('project_members').insert(
      uniqueMemberIds.map((uid) => ({
        project_id: project.id,
        user_id: uid,
        assigned_by: projectData.created_by,
      })),
    );
    if (memberError) throw new Error(memberError.message);
  }

  return project;
}

export async function updateProject(
  projectId: string,
  patch: Partial<{
    name: string;
    code: string;
    description: string;
    client_name: string;
    color: string;
    status: ProjectStatus;
  }>,
): Promise<Project> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('projects')
    .update(patch)
    .eq('id', projectId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Project;
}

export async function deleteProject(projectId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('projects').delete().eq('id', projectId);
  if (error) throw new Error(error.message);
}

export async function setProjectMembers(
  projectId: string,
  userIds: string[],
  assignedBy: string,
): Promise<void> {
  const client = requireSupabase();
  const { error: deleteErr } = await client
    .from('project_members')
    .delete()
    .eq('project_id', projectId);
  if (deleteErr) throw new Error(deleteErr.message);

  const uniqueIds = Array.from(new Set(userIds));
  if (uniqueIds.length === 0) return;

  const { error: insertErr } = await client.from('project_members').insert(
    uniqueIds.map((userId) => ({
      project_id: projectId,
      user_id: userId,
      assigned_by: assignedBy,
    })),
  );
  if (insertErr) throw new Error(insertErr.message);
}

export async function createTask(payload: {
  project_id: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  created_by: string;
}): Promise<Task> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('tasks')
    .insert({
      project_id: payload.project_id,
      title: payload.title.trim(),
      description: payload.description?.trim() ?? '',
      status: payload.status ?? 'todo',
      created_by: payload.created_by,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Task;
}

export async function updateTask(
  taskId: string,
  patch: Partial<{ title: string; description: string; status: TaskStatus }>,
): Promise<Task> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('tasks')
    .update(patch)
    .eq('id', taskId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as Task;
}

export async function deleteTask(taskId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('tasks').delete().eq('id', taskId);
  if (error) throw new Error(error.message);
}

export interface TimeEntryFilters {
  userId?: string;
  projectId?: string;
  startDate?: string;
  endDate?: string;
  includeActive?: boolean;
  limit?: number;
}

export async function fetchTimeEntries(
  filters: TimeEntryFilters = {},
): Promise<TimeEntryWithRelations[]> {
  const client = requireSupabase();
  let query = client
    .from('time_entries')
    .select(TIME_ENTRY_SELECT)
    .order('work_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (filters.userId) query = query.eq('user_id', filters.userId);
  if (filters.projectId) query = query.eq('project_id', filters.projectId);
  if (filters.startDate) query = query.gte('work_date', filters.startDate);
  if (filters.endDate) query = query.lte('work_date', filters.endDate);
  if (!filters.includeActive) query = query.eq('status', 'completed');
  if (filters.limit) query = query.limit(filters.limit);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as TimeEntryWithRelations[];
}

export async function createManualTimeEntry(payload: {
  user_id: string;
  project_id: string;
  task_id?: string | null;
  description: string;
  work_date: string;
  start_time: string;
  end_time: string;
}): Promise<TimeEntryWithRelations> {
  const client = requireSupabase();
  const startedIso = istDateTimeToUtcIso(payload.work_date, payload.start_time);
  const endedIso = istDateTimeToUtcIso(payload.work_date, payload.end_time);

  const diffSeconds = Math.floor(
    (new Date(endedIso).getTime() - new Date(startedIso).getTime()) / 1000,
  );

  if (!Number.isFinite(diffSeconds) || diffSeconds <= 0) {
    throw new Error('End time must be after start time.');
  }

  const { data, error } = await client
    .from('time_entries')
    .insert({
      user_id: payload.user_id,
      project_id: payload.project_id,
      task_id: payload.task_id || null,
      description: payload.description.trim(),
      status: 'completed',
      entry_type: 'manual',
      work_date: payload.work_date,
      started_at: startedIso,
      ended_at: endedIso,
      last_resumed_at: null,
      accumulated_seconds: diffSeconds,
      duration_seconds: diffSeconds,
    })
    .select(TIME_ENTRY_SELECT)
    .single();

  if (error) throw new Error(error.message);
  return data as TimeEntryWithRelations;
}

export async function updateTimeEntry(
  entryId: string,
  payload: {
    project_id: string;
    task_id?: string | null;
    description: string;
    work_date: string;
    start_time?: string;
    end_time?: string;
    duration_seconds?: number;
  },
): Promise<TimeEntryWithRelations> {
  const client = requireSupabase();

  let startedIso: string | undefined;
  let endedIso: string | undefined;
  let computedSeconds = payload.duration_seconds;

  if (payload.start_time && payload.end_time) {
    startedIso = istDateTimeToUtcIso(payload.work_date, payload.start_time);
    endedIso = istDateTimeToUtcIso(payload.work_date, payload.end_time);
    const diff = Math.floor(
      (new Date(endedIso).getTime() - new Date(startedIso).getTime()) / 1000,
    );
    if (!Number.isFinite(diff) || diff <= 0) {
      throw new Error('End time must be after start time.');
    }
    computedSeconds = diff;
  }

  const updatePatch: Record<string, unknown> = {
    project_id: payload.project_id,
    task_id: payload.task_id || null,
    description: payload.description.trim(),
    work_date: payload.work_date,
  };

  if (startedIso && endedIso && computedSeconds !== undefined) {
    updatePatch.started_at = startedIso;
    updatePatch.ended_at = endedIso;
    updatePatch.accumulated_seconds = computedSeconds;
    updatePatch.duration_seconds = computedSeconds;
  }

  const { data, error } = await client
    .from('time_entries')
    .update(updatePatch)
    .eq('id', entryId)
    .select(TIME_ENTRY_SELECT)
    .single();

  if (error) throw new Error(error.message);
  return data as TimeEntryWithRelations;
}

export async function deleteTimeEntry(entryId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('time_entries').delete().eq('id', entryId);
  if (error) throw new Error(error.message);
}

export async function fetchTeamDashboardSummary(): Promise<TeamDashboardSummary> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_team_dashboard_summary');
  if (error) throw new Error(error.message);
  return data as TeamDashboardSummary;
}

export async function fetchTeamProfiles(): Promise<Profile[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

export async function updateTeamMemberProfile(
  userId: string,
  patch: Partial<{
    full_name: string;
    role: UserRole;
    status: AccountStatus;
    department: string;
    job_title: string;
  }>,
): Promise<Profile> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Profile;
}

export async function fetchInvitations(): Promise<Invitation[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('invitations')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Invitation[];
}

export interface InviteResult {
  invitation: Invitation;
  emailSent: boolean;
  inviteLink: string;
  note?: string;
}

export async function inviteTeamMember(payload: {
  email: string;
  full_name: string;
  role: UserRole;
  department: string;
  job_title: string;
  invited_by: string;
}): Promise<InviteResult> {
  const client = requireSupabase();
  const email = payload.email.trim().toLowerCase();
  const redirectTo = `${window.location.origin}/signup`;

  // 1. Try Supabase Edge Function (sends Supabase Auth invite email via Service Role)
  try {
    const { data, error } = await client.functions.invoke('invite-member', {
      body: {
        email,
        full_name: payload.full_name,
        role: payload.role,
        department: payload.department,
        job_title: payload.job_title,
        redirect_to: redirectTo,
      },
    });

    if (!error && data?.invitation) {
      const inv = data.invitation as Invitation;
      return {
        invitation: inv,
        emailSent: Boolean(data.email_sent),
        inviteLink: `${window.location.origin}/signup?invite=${inv.token}`,
        note: data.warning as string | undefined,
      };
    }
  } catch {
    // Edge function may not be deployed yet; fallback to direct invitation record
  }

  // 2. Fallback: create invitation record directly via Admin RLS so admin gets an invite link
  await client
    .from('invitations')
    .update({ status: 'revoked' })
    .ilike('email', email)
    .eq('status', 'pending');

  const { data: inv, error: insertError } = await client
    .from('invitations')
    .insert({
      email,
      full_name: payload.full_name.trim(),
      role: payload.role,
      department: payload.department.trim(),
      job_title: payload.job_title.trim(),
      invited_by: payload.invited_by,
      status: 'pending',
    })
    .select()
    .single();

  if (insertError) throw new Error(insertError.message);
  const invitation = inv as Invitation;

  return {
    invitation,
    emailSent: false,
    inviteLink: `${window.location.origin}/signup?invite=${invitation.token}`,
    note: 'Invitation saved. Share the invite signup link with your team member (deploy the invite-member Edge Function to also dispatch automatic emails).',
  };
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('invitations')
    .update({ status: 'revoked' })
    .eq('id', invitationId);
  if (error) throw new Error(error.message);
}

export async function lookupInvitationByToken(token: string): Promise<InvitationLookup | null> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_invitation_by_token', {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  return (data as InvitationLookup | null) ?? null;
}
