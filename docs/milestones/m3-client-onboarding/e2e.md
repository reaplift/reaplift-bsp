# M3 demo, end to end

Run on 6 November 2026: the spec's worked example in the real panel, against PostgreSQL, with `EMAIL_PROVIDER=fake`. Chromium driven by `playwright-cli`, one browser session per person (Ravi, Asha, Meera, Kiran). Real API and worker as separate processes.

## Setup

A fresh throwaway database (`reaplift_m3demo`), migrated (0001 to 0017), with one user: Ravi, super admin, made with `cli create-user`. No clients. The API ran on port 3100 and the panel on 5174 (`PANEL_ORIGIN=http://localhost:5174`, `SESSION_COOKIE_SECURE=false`), because another copy held 3000 and 5173.

Two additions to the worked example: Ravi also creates Bluebird Retail in step 1, because step 4 assigns it; and in step 5 Bluebird gets a login (Kiran Shah, `kiran@bluebird.in`), so "Bluebird's users" exist to be told.

## The steps

1. **Ravi creates Northwind Labs** (India, `ops@northwind.com`), then Bluebird Retail (`accounts@bluebird.in`). Each opens its client page; the list shows both Active. `client.created` audited for each.
2. **Ravi adds Asha Rao** (`asha@northwind.com`, first password `Temp-4821-north`) on Northwind's Logins tab: Active. Her email, from the fake provider's log:

   ```text
   TO: asha@northwind.com | SUBJECT: Your ReapLift login is ready
   Hello Asha Rao,

   Your ReapLift login is ready.
   Panel: http://localhost:5174
   Email: asha@northwind.com

   Your first password will be given to you by ReapLift, and you will choose a new one when you first log in.
   ```

3. **Asha logs in with the first password**: "Choose a new password. You are using a first password set by ReapLift. Choose your own to continue." Before she does, the server refuses her pages: `GET /api/clients/<Northwind>/wallet -> 403 {"error":"PASSWORD_CHANGE_REQUIRED"}`. After the change, Northwind's Dashboard opens.
4. **Ravi creates staff user Meera** with Bluebird Retail and Northwind Labs ticked. She logs in, changes her first password, and the picker shows exactly `Bluebird Retail, Northwind Labs`. Her emails: "Your ReapLift login is ready" and "Your ReapLift clients have changed: You are now assigned to: Bluebird Retail, Northwind Labs."

### Server restart after step 4

API (PID 19352) and worker (PID 41240) stopped; port 3100 then refused connections and `/healthz` did not answer. Both started again (API PID 42964). The same SQL before and after gave identical output (`diff` printed nothing):

```text
      name       | status | country_calling_code |    contact_email
-----------------+--------+----------------------+----------------------
 Bluebird Retail | active | 91                   | accounts@bluebird.in
 Northwind Labs  | active | 91                   | ops@northwind.com

       email        |    role     | status | must_change_password |     client
--------------------+-------------+--------+----------------------+----------------
 asha@northwind.com | client      | active | f                    | Northwind Labs
 meera@reaplift.com | staff       | active | f                    |
 ravi@reaplift.com  | super_admin | active |                      |

       staff        |     client
--------------------+-----------------
 meera@reaplift.com | Bluebird Retail
 meera@reaplift.com | Northwind Labs

       email        | live_sessions
--------------------+---------------
 asha@northwind.com |             1
 meera@reaplift.com |             1
 ravi@reaplift.com  |             1
```

In the panel, a reload of each person's page after the restart kept them logged in, on the same page, with the same data: Ravi on Admin, Asha on Northwind's Dashboard, Meera on her picker with both clients. Steps 5 to 7 ran on the restarted server.

5. **Ravi suspends Bluebird** with the note "invoice overdue": "Suspended on 06 Nov 2026, 12:30 by Ravi. Reason: invoice overdue". Kiran, after choosing his own password, sees Bluebird in his picker as **"Suspended. This account is suspended: invoice overdue. Contact ReapLift."** and cannot open it; the server says `403 {"error":"CLIENT_SUSPENDED","message":"This client is suspended"}`. Meera sees the same on Bluebird, is sent back to her picker when she types its address, and still opens Northwind. Kiran and Meera each got "Bluebird Retail is suspended on ReapLift. Note: invoice overdue. Contact ReapLift." by email and in the panel.
6. **Ravi resets Asha's password** to `Temp-9054-north` (the panel asks to confirm first). Asha's open page went to Login at its next reload: the reset ended her session. Logging in with the new first password asked her to choose a new one again; after that her workspace opened. Her email: "Your ReapLift password was reset. ReapLift reset your password. ReapLift will give you the new first password, and you will choose your own when you next log in."
7. **Audit, filtered to Northwind Labs** (panel):

   ```text
   06 Nov 2026, 12:31  Ravi  user.password_reset  Northwind Labs  {}
   06 Nov 2026, 12:26  Ravi  user.created         Northwind Labs  {"after":{"name":"Asha Rao","role":"client","email":"asha@northwind.com",...}}
   06 Nov 2026, 12:25  Ravi  client.created       Northwind Labs  {"after":{"name":"Northwind Labs","contactEmail":"ops@northwind.com","countryCallingCode":"91"}}
   ```

   **Fails one part of step 7: "staff assigned" is not in the list.** See below.

## Rows after step 7

```text
      name       |  status   | country_calling_code |    contact_email
-----------------+-----------+----------------------+----------------------
 Bluebird Retail | suspended | 91                   | accounts@bluebird.in
 Northwind Labs  | active    | 91                   | ops@northwind.com

       email        |    role     | status | must_change_password |     client
--------------------+-------------+--------+----------------------+-----------------
 asha@northwind.com | client      | active | f                    | Northwind Labs
 kiran@bluebird.in  | client      | active | f                    | Bluebird Retail
 meera@reaplift.com | staff       | active | f                    |
 ravi@reaplift.com  | super_admin | active |                      |

       staff        |     client
--------------------+-----------------
 meera@reaplift.com | Bluebird Retail
 meera@reaplift.com | Northwind Labs

 id |   ist    |      by_user      |       action        |     client      | entity_type
----+----------+-------------------+---------------------+-----------------+-------------
  1 | 12:25:53 | ravi@reaplift.com | client.created      | Northwind Labs  | client
  2 | 12:26:00 | ravi@reaplift.com | client.created      | Bluebird Retail | client
  3 | 12:26:38 | ravi@reaplift.com | user.created        | Northwind Labs  | user
  4 | 12:27:49 | ravi@reaplift.com | user.created        |                 | user        (Meera; "clientIds": [Bluebird, Northwind])
  5 | 12:30:05 | ravi@reaplift.com | user.created        | Bluebird Retail | user
  6 | 12:30:10 | ravi@reaplift.com | client.suspended    | Bluebird Retail | client      ({"note": "invoice overdue", "before": {"status": "active"}, "after": {"status": "suspended"}})
  7 | 12:31:58 | ravi@reaplift.com | user.password_reset | Northwind Labs  | user

        event        |        email         | channel | status
---------------------+----------------------+---------+--------
 client.created      | ops@northwind.com    | email   | sent
 client.created      | accounts@bluebird.in | email   | sent
 user.created        | asha@northwind.com   | email   | sent
 user.created        | meera@reaplift.com   | email   | sent
 staff.assigned      | meera@reaplift.com   | email   | sent
 staff.assigned      | meera@reaplift.com   | panel   | sent
 user.created        | kiran@bluebird.in    | email   | sent
 client.suspended    | kiran@bluebird.in    | email   | sent
 client.suspended    | kiran@bluebird.in    | panel   | sent
 client.suspended    | meera@reaplift.com   | email   | sent
 client.suspended    | meera@reaplift.com   | panel   | sent
 user.password_reset | asha@northwind.com   | email   | sent
```

## Emails from the fake provider's log

```text
ops@northwind.com      | Northwind Labs is set up on ReapLift
accounts@bluebird.in   | Bluebird Retail is set up on ReapLift
asha@northwind.com     | Your ReapLift login is ready
meera@reaplift.com     | Your ReapLift login is ready
meera@reaplift.com     | Your ReapLift clients have changed
kiran@bluebird.in      | Your ReapLift login is ready
kiran@bluebird.in      | Bluebird Retail is suspended on ReapLift
meera@reaplift.com     | Bluebird Retail is suspended on ReapLift
asha@northwind.com     | Your ReapLift password was reset
```

None of the six passwords used (first or chosen) appears in any email or in any log line of the four server processes, and no process logged an error.

## Found in the run

- **A staff assignment is never in a client's audit list.** Both `user.created` (staff made with clients ticked) and `staff.assigned` (Assign clients) are written with no `client_id`, the clients only inside `details`, and the audit filter matches `client_id` alone. So step 7's "staff assigned" row cannot appear under Northwind. The integration test for step 7 does not check for it, which is how it passed. M3 is not Done until this is fixed or the owner accepts it.
- `user.password_reset` has empty details (`{}`); there is no before or after to show without the password, so this is taken as correct.
