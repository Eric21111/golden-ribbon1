# Employees Tab

Owner-only **Employee hub**. Managers and Cashiers have no Employees tab.

Matches other hubs: search, filter dropdowns, sticky CTA, `FlatList` + pull-to-refresh. Create / edit / reset password open as **bottom-sheet modals**.

| Role | Route | Screen |
|------|-------|--------|
| Owner | `/owner/employees` | `app/(owner)/owner/employees/index.tsx` |

Shared: `src/features/employees/EmployeeHub.tsx`

---

## Shell

```
Header · Managers and Cashiers
Search (name or email)
Dropdowns (defaults): All Roles · All Branches · All Status
Employee list (pull to refresh)
Sticky CTA: [ Create employee ] → modal
```

---

## Row actions

| Action | Behavior |
|--------|----------|
| Edit | Bottom sheet with `EditEmployeeForm` |
| Reset | Bottom sheet with `ResetPasswordForm` |
| Deactivate / Activate | Confirm alert, then update |

---

## Modals

| Modal | Form |
|-------|------|
| Create employee | `CreateEmployeeForm` |
| Edit employee | `EditEmployeeForm` (+ Reset password shortcut) |
| Reset password | `ResetPasswordForm` |

Legacy stack routes `/owner/employees/create`, `/[id]`, `/[id]/reset-password` redirect to the list.

---

## Related create modals (other tabs)

| Tab | Create CTA |
|-----|------------|
| Branches | Bottom sheet `BranchForm` |
| Products | Bottom sheet `ProductForm` |
