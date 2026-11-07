# M9 screens

Built on 6 November 2026. All screens call the real routes; run in a browser against the real server in [e2e.md](e2e.md), and tested by `apps/web/test/m9-screens.test.tsx`.

| Screen | Address | Who |
| --- | --- | --- |
| Dashboard: four tiles (Yesterday, Last 15 days, This month, Last month) with messages and spend; day-wise chart for 15 days with the same figures in a table; the WhatsApp account box | `/clients/:id/dashboard` | Client, staff, super admin |
| Reports: month-wise campaign summary under Dovesoft's headings, with CSV and Excel downloads for the chosen month; per-number report for a chosen campaign, CSV or Excel | `/clients/:id/reports` | Client, staff, super admin |
| Meta cost and margin: credit line used against the limit, and the form to set it; billed, GST, Meta cost and margin per client with totals; numbers' quality and limit; Meta errors by code; Meta's invoice check and the invoices entered | `/admin/meta-cost` | Super admin |

Choices made while building:

- The chart is plain bars (no chart library); the table under it carries the same numbers for screen readers and for checking by eye.
- Days on the chart are shown as the server counted them (India time), whatever the browser's time zone.
- The month boxes start at this month in India time.
- Downloads are plain links to the server's routes, so the session cookie goes with them and a large per-number report streams straight to disk.
- The per-number picker lists only confirmed campaigns; a draft has no messages.
- On screen, Total Unit reads like every other amount (₹1,059.94); the download keeps Dovesoft's plain `1059.94`.
- The invoice's per-account figures are typed one per line as `account ID, rupees`. Any ID without spaces is taken, as the server takes any.
- The credit limit and invoice are typed in rupees and sent in paise.
- A client or staff member typing `/admin/meta-cost` goes to their home page and no admin route is called.
