---
name: setExtraHeaders / clearExtraHeaders in api-client-react
description: Custom functions added to lib/api-client-react/src/custom-fetch.ts to support admin token injection globally across all API calls.
---

The HutaoTik admin page needs to set `x-admin-token` header on all API calls after login. The generated Orval client has no built-in support for per-session headers, so two functions were added manually to `lib/api-client-react/src/custom-fetch.ts`:

- `setExtraHeaders(headers: Record<string, string>)` — merges headers into a module-level `_extraHeaders` map; each is applied to every fetch call.
- `clearExtraHeaders()` — resets `_extraHeaders` to `{}` (called on logout).

Both are exported from `lib/api-client-react/src/index.ts`.

**Why:** The admin token is stored in localStorage and must be sent as `x-admin-token` with every protected API call. Orval's generated hooks don't accept per-call headers, so a global injection point was needed.

**How to apply:** After editing `lib/api-client-react/src/custom-fetch.ts`, always run `pnpm run typecheck:libs` before restarting the hutaotik workflow so the updated declarations are picked up by Vite's dev server.
