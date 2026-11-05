# M5 screens

Built on 2 November 2026 by Anirudh (owner moved these from Suraj's task list). All screens call the real routes. Screenshots are in [screens/](screens/).

| Screen | Address | Who |
| --- | --- | --- |
| Client page, WhatsApp number: connect manually, quality and Meta's limit, speed and daily limit, resume, share credit line, replace token | `/admin/clients/:id?tab=number` | Super admin |
| Numbers and limits: every number's limits, what it used in 24 hours, what is left and waiting, and the same overall | `/admin/numbers` | Super admin |
| Admin Settings, Promotional words | `/admin/settings` | Super admin |
| Templates: list, editor with live preview, our checks with how to fix each, picture, video or document upload, status while Meta decides, rejection explained, copy | `/clients/:id/templates` | Client, staff, super admin |
| Settings: the client's number, its quality and limit, why it is paused | `/clients/:id/settings` | Client, staff, super admin |

Choices made while building:

- **Connect WhatsApp (built 5 November 2026).** On a client's Settings while no number is connected. It loads Meta's SDK when the page opens (a pop-up opened after a wait is blocked), opens Meta's Embedded Signup v4, waits for both the code and the `FINISH` message with the account and number IDs, and sends them to `POST /api/clients/:clientId/wa-accounts/embedded-signup`. Cancel, Meta's error, a finish with no number, or the IDs not arriving within 10 seconds each show a message and send nothing. Without `VITE_META_APP_ID` and `VITE_META_CONFIG_ID` the button stays disabled with a note to contact ReapLift. Tested in a browser with a stand-in for Meta's SDK ([test-evidence.md](test-evidence.md)); Meta's real pop-up needs ReapLift's Meta app on an HTTPS address (E3), which keeps M5 from Done.
- The account box on Settings shows who pays Meta for the number ("ReapLift credit line" for numbers connected through Embedded Signup).
- An open template checks for Meta's answer every 3 seconds while it is on its way, so the result shows without a reload.
- The Share credit line button shows only on a number waiting for it; Resume shows on any other paused number.
- A rejected template is edited first and then submitted, as it cannot go back to Meta unchanged.
- Media can only be uploaded once a template is saved, as the file belongs to the saved template.

Also added in this round, outside M5's own list:

- A suspended client's users and staff see the reason in the client picker. It is the note the super admin typed, which the client is already emailed.
- Disable and Reset password ask first. Enabling does not.
- Generate password on the first-password and reset forms: 14 characters from the browser's secure random source, leaving out look-alike letters, and shown so it can be read out.
