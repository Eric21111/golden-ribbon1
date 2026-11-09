# Profile Tab

Shared **Account** screen for Owner, Manager, and Cashier. Same UI; only routes differ.

| Role | Route | Screen |
|------|-------|--------|
| Owner | `/owner/profile` | `app/(owner)/owner/profile.tsx` → `AccountScreen` |
| Manager | `/manager/profile` | `app/(manager)/manager/profile.tsx` |
| Cashier | `/cashier/profile` | `app/(cashier)/cashier/profile.tsx` |

Shared: `src/features/profile/AccountScreen.tsx`

---

## Shell

```
Header · Your staff account
Identity (name · role · Active/Inactive)
Details (email · branch · role)
[ Change password ] → bottom sheet
Sticky footer: [ Log out ] → confirm prompt
```

**Tablet:** centered form column (`formMaxWidth` 520) via `ConstrainedWidth`.

---

## Actions

| Action | Behavior |
|--------|----------|
| Change password | Scrollable `BottomSheet` with `ChangePasswordForm`; closes after success |
| Log out | `confirmAction` prompt, then `signOut` → `/` |

Legacy `/…/change-password` routes redirect to each role’s profile.

---

## Display fields

| Field | Source |
|-------|--------|
| Name | `profile.full_name` |
| Role | `profile.role` |
| Status | `profile.is_active` |
| Email | `session.user.email` |
| Branch | `profile.branch?.name` or “All branches” |
