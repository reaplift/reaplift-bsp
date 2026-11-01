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

- The super admin can open a suspended client's workspace, marked Suspended in the picker. Its own users and staff cannot.
- Dates show in India time. The audit "To" date takes in that whole day.
- Every password field on every screen is hidden by default, with an eye button to show it (owner, 2 November 2026).
