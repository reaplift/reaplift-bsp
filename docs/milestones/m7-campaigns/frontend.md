# M7 screens

Built on 2 November 2026 by Anirudh (owner moved these from Suraj's task list). All screens call the real routes. Screenshots are in [screens/](screens/).

| Screen | Address | Who |
| --- | --- | --- |
| Push Campaign: list of campaigns | `/clients/:id/campaign` | Client, staff, super admin |
| New campaign: name, approved template, audience file, opt-in tick | `?new=1` | Client, staff, super admin |
| Draft: audience preview and number column, invalid rows download, variables with preview, summary, confirm | `?campaign=<id>` | Client, staff, super admin |
| Campaign page: progress, counts, estimate, money, why messages failed; refreshes every 5 seconds while sending | `?campaign=<id>` | Client, staff, super admin |
| Client page, Opt-outs: add, list, remove | `/admin/clients/:id?tab=optouts` | Super admin |
| Admin Settings, Stop words | `/admin/settings` | Super admin |

Choices made while building:

- The draft is saved on the server from the first step, so someone can leave and come back with the column and variables kept.
- The counts add up: a delivered message also counts as sent, and a read one as delivered. The server keeps each message under its latest status only.
- The summary shows how many messages are charged, since blocked messages are charged today (M6's switches) and the charge would otherwise look wrong next to "Will send".
- Short of money, Confirm is off and the page says how much is short. If money is spent after the summary, the refused confirm says the same.
- A file's type is decided by its ending, as browsers give CSV files different types.
- Pause, resume, cancel and schedule are M8, so they are not here. A failure reason shows Meta's own title, so its wording is only known against real Meta.
