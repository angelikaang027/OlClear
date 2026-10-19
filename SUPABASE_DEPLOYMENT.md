# Supabase deployment

OLClearApp uses Supabase Auth, Postgres, Storage, Realtime, and two Edge Functions. The app build needs the public project URL and publishable/anon key; the service role key must stay in Supabase and must never be added to an `EXPO_PUBLIC_*` variable.

## 1. Configure the app

Set these values in the local `.env` for development, or in the Expo/EAS environment for builds:

```text
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<publishable-or-anon-key>
```

Restart Expo after changing the app environment. Do not configure an admin PIN in the client; administrator accounts are created from User Management by an active administrator.

## 2. Set up a clean database and apply the workflow

Apply the migrations in timestamp order. The core migration creates missing tables and uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` to extend existing OLClear tables. It seeds the 10 office catalog rows. The workflow migration installs the functions, security policies, Storage access, and Realtime setup. The follow-up migrations repair clearance RLS recursion, remove legacy permissive policies, normalize clearance item statuses, reconcile the legacy/canonical reference columns used by proof eligibility, and route proof metadata inserts through a checked RPC. The migrations do not seed institution-specific academic departments or programs; add those in Admin after the first administrator is configured. Existing tables must still use UUID identifiers and have no duplicate rows for the unique keys added by the core migration.

For a local Supabase project, run `supabase start` and then `supabase db reset` from this directory. For a newly created remote project, install and authenticate the Supabase CLI, link this directory to that empty project, then run:

```sh
supabase db push
```

These files replace the prior migration history. Do not use `supabase db push` against a project that has the old migration versions recorded. For an existing project, review the schema and data first, then run only unapplied migration files in timestamp order from the Supabase SQL Editor; resolve any duplicate key data before applying unique indexes. Apply `20261017000002_fix_clearance_rls_recursion.sql`, `20261017000003_harden_legacy_rls_policies.sql`, `20261017000004_fix_proof_submission_eligibility.sql`, and `20261017000005_rpc_clearance_proof_submission.sql` if they have not already run. Keep a database backup before applying workflow changes to a project with live data.

### Bootstrap the first administrator

Public registration can create only student and pending staff accounts. After applying the migrations, register and verify the intended first administrator's account, then open `supabase/bootstrap_first_admin.sql` in the Supabase SQL Editor, replace the email placeholder, and run it once. The script promotes only that verified account, requires its OLClear profile to exist, and stops if an active administrator is already present. Afterward, create and manage other accounts from the Admin User Management screen.

The workflow migration adds staff assignment controls, Accounting review and ledger workflows, Auth profile creation, public admin-role protection, account suspension checks, scheduled clearance periods, and a Guidance exit-survey table. Active staff can read their own office assignment for sign-in routing; assignment changes remain administrator-only. Future periods activate on the first authenticated period request on or after the start date; student submissions are restricted to the configured date window. Clearance-item and proof updates go through role-checked database RPCs; direct authenticated table updates are revoked. Accounting approval requires a student-owned, correctly classified clearance-paper upload and a configured fee ledger; Accounting enters actual amounts (including explicit zeroes) before approval. Survey responses are readable by the student and active Guidance staff; writes go through a role- and clearance-checked database function. Admin request voiding preserves the request, requires a reason, records the action, and can be reversed by an administrator. Voided requests are hidden from student and staff workflows. The migration configures the private proof bucket's file types and size.

Before opening a clearance period, populate `academic_departments` and `programs` with the College's current catalog. Student registration validates department and program selections against those catalogs.

## 3. Deploy the Edge Functions

```sh
supabase functions deploy admin-manage-user
supabase functions deploy verify-clearance
```

`admin-manage-user` handles browser CORS preflight requests itself, then validates the caller's bearer token with `auth.getUser()` and checks the caller's active admin profile before performing any action. Its `verify_jwt = false` setting lets unauthenticated `OPTIONS` preflight requests reach that CORS handler; it does not permit unauthenticated account operations. `verify-clearance` is intentionally public because it serves QR scans; it accepts only a UUID token and returns validity, clearance period, and completion date for an approved clearance. It does not return student identifiers. Supabase supplies the service role secret to the function runtime. Never copy that secret into the app.

## 4. Configure Auth email delivery

Configure Supabase Auth's email provider and confirmation/OTP templates for the school's signup and password recovery process. Set allowed redirect URLs to the application's configured `olclear` scheme for invite and recovery flows where supported by the selected Auth email template.

## 5. Build and release

Run `npm run lint` and build the intended native targets with Expo/EAS after configuring the target environments. The Terms and Privacy Policy screens still contain institutional-review copy; WLC should supply its approved terms and privacy contact/details before production release.
