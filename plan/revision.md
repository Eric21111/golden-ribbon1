We need to correct the **Create Branch permission** in Golden Ribbon.

## Background

Originally, Branch Management / branch creation was intended to be under the **Owner's authority**, not the Manager's.

However, during Milestone 11, this permission was changed. The migration appears to have replaced the original Owner-only branch insert/update policies with policies that allow the Main Branch Manager to manage branches.

As a result, the current application places the Branches page and Create Branch functionality under the Manager side, while the Owner does not have the intended branch creation access.

The client has now noticed this and requested that the Create Branch functionality be moved back to the Owner side.

## Your task — PLAN MODE ONLY

Inspect the current repository and prepare a detailed implementation plan to restore the intended permission.

### 1. Investigate the original and current implementation

Inspect:
- Git history and relevant Milestone 11 changes.
- Original Owner-only branch policies.
- The migration that introduced `branches_insert_main_manager` and any related update policy.
- Current Supabase RLS policies for the `branches` table.
- Owner navigation, sidebar, routes, and branch management screens.
- Manager navigation, sidebar, routes, and branch management screens.
- Branch creation forms, services, RPCs, and authorization checks.
- Existing role and permission tests.

Identify exactly which changes moved branch creation from Owner to Main Branch Manager.

### 2. Intended permission correction

The required outcome is:

- **Owner:** Can access Create Branch and create new branches.
- **Main Branch Manager:** Must no longer be authorized to create branches.
- Other unauthorized roles must not be able to create branches either.

Important: Do not automatically remove the Manager's ability to view or edit existing branches. Investigate the current behavior and original requirements, then keep existing view/edit permissions unchanged unless a change is strictly necessary. If you believe broader Branch Management should also become Owner-only, present that as a separate recommendation instead of silently including it.

### 3. Database and security requirements

The correction must be enforced at the database level, not just by hiding the Create Branch button.

Plan a new **forward-only Supabase migration** that:
- Restores Owner-only branch insertion.
- Removes the Main Branch Manager's branch-insertion authority.
- Preserves unrelated branch policies and permissions.
- Does not modify or rewrite previously deployed migrations.
- Does not delete or alter existing branch records.

Check whether branch creation uses any RPC or server-side function that also needs authorization changes.

### 4. Application requirements

Plan the necessary changes to:
- Owner navigation and sidebar.
- Owner branch management screen or route.
- Manager navigation and branch screen.
- Create Branch button and form access.
- Service-layer authorization and error handling.
- Role-based UI behavior.

Avoid duplicating branch creation logic unnecessarily. Prefer reusing the existing implementation where appropriate.

### 5. Tests and verification

Include tests that prove:

1. Owner can access the Create Branch functionality.
2. Owner can successfully create a branch.
3. Main Branch Manager cannot create a branch through the UI.
4. Main Branch Manager is also denied when attempting direct database/API insertion.
5. Other unauthorized roles cannot create branches.
6. Existing Manager permissions for viewing and editing branches remain unchanged, if that is the intended current behavior.
7. Existing branches and related records remain unaffected.

## Important project constraints

- Revision 7 has already been pushed successfully to the production Supabase database.
- Do not modify the already-deployed historical migrations.
- Any database correction must be a new migration.
- Do not run `supabase db push`.
- Do not deploy or build a new APK.
- Do not modify files yet.

## Expected Plan Mode response

Before implementation, provide:

1. Root cause, with exact file paths and migration names.
2. Original versus current permission behavior.
3. Exact files that need changes.
4. Proposed new migration and its security impact.
5. Test cases and verification commands.
6. Risks, compatibility concerns, and rollback considerations.
7. A clear list of anything that needs my approval before implementation.

**Stop after presenting the plan. Do not implement anything until I review and approve it.**