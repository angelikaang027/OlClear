# Supabase deployment

OLClearApp uses Supabase Auth, Postgres, Storage, Realtime, and two Edge Functions. The app build needs the public project URL and publishable/anon key; the service role key must stay in Supabase and must never be added to an `EXPO_PUBLIC_*` variable.

## 1. Configure the app

Set these values in the local `.env` for development, or in the Expo/EAS environment for builds:

```text
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<publishable-or-anon-key>
```

Restart Expo after changing the app environment. Do not configure an admin PIN in the client; administrator accounts are created from User Management by an active administrator.

## 2. Confirm the base schema and apply the workflow migrations

The checked-in migrations extend the existing OLClear Supabase database; they are not a zero-to-one database bootstrap. Before pushing them to a new project, provision the base schema from the original OLClear database setup. It must include `users`, `clearance_periods`, `clearance_requests`, `clearance_items`, `offices`, `staff_office_assignments`, `academic_departments`, the `user_role_enum` type, and the `clearance_proofs` Storage bucket. Several migrations alter or secure these existing objects and will fail if the base schema is absent.

For an already provisioned OLClear project, install and authenticate the Supabase CLI, link this directory to that project, then run:

```sh
supabase db push
```

### Bootstrap the first administrator

Public registration can create only student and pending staff accounts. After applying the migrations, register and verify the intended first administrator's account, then open `supabase/bootstrap_first_admin.sql` in the Supabase SQL Editor, replace the email placeholder, and run it once. The script promotes only that verified account, requires its OLClear profile to exist, and stops if an active administrator is already present. Afterward, create and manage other accounts from the Admin User Management screen.

The migrations add staff assignment controls, accounting workflows, Auth profile creation, public admin-role protection, coordinated account suspension checks, scheduled clearance periods, and a Guidance exit-survey table. Active staff can read their own office assignment for sign-in routing; assignment changes remain administrator-only. Future periods activate on the first authenticated period request on or after the start date; student submissions are restricted to the configured date window. Clearance-item and proof updates go through role-checked database RPCs; direct authenticated table updates are revoked. Accounting approval requires a student-owned, correctly classified clearance-paper upload and a configured fee ledger; ordinary documents no longer inherit that classification. New ledgers start unconfigured with no assumed fees, and Accounting must enter actual amounts (including explicit zeroes) before approval. Existing ledger rows are marked unconfigured by the migration and are not rewritten; Accounting should review and re-enter verified fees for students in the active queue. Survey responses can be read by the student and active staff assigned to Guidance; writes go through a role- and clearance-checked database function. Admin request voiding preserves the request, requires a reason, records the action, and can be reversed by an administrator. Voided requests are hidden from student and staff workflows. The migrations also configure the private proof bucket's file types and size. Review the target project's current schema and backup policy before applying them.

Before opening a clearance period, ensure the `offices`, `academic_departments`, and `programs` catalogs contain the College's current data. Signup reads only the public office IDs/codes/names and academic catalogs; student registration validates department and program selections against those catalogs.

## 3. Deploy the Edge Functions

```sh
supabase functions deploy admin-manage-user
supabase functions deploy verify-clearance
```

`admin-manage-user` requires JWT verification and checks the caller's active admin profile. `verify-clearance` is intentionally public because it serves QR scans; it accepts only a UUID token and returns validity, clearance period, and completion date for an approved clearance. It does not return student identifiers. Supabase supplies the service role secret to the function runtime. Never copy that secret into the app.

## 4. Configure Auth email delivery

Configure Supabase Auth's email provider and confirmation/OTP templates for the school's signup and password recovery process. Set allowed redirect URLs to the application's configured `olclear` scheme for invite and recovery flows where supported by the selected Auth email template.

## 5. Build and release

Run `npm run lint` and build the intended native targets with Expo/EAS after configuring the target environments. The Terms and Privacy Policy screens still contain institutional-review copy; WLC should supply its approved terms and privacy contact/details before production release.
