# Security review, 7 November 2026

What was checked, what was found and fixed, and what is left. Done by reading every server route and by attacking the running stack (real API, worker, receiver, scheduler and panel on a throwaway database, with the fake Meta server). Nothing was tested against real Meta or a deployed server, which does not exist yet (M10).

## How the server keeps people out

- **Closed by default.** Every route falls under one access rule by its address: public (`/healthz`, login, Meta's webhook), any logged-in user, a client's own data (`/api/clients/:clientId/...`), super admin (`/api/admin/...`) or the user's own account (`/api/me/...`). A route matching no rule answers 404. A test walks every registered route and checks its rule.
- **Client data.** Before any handler runs, the server checks the caller may act for the client in the address: a client user only their own, staff only those assigned, super admin all. Every query also filters by that client. Another client's IDs look the same as IDs that do not exist (404).
- **Sessions.** The cookie is HttpOnly, Secure (except plain local development) and SameSite=Lax; the database stores only a hash of the token. Sessions end after 12 idle hours and 7 days at most, at logout, when a user is disabled, and on password change.
- **Passwords.** Stored as argon2id. Five wrong passwords in a row lock the login for 24 hours; a super admin can unlock it sooner or reset the password, and is told when it happens (changed on 7 November 2026, owner). An unknown email gets the same answer, in the same time, as a wrong password.
- **Other websites.** A change (POST, PUT, PATCH, DELETE) from any origin but the panel's is refused, and the API sends no CORS headers, so no other site can read its answers.
- **Meta's webhook.** Refused unless signed with ReapLift's app secret. Without a secret set, every webhook is refused.
- **Secrets.** Meta tokens and the two-step PIN are stored encrypted and never selected for an answer. A development key cannot be used with real Meta. Logs keep no request body and no query string.

## Can someone send without paying?

Messages are created in exactly one place, campaign confirm, which works out the charge on the server, takes it from the wallet and creates the messages in one transaction. A price, status or total sent by the browser is refused or ignored. Refunds for failed messages happen once per message (the database enforces it). Cancel refunds only messages still waiting. Ledger rows cannot be changed or deleted, even directly in the database. The command-line test send is for the operator on the server only and has no route.

## Found and fixed

| Finding | Risk | Fix |
| --- | --- | --- |
| Changing an audience's number column at the same moment as confirming could queue numbers that were not charged. | A client paying for a few numbers and sending to many. | Confirm and the number-column change both lock the list, so one waits for the other; confirm also refuses to finish if the messages queued differ from those charged. Tested. |
| An unexpected server error answered with its internal message. | Could show table names, SQL or file paths. | Errors answer "Something went wrong" and the detail goes to the log. Tested. |
| The API sent no security headers. | Framing and type-guessing attacks. | Every answer now says no framing, no type guessing, no referrer and no caching. Tested. The panel's own pages get theirs from Caddy (M10 10.3). |
| Libraries with published flaws: Fastify, fast-uri, Kysely. | None reachable as the code stands, but updates are cheap. | Updated to fixed versions; all tests pass. |
| The admin campaign diagnosis showed a scheduled start in UTC. | Wrong time read by the super admin. | Shown in India time. |

## Left to do

| Item | Risk | Plan |
| --- | --- | --- |
| No rate limits. | Password guessing across many accounts; floods of logins (each check is slow on purpose) or uploads slowing the server. | Caddy rate limits in M10 10.3, with the API reading the real caller address. |
| The panel's pages have no security headers yet (local development only). | Framing and script injection on the live site. | Caddy in M10 10.3. |
| Zod 3 and React Router 6 have published flaws fixed only in new major versions. | Zod: memory use on huge lists, but bodies are capped at 1 MB. React Router: an open redirect through links built from user input, which the panel does not do. | **Blocks the pilot (owner, 7 November 2026).** Upgrade both as a separate piece of work, with a full test run, before M11. |
| exceljs reads a whole Excel file into memory. | A 10 MB file that unpacks very large could slow the server. Only a logged-in client can upload. | Watch memory in the pilot; limit the unpacked size if it shows. |
| Up to 15 minutes after Meta moves a template to another category, a campaign is charged at the old one. | A template entered as Utility that Meta makes Marketing is charged the cheaper price for those minutes. | The 15-minute sync corrects it. Could also be read from Meta's category webhook. |
| A locked login answers differently from a wrong password. | Shows that an email has an account, after 5 tries. | Low; accepted for now. |
| Anyone who knows an email can lock that login for 24 hours with 5 wrong passwords. | A nuisance, not a way in. | A super admin can unlock it at once; rate limits (M10) make it harder. |
| A client could send outside ReapLift on ReapLift's credit line. | ReapLift is liable for everything on its credit line, and such messages skip our wallet. | Asked of Meta (question 27 in [open-questions.md](open-questions.md)). The monthly invoice check (M9) catches it; unsharing the credit line stops it. |
| No second login step for the super admin. | One stolen super admin password reaches every client and the money. | **Priority 1 (owner, 7 November 2026), before real money:** authenticator-app code for super admins, with backup codes and an emailed code for a lost phone. Not built yet. |

## Attack test results

89 checks against the running stack, all passing: no login; client B on client A's data, by address and by ID; unassigned staff; client and staff on every admin action that moves money or prices; other websites and missing Origin; unsigned, wrongly signed and forged webhooks (a forged "failed" status is never stored, so cannot refund); a price, status or total sent by the browser; 8 confirms at once (one charge); number-column changes during confirm (every queued message paid for); an empty wallet; 5 cancels at once (never refunding more than charged); changing the ledger in the database; a path in an upload's file name; a file over 10 MB; a wrong file type; a body over 1 MB; broken JSON; a quote in a filter; malformed dates and IDs; HTML in a client name; tokens, password hashes, session tokens and the PIN in answers, the audit log and the server logs; reuse after logout; a disabled user; the login lock; a suspended client.

A further 104 checks walked every page in Chrome as super admin, client and staff, at desktop and phone width: no page errors, failed requests, broken text or error on load, and the campaign controls moved money exactly (pause, resume, cancel, schedule, unschedule).
