# M3 screens

Built on 2 November 2026 by Anirudh, moved from Suraj's task list so the milestones do not wait (owner). All screens call the real routes; there is no mock for them.

| Task | Screen | Address |
| --- | --- | --- |
| S3 | Forced password change, shown instead of everything else while a first password is in use | any |
| S3 | My account: details and change password | `/account` |
| S4 | Clients list with balance and money on hold; add a client | `/admin/clients` |
| S4 | Client detail: edit, suspend or reactivate with a note, logins (add, disable, enable, reset password), assigned staff | `/admin/clients/:id` |
| S4 | Staff: list, add, assign clients, disable, enable, reset password | `/admin/staff` |
| S5 | Audit log with filters by client, person, action and date, and "Show more" | `/admin/audit` |
| S6 | Notification bell in the header: unread count, list, click marks read | every page |
| S6 | Delivery log with a status filter | `/admin/delivery-log` |

Screenshots are in [screens/](screens/).

Choices made while building:

- A suspended client shows its reason, date and who did it on every tab of its page and in the Clients list; Overview keeps the full history. The note is emailed to the client, so it is written for them to read.
- Suspending keeps a client's staff assignments, as they return when it is reactivated, but the person cannot open it and it does not count towards their clients (owner, 2 November 2026: staff are never removed automatically; removing them is the admin's choice).
- The client page has tabs: Overview, Money and prices, Logins, Staff. A new client opens on Money and prices.
- Staff are added and removed on the client's own page, with a count of how many clients each person has, and a breadcrumb shows where you are. Creating a new person from there remembers the client, ticks it, and links back (owner, 2 November 2026).
- The super admin can open a suspended client's workspace, marked Suspended in the picker. Its own users and staff cannot.
- Dates show in India time. The audit "To" date takes in that whole day.
- Every password field on every screen is hidden by default, with an eye button to show it (owner, 2 November 2026).
