export type UserRole = 'admin' | 'employee';
export type AccountStatus = 'active' | 'inactive';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked';
export type ProjectStatus = 'active' | 'archived';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TimeEntryStatus = 'running' | 'paused' | 'completed';
export type TimeEntryType = 'timer' | 'manual';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status: AccountStatus;
  department: string;
  job_title: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface Invitation {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  department: string;
  job_title: string;
  token: string;
  invited_by: string | null;
  status: InvitationStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface InvitationLookup {
  email: string;
  full_name: string;
  role: UserRole;
  department: string;
  job_title: string;
  status: InvitationStatus;
  expires_at: string;
  is_valid: boolean;
}

export interface Project {
  id: string;
  name: string;
  code: string;
  description: string;
  client_name: string;
  color: string;
  status: ProjectStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  assigned_by: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimeEntry {
  id: string;
  user_id: string;
  project_id: string;
  task_id: string | null;
  description: string;
  status: TimeEntryStatus;
  entry_type: TimeEntryType;
  work_date: string;
  started_at: string | null;
  last_resumed_at: string | null;
  ended_at: string | null;
  accumulated_seconds: number;
  duration_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface TimeEntryWithRelations extends TimeEntry {
  project?: Pick<Project, 'id' | 'name' | 'code' | 'color'> | null;
  task?: Pick<Task, 'id' | 'title' | 'status'> | null;
  profile?: Pick<Profile, 'id' | 'full_name' | 'email' | 'department' | 'role'> | null;
}

export interface TeamDashboardSummary {
  today_ist: string;
  active_members_count: number;
  running_timers_count: number;
  team_today_seconds: number;
  team_week_seconds: number;
  team_month_seconds: number;
  team_total_seconds: number;
}
