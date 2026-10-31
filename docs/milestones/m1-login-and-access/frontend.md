# M1 frontend: what each user sees

## 1.6.2 panel shell, mock mode (Screen ready)

Recorded on 30 October 2026 with `VITE_API_MODE=mock` (the in-browser mock in `apps/web/src/api/mock/`, seeded with the worked example; password `reaplift-dev-1`). Each user logged in through the login page. No `/api/auth` request left the browser. Screenshots are in [screens/](screens/).

| User                 | Lands on                   | Header                                 | Menu                                                            | Picker                                                       |
| -------------------- | -------------------------- | -------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| `ops@northwind.com`  | Northwind Labs, Dashboard  | Northwind Labs; no Switch client       | Dashboard, Push Campaign, Templates, Reports, Wallet, Settings  | none                                                         |
| `sales@greenleaf.in` | Greenleaf Foods, Dashboard | Greenleaf Foods; no Switch client      | Dashboard, Push Campaign, Templates, Reports, Wallet, Settings  | none                                                         |
| `meera@reaplift.com` | Choose a client            | Bluebird Retail after picking; Switch  | The six workspace pages once a client is open; no Admin         | Bluebird Retail, Northwind Labs                              |
| `ravi@reaplift.com`  | Choose a client            | Administration on Admin; Switch client | Admin; the six workspace pages plus Admin once a client is open | Bluebird Retail, Greenleaf Foods, Northwind Labs; Open Admin |

Login errors, with the messages from `apps/web/src/api/messages.ts`:

| Case                                           | Message shown                                                 |
| ---------------------------------------------- | ------------------------------------------------------------- |
| Wrong password (or unknown email)              | Wrong email or password.                                      |
| Right password after 10 failures in 15 minutes | Too many failed logins. Locked until hh:mm.                   |
| Server unreachable                             | Cannot reach the server. Check your connection and try again. |

### Screenshots

Login page:

![Login](screens/s2-login.jpg)

Wrong password:

![Wrong password](screens/s2-login-wrong-password.jpg)

Locked after 10 failures:

![Locked](screens/s2-login-locked.jpg)

`ops@northwind.com`, straight into Northwind Labs:

![Northwind Ops](screens/s2-ops-northwind.jpg)

`sales@greenleaf.in`, straight into Greenleaf Foods:

![Greenleaf Sales](screens/s2-sales-greenleaf.jpg)

`meera@reaplift.com`, the picker with her two clients:

![Meera picker](screens/s2-meera-picker.jpg)

`meera@reaplift.com` in Bluebird Retail, with Switch client:

![Meera in Bluebird](screens/s2-meera-bluebird.jpg)

`ravi@reaplift.com`, the picker with every client and Open Admin:

![Ravi picker](screens/s2-ravi-picker.jpg)

`ravi@reaplift.com` on Admin (coming soon):

![Ravi admin](screens/s2-ravi-admin.jpg)

## 1.7 against the real server

Recorded on 30 October 2026, 10:40 to 10:44 UTC, with `VITE_API_MODE` unset (real), the server and a freshly seeded database (3 clients, 4 users). Every login was `POST /api/auth/login` 200 and `GET /api/auth/me` 200 from the server; client IDs in the addresses are the database's. What each user sees matches the mock-mode table above. The full demo is in [e2e.md](e2e.md).

`ops@northwind.com`, straight into Northwind Labs:

![Northwind Ops, real](screens/c1-ops-northwind.jpg)

`sales@greenleaf.in`, straight into Greenleaf Foods:

![Greenleaf Sales, real](screens/c1-sales-greenleaf.jpg)

`meera@reaplift.com`, the picker with her two clients:

![Meera picker, real](screens/c1-meera-picker.jpg)

`meera@reaplift.com` in Bluebird Retail:

![Meera in Bluebird, real](screens/c1-meera-bluebird.jpg)

`ravi@reaplift.com`, the picker with the three clients and Open Admin:

![Ravi picker, real](screens/c1-ravi-picker.jpg)

`ravi@reaplift.com` on Admin:

![Ravi admin, real](screens/c1-ravi-admin.jpg)

`ravi@reaplift.com` after the server was restarted and the page reloaded (demo step 5):

![Ravi after restart](screens/c1-ravi-after-restart.jpg)

`sales@greenleaf.in` locked after 10 wrong passwords, right password through the panel (demo step 4, 423):

![Greenleaf Sales locked](screens/c1-sales-locked.jpg)
