# Login

Dark branded staff sign-in at `app/(auth)/login.tsx`.

## Layout

- Logo: `assets/Golden_Ribbon_Logo-removebg-preview.png`
- Subtitle: “Staff sign-in”
- Email + Password + Log in
- Phone: full-width form with padding; tablet: centered column `maxWidth` ~440

Background uses the app theme (`colors.background`). App interior stays on the warm theme after sign-in.

## Keyboard

| Field | Return key | Action |
|-------|------------|--------|
| Email | Next | Focus password (`blurOnSubmit={false}`) |
| Password | Go | Submit login |

## Keyboard avoidance

- `Screen` `KeyboardAvoidingView` (iOS padding)
- Scrollable content + bottom padding so password / Log in stay above keyboard
- Android `softwareKeyboardLayoutMode: "resize"` in `app.json`
