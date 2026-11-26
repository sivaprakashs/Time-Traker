-- ============================================================================
-- Mexro Technologies - Team Time Tracking Schema
-- Default Timezone: Asia/Kolkata
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  department text NOT NULL DEFAULT '',
  job_title text NOT NULL DEFAULT '',
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
  department text NOT NULL DEFAULT '',
  job_title text NOT NULL DEFAULT '',
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_pending_email
  ON public.invitations (lower(email))
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  client_name text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#4f46e5',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('running', 'paused', 'completed')),
  entry_type text NOT NULL DEFAULT 'timer' CHECK (entry_type IN ('timer', 'manual')),
  work_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  started_at timestamptz,
  last_resumed_at timestamptz,
  ended_at timestamptz,
  accumulated_seconds integer NOT NULL DEFAULT 0 CHECK (accumulated_seconds >= 0),
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enforce strictly one active (running or paused) timer per employee
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_timer_per_user
  ON public.time_entries (user_id)
  WHERE status IN ('running', 'paused');

CREATE INDEX IF NOT EXISTS idx_time_entries_user_date
  ON public.time_entries (user_id, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_time_entries_project_date
  ON public.time_entries (project_id, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_project_members_user
  ON public.project_members (user_id, project_id);

CREATE INDEX IF NOT EXISTS idx_tasks_project
  ON public.tasks (project_id);

-- ----------------------------------------------------------------------------
-- 2. Helper Functions & Triggers
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.prevent_non_admin_profile_privilege_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION 'Only administrators can modify role, account status, or email.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Automatically provision profile on new auth.users signup.
-- Matches pending invitations by email; if profiles is empty, first user becomes admin.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.invitations%ROWTYPE;
  v_role text := 'employee';
  v_full_name text := '';
  v_department text := '';
  v_job_title text := '';
  v_has_profiles boolean := false;
BEGIN
  SELECT *
  INTO v_invite
  FROM public.invitations
  WHERE lower(email) = lower(NEW.email)
    AND status = 'pending'
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    v_role := v_invite.role;
    v_full_name := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), v_invite.full_name, '');
    v_department := COALESCE(v_invite.department, '');
    v_job_title := COALESCE(v_invite.job_title, '');

    UPDATE public.invitations
    SET status = 'accepted', updated_at = now()
    WHERE id = v_invite.id;
  ELSE
    SELECT EXISTS (SELECT 1 FROM public.profiles) INTO v_has_profiles;
    IF NOT v_has_profiles THEN
      v_role := 'admin';
    ELSE
      v_role := 'employee';
    END IF;
    v_full_name := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW.email, '@', 1));
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, status, department, job_title, timezone)
  VALUES (
    NEW.id,
    lower(NEW.email),
    v_full_name,
    v_role,
    'active',
    v_department,
    v_job_title,
    'Asia/Kolkata'
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = CASE WHEN public.profiles.full_name = '' THEN EXCLUDED.full_name ELSE public.profiles.full_name END;

  RETURN NEW;
END;
$$;

-- Validate that task belongs to project on time_entries
CREATE OR REPLACE FUNCTION public.validate_time_entry_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_task_project_id uuid;
BEGIN
  IF NEW.task_id IS NOT NULL THEN
    SELECT project_id INTO v_task_project_id
    FROM public.tasks
    WHERE id = NEW.task_id;

    IF NOT FOUND OR v_task_project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'Selected task does not belong to the selected project.';
    END IF;
  END IF;

  IF NEW.started_at IS NOT NULL AND NEW.work_date IS NULL THEN
    NEW.work_date := (NEW.started_at AT TIME ZONE 'Asia/Kolkata')::date;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_prevent_priv_escalation ON public.profiles;
CREATE TRIGGER trg_profiles_prevent_priv_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_non_admin_profile_change();

DROP TRIGGER IF EXISTS trg_invitations_updated_at ON public.invitations;
CREATE TRIGGER trg_invitations_updated_at
  BEFORE UPDATE ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_projects_updated_at ON public.projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON public.tasks;
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_time_entries_updated_at ON public.time_entries;
CREATE TRIGGER trg_time_entries_updated_at
  BEFORE UPDATE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_time_entries_consistency ON public.time_entries;
CREATE TRIGGER trg_time_entries_consistency
  BEFORE INSERT OR UPDATE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_time_entry_consistency();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 3. Row Level Security (RLS)
-- ----------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS "profiles_select_self_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_self_or_admin"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "profiles_update_self_or_admin" ON public.profiles;
CREATE POLICY "profiles_update_self_or_admin"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (auth.uid() = id OR public.is_admin());

-- Invitations (Admin only)
DROP POLICY IF EXISTS "invitations_admin_all" ON public.invitations;
CREATE POLICY "invitations_admin_all"
  ON public.invitations FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Projects
DROP POLICY IF EXISTS "projects_select_assigned_or_admin" ON public.projects;
CREATE POLICY "projects_select_assigned_or_admin"
  ON public.projects FOR SELECT
  USING (
    public.is_admin()
    OR (
      public.is_active_user()
      AND EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = projects.id
          AND pm.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "projects_admin_insert" ON public.projects;
CREATE POLICY "projects_admin_insert"
  ON public.projects FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "projects_admin_update" ON public.projects;
CREATE POLICY "projects_admin_update"
  ON public.projects FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "projects_admin_delete" ON public.projects;
CREATE POLICY "projects_admin_delete"
  ON public.projects FOR DELETE
  USING (public.is_admin());

-- Project Members
DROP POLICY IF EXISTS "project_members_select_own_or_admin" ON public.project_members;
CREATE POLICY "project_members_select_own_or_admin"
  ON public.project_members FOR SELECT
  USING (public.is_admin() OR (public.is_active_user() AND user_id = auth.uid()));

DROP POLICY IF EXISTS "project_members_admin_insert" ON public.project_members;
CREATE POLICY "project_members_admin_insert"
  ON public.project_members FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "project_members_admin_update" ON public.project_members;
CREATE POLICY "project_members_admin_update"
  ON public.project_members FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "project_members_admin_delete" ON public.project_members;
CREATE POLICY "project_members_admin_delete"
  ON public.project_members FOR DELETE
  USING (public.is_admin());

-- Tasks
DROP POLICY IF EXISTS "tasks_select_assigned_or_admin" ON public.tasks;
CREATE POLICY "tasks_select_assigned_or_admin"
  ON public.tasks FOR SELECT
  USING (
    public.is_admin()
    OR (
      public.is_active_user()
      AND EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = tasks.project_id
          AND pm.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "tasks_admin_insert" ON public.tasks;
CREATE POLICY "tasks_admin_insert"
  ON public.tasks FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "tasks_admin_update" ON public.tasks;
CREATE POLICY "tasks_admin_update"
  ON public.tasks FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "tasks_admin_delete" ON public.tasks;
CREATE POLICY "tasks_admin_delete"
  ON public.tasks FOR DELETE
  USING (public.is_admin());

-- Time Entries
DROP POLICY IF EXISTS "time_entries_select_own_or_admin" ON public.time_entries;
CREATE POLICY "time_entries_select_own_or_admin"
  ON public.time_entries FOR SELECT
  USING (
    public.is_admin()
    OR (public.is_active_user() AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "time_entries_insert_own_or_admin" ON public.time_entries;
CREATE POLICY "time_entries_insert_own_or_admin"
  ON public.time_entries FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_active_user()
      AND user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = time_entries.project_id
          AND pm.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "time_entries_update_own_or_admin" ON public.time_entries;
CREATE POLICY "time_entries_update_own_or_admin"
  ON public.time_entries FOR UPDATE
  USING (
    public.is_admin()
    OR (public.is_active_user() AND user_id = auth.uid())
  )
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_active_user()
      AND user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = time_entries.project_id
          AND pm.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "time_entries_delete_own_or_admin" ON public.time_entries;
CREATE POLICY "time_entries_delete_own_or_admin"
  ON public.time_entries FOR DELETE
  USING (
    public.is_admin()
    OR (public.is_active_user() AND user_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 4. Server-Authoritative Timer & Dashboard RPCs
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_server_now()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT now();
$$;

CREATE OR REPLACE FUNCTION public.start_timer(
  p_project_id uuid,
  p_task_id uuid DEFAULT NULL,
  p_description text DEFAULT ''
)
RETURNS public.time_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_work_date date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_entry public.time_entries;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Active authenticated account required.';
  END IF;

  IF NOT public.is_admin() AND NOT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = p_project_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'You are not assigned to this project.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.time_entries
    WHERE user_id = v_user_id AND status IN ('running', 'paused')
  ) THEN
    RAISE EXCEPTION 'An active timer already exists. Please stop it before starting a new timer.';
  END IF;

  INSERT INTO public.time_entries (
    user_id,
    project_id,
    task_id,
    description,
    status,
    entry_type,
    work_date,
    started_at,
    last_resumed_at,
    ended_at,
    accumulated_seconds,
    duration_seconds
  )
  VALUES (
    v_user_id,
    p_project_id,
    p_task_id,
    COALESCE(p_description, ''),
    'running',
    'timer',
    v_work_date,
    v_now,
    v_now,
    NULL,
    0,
    0
  )
  RETURNING * INTO v_entry;

  RETURN v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.pause_timer(p_entry_id uuid)
RETURNS public.time_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_entry public.time_entries;
  v_delta integer := 0;
  v_total integer := 0;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Active authenticated account required.';
  END IF;

  SELECT * INTO v_entry
  FROM public.time_entries
  WHERE id = p_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Timer entry not found.';
  END IF;

  IF v_entry.user_id <> v_user_id AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to pause this timer.';
  END IF;

  IF v_entry.status <> 'running' THEN
    RAISE EXCEPTION 'Only a running timer can be paused.';
  END IF;

  v_delta := GREATEST(0, floor(extract(epoch FROM (v_now - COALESCE(v_entry.last_resumed_at, v_now))))::integer);
  v_total := v_entry.accumulated_seconds + v_delta;

  UPDATE public.time_entries
  SET accumulated_seconds = v_total,
      duration_seconds = v_total,
      last_resumed_at = NULL,
      status = 'paused'
  WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  RETURN v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_timer(p_entry_id uuid)
RETURNS public.time_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_entry public.time_entries;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Active authenticated account required.';
  END IF;

  SELECT * INTO v_entry
  FROM public.time_entries
  WHERE id = p_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Timer entry not found.';
  END IF;

  IF v_entry.user_id <> v_user_id AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to resume this timer.';
  END IF;

  IF v_entry.status <> 'paused' THEN
    RAISE EXCEPTION 'Only a paused timer can be resumed.';
  END IF;

  UPDATE public.time_entries
  SET last_resumed_at = v_now,
      status = 'running'
  WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  RETURN v_entry;
END;
$$;

CREATE OR REPLACE FUNCTION public.stop_timer(
  p_entry_id uuid,
  p_description text DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_task_id uuid DEFAULT NULL
)
RETURNS public.time_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_entry public.time_entries;
  v_delta integer := 0;
  v_total integer := 0;
  v_next_project_id uuid;
  v_next_task_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Active authenticated account required.';
  END IF;

  SELECT * INTO v_entry
  FROM public.time_entries
  WHERE id = p_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Timer entry not found.';
  END IF;

  IF v_entry.user_id <> v_user_id AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to stop this timer.';
  END IF;

  IF v_entry.status NOT IN ('running', 'paused') THEN
    RAISE EXCEPTION 'Timer is already completed.';
  END IF;

  IF v_entry.status = 'running' THEN
    v_delta := GREATEST(0, floor(extract(epoch FROM (v_now - COALESCE(v_entry.last_resumed_at, v_now))))::integer);
  END IF;

  v_total := GREATEST(1, v_entry.accumulated_seconds + v_delta);
  v_next_project_id := COALESCE(p_project_id, v_entry.project_id);
  v_next_task_id := CASE WHEN p_project_id IS NOT NULL AND p_project_id <> v_entry.project_id AND p_task_id IS NULL THEN NULL ELSE COALESCE(p_task_id, v_entry.task_id) END;

  UPDATE public.time_entries
  SET project_id = v_next_project_id,
      task_id = v_next_task_id,
      description = COALESCE(p_description, v_entry.description),
      accumulated_seconds = v_total,
      duration_seconds = v_total,
      ended_at = v_now,
      last_resumed_at = NULL,
      status = 'completed'
  WHERE id = p_entry_id
  RETURNING * INTO v_entry;

  RETURN v_entry;
END;
$$;

-- Aggregate team metrics safe for both Employees and Admins without exposing private rows
CREATE OR REPLACE FUNCTION public.get_team_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today_ist date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_week_start date := date_trunc('week', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
  v_month_start date := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
  v_active_members integer := 0;
  v_running_timers integer := 0;
  v_team_today_seconds bigint := 0;
  v_team_week_seconds bigint := 0;
  v_team_month_seconds bigint := 0;
  v_team_total_seconds bigint := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Active authenticated account required.';
  END IF;

  SELECT count(*) INTO v_active_members
  FROM public.profiles
  WHERE status = 'active';

  SELECT count(*) INTO v_running_timers
  FROM public.time_entries
  WHERE status = 'running';

  SELECT
    COALESCE(SUM(CASE WHEN work_date = v_today_ist THEN effective_seconds ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN work_date >= v_week_start AND work_date <= v_today_ist THEN effective_seconds ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN work_date >= v_month_start AND work_date <= v_today_ist THEN effective_seconds ELSE 0 END), 0),
    COALESCE(SUM(effective_seconds), 0)
  INTO
    v_team_today_seconds,
    v_team_week_seconds,
    v_team_month_seconds,
    v_team_total_seconds
  FROM (
    SELECT
      work_date,
      CASE
        WHEN status = 'running' THEN accumulated_seconds + GREATEST(0, floor(extract(epoch FROM (now() - COALESCE(last_resumed_at, now()))))::bigint)
        WHEN status = 'paused' THEN accumulated_seconds::bigint
        ELSE duration_seconds::bigint
      END AS effective_seconds
    FROM public.time_entries
  ) t;

  RETURN jsonb_build_object(
    'today_ist', v_today_ist,
    'active_members_count', v_active_members,
    'running_timers_count', v_running_timers,
    'team_today_seconds', v_team_today_seconds,
    'team_week_seconds', v_team_week_seconds,
    'team_month_seconds', v_team_month_seconds,
    'team_total_seconds', v_team_total_seconds
  );
END;
$$;

-- Safe invitation lookup for signup page before authentication
CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.invitations%ROWTYPE;
BEGIN
  SELECT * INTO v_inv
  FROM public.invitations
  WHERE token = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'email', v_inv.email,
    'full_name', v_inv.full_name,
    'role', v_inv.role,
    'department', v_inv.department,
    'job_title', v_inv.job_title,
    'status', v_inv.status,
    'expires_at', v_inv.expires_at,
    'is_valid', (v_inv.status = 'pending' AND v_inv.expires_at > now())
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_server_now() TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_timer(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_timer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_timer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stop_timer(uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_dashboard_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO anon, authenticated;
