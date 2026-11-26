# Mexro Time Tracker — Mexro Technologies

A production-ready **Team Time Tracking Web Application** built with React, TypeScript, Vite, Tailwind CSS, shadcn/ui components, Recharts, and Supabase (PostgreSQL + Auth + Row Level Security).

## Features

- **Authentication & Roles**: Email/password sign-in, email verification, forgot/reset password, Admin & Employee roles, and Admin team member invitations.
- **Dashboard**: Real-time today, weekly, and monthly working hours (in `Asia/Kolkata` IST), total team hours, active team members, recent work activities, and weekly/monthly Recharts analytics.
- **Accurate Time Tracking**: Start, pause, resume, and stop timers with server-authoritative PostgreSQL timestamps (`start_timer`, `pause_timer`, `resume_timer`, `stop_timer`). Strictly enforces one active timer per employee and stays accurate across page refreshes and tab switches. Includes manual time entry, editing, and deletion.
- **Projects & Tasks**: Create and archive projects, manage tasks (`todo`, `in_progress`, `done`), assign team members, and view project-wise hour reports.
- **Team Management (Admin)**: Invite employees, inspect individual daily/weekly/monthly records, manage roles (`admin`/`employee`), and activate/deactivate accounts.
- **Timesheet & Reports**: Daily, weekly, monthly, and custom date-range views with project and employee filtering, Recharts visualizations, and CSV / multi-sheet Excel (`.xlsx`) export.
- **Security**: Row Level Security (RLS) isolates employee records while granting Admins team-wide visibility.

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Supabase Environment

Copy `.env.example` to `.env` and fill in your Supabase project credentials:

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_APP_NAME=Mexro Time Tracker
VITE_DEFAULT_TIMEZONE=Asia/Kolkata
```

### 3. Run Database Migration

Open your Supabase Dashboard -> **SQL Editor** and run the contents of:

- `supabase/migrations/001_initial_schema.sql`

This creates:
- Tables: `profiles`, `invitations`, `projects`, `project_members`, `tasks`, `time_entries`
- Partial unique index enforcing at most one active (`running`/`paused`) timer per employee
- Automatic profile provisioning trigger (`handle_new_user`) — the first user to register becomes `admin`, and invited users automatically receive their invited role
- Full Row Level Security policies
- Server-timestamp RPCs (`start_timer`, `pause_timer`, `resume_timer`, `stop_timer`, `get_team_dashboard_summary`, `get_server_now`)

### 4. Deploy Invite Edge Function (Optional, for Automated Invite Emails)

```bash
supabase functions deploy invite-member
```

If the Edge Function is not deployed yet, inviting a team member in **Team Management** still creates an invitation record in Supabase and gives you a copyable `/signup?invite=...` link.

### 5. Run Development Server

```bash
npm run dev
```

### 6. Build & Test

```bash
npm test
npm run build
```
