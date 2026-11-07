# M8 screens

Built on 5 November 2026. All screens call the real routes; tested in a browser against the real server in [e2e.md](e2e.md), and by `apps/web/test/m8-screens.test.tsx`.

| Screen | Address | Who |
| --- | --- | --- |
| Campaign page: Pause, Resume, Cancel campaign; a scheduled campaign's start time, money on hold, Unschedule | `/clients/:id/campaign?campaign=<id>` | Client, staff, super admin |
| Draft summary: "Or start it later", a start time in India time and Schedule | `/clients/:id/campaign?campaign=<id>` | Client, staff, super admin |
| Admin Settings, Rules: what is set, and one form to set a rule for all clients or one client, on or off | `/admin/settings` | Super admin |
| Campaigns: every client's campaigns, filtered by client and status | `/admin/campaigns` | Super admin |
| Campaign diagnosis: the headline reason, every other reason, queue, speed and limits, failures by Meta's code, a link into the client's workspace | `/admin/campaigns?campaign=<id>` | Super admin |

Choices made while building:

- Cancel asks first, saying what happens to the money: unsent messages refunded and sent ones charged, or, for a scheduled campaign, the hold released. After it, the page says how many were stopped and how much went back.
- Pause and Resume do not ask, as both can be undone and move no money.
- A scheduled campaign shows its start time and the amount on hold (from the wallet's holds) instead of the progress tiles, as nothing is sent yet.
- The time is typed in India time and sent with `+05:30`; the box does not accept a time less than 5 minutes ahead, and the server checks it again.
- Schedule is refused in the same words as Confirm when the wallet is short ("Top up needed: ₹… short. Nothing was charged."), as both take the money.
- The Rules form fills in a rule's current values when its client and kind are chosen. Turning a rule off is saving it with On unticked; the row stays, so its history is in the audit log.
- After a cancel, cancelled messages count under Blocked (their status is `blocked`, reason `campaign_cancelled`), so "To send" shows what was actually sent.
- The diagnosis's wording comes from the server. A scheduled campaign's reason shows the start time in UTC (`2026-11-05T12:10:00.000Z`), which should be India time; that is the server's text, for its owner.
