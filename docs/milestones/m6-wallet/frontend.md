# M6 screens

Built on 2 November 2026 by Anirudh (owner moved these from Suraj's task list). All screens call the real routes. Screenshots are in [screens/](screens/).

| Task | Screen | Address | Who |
| --- | --- | --- | --- |
| S7 | Wallet: current balance, on hold, available, what is on hold, prices with GST, ledger with filters and CSV, monthly statement | `/clients/:id/wallet` | Client, staff, super admin |
| S8 | Client page, Money: the three numbers, top-up, correction, low-balance alert | `/admin/clients/:id` | Super admin |
| S9 | Client page, Prices: default, own markup or fixed price per message type; Meta's rate, price, GST and what the client pays; a warning below Meta's rate; this client's charging switches | `/admin/clients/:id` | Super admin |
| S9 | Admin Settings: GST rate and history, GST report, Meta rates, default markup, charging switches for all clients | `/admin/settings` | Super admin |

Choices made while building:

- Adding a client opens its page, where Money and Prices are, so rates are set at registration.
- The ledger CSV holds every row the filter matches, not only those on screen, and is made in the browser.
- The switch for sent but undelivered messages is shown locked, as turning it off is not built (P12).
