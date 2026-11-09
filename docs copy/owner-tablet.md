# Owner tablet layouts

Owner is **supervisory** — responsive single-column layouts, **no** master–detail / POS splits.

Breakpoint: shortest edge ≥ 600 (`useLayout`).

| Tab | Tablet |
|-----|--------|
| Home | Centered ~640 (`Screen constrain`) |
| Inventory / Transfers / Returns | Centered hub ~720; `enableMasterDetail={false}`; phone-style sheet / stack detail |
| Branches / Employees | Centered hub ~720 |
| Products | 2-column catalog (~900) — browse only |
| Profile | Centered form (~520) |

Nested reports, audit, sales, shifts, create transfer, setup, receive return → `Screen constrain` (~640).

Shared hubs: Manager keeps master–detail via `enableMasterDetail` (default true).
