# M9. Reports and dashboard

- Status: Not started
- Owner: Unassigned
- Branch prefix: `m9-`
- Starts after: M7
- External prerequisites: E7 for task 9.7 (there is no Meta credit-line invoice to check against until ReapLift has its credit line)

## Outcome

A client opens the Dashboard and Reports and sees figures that match a hand count of its messages, laid out like the Dovesoft panel it already knows, and downloads files that open in Excel with the same column headings. The super admin also sees Meta's cost, the amount billed and the margin per client. Clients and staff never see Meta's cost or margin.

## Flow diagram

```mermaid
flowchart TD
  A["messages and wallet_ledger<br/>(written by M4, M6, M7)"] --> B["Scheduler refreshes daily_stats<br/>every few minutes"]
  B --> C["Dashboard: 4 tiles<br/>Yesterday, Last 15 days, This month, Last month"]
  B --> D["Day-wise bar chart"]
  E["wa_accounts"] --> F["Account box: number, name, quality, limit"]
  G["Reports page"] --> H["Month-wise campaign summary<br/>(Dovesoft SummaryDataMonthWise columns)"]
  G --> I["Per-number report for a campaign<br/>(Dovesoft Reaplift_record1 columns)"]
  H --> J["Download CSV or Excel"]
  I --> J
  K["Meta rates (entered in M6)"] --> L["Meta cost saved on each<br/>delivered, billable message"]
  L --> R["Monthly: our Meta cost vs<br/>Meta's credit-line invoice"]
  L --> M["Super admin view: Meta cost, billed,<br/>margin per client, errors by code"]
  N{"Viewer is client or staff?"} -- "yes" --> O["Meta cost and margin never returned"]
```

## Worked example

1. On 1 November, Asha opens Northwind's Dashboard. "This month" shows 0; "Last month" shows 11,214 messages and ₹10,653.30 spent; "Yesterday" (31 October) shows the Diwali wave 3 numbers. The chart shows one bar per day for the last 15 days.
2. She opens Reports, chooses October, and downloads the month-wise summary. Row 1: Sr No. 1, Month October, Year 2026, Campaign Name "Diwali 2026 wave 1", Total Count 1,000, Failed 12, Blocked 20, Delivered 902, Read 610, and so on. The file opens in Excel with exactly Dovesoft's headings.
3. She downloads the per-number report for "Diwali 2026 wave 1": 1,000 rows with `mobile_no`, `status`, `reason`, and times as `dd/mm/yyyy hh:mm:ss`.
4. Using the Meta rates Ravi entered in M6, the super admin view shows, for Northwind in October: billed ₹10,653.30, Meta cost (delivered billable messages × rate), and the margin. Asha calling the same route gets 403.
5. A count of `messages` rows for October equals every figure on the dashboard and in the downloads.
6. Meta's invoice for ReapLift's credit line arrives for October. Ravi enters its total; the check shows our recorded Meta cost for October is within 0.5% of it, and lists the accounts that differ most.

## Scope

In: `daily_stats` and its refresh, dashboard tiles and chart, account box, month-wise and per-number reports with downloads, Meta cost per message, the super admin's cost, margin and Meta error view, and the monthly check against Meta's credit-line invoice.

Out: log cleanup and archiving after 180 days (phase 2 in the HLD; D8 sets the retention); emailed month-end reports (not planned).

## Tasks

| Task | Name                                     | Depends on | Can run in parallel with |
| ---- | ---------------------------------------- | ---------- | ------------------------ |
| 9.1  | Daily stats and refresh                  | none       | 9.3, 9.4, 9.5            |
| 9.2  | Dashboard tiles, chart, account box      | 9.1        | 9.3, 9.4                 |
| 9.3  | Month-wise campaign report               | none       | all                      |
| 9.4  | Per-number campaign report               | none       | all                      |
| 9.5  | Meta cost per message                    | M6 rates   | 9.1 to 9.4               |
| 9.6  | Super admin cost, margin and errors view | 9.5        | 9.7                      |
| 9.7  | Monthly check against Meta's invoice     | 9.5, E7    | 9.6                      |

### 9.1 Daily stats and refresh

- `daily_stats` (client, date in India time, category, counts by status, client charge in paise, Meta cost in paise), refreshed by the scheduler.
- Tests: a rebuild from `messages` equals the running table; a message at 23:59 and 00:01 India time lands on the right days.
- Acceptance: the dashboard loads in under a second for a client with 6 months of data.

### 9.2 Dashboard tiles, chart, account box

- Replaces the Dashboard's empty state (M1) with the four tiles (spend and count), the day-wise chart and the account box (HLD section 4).
- Tests: date edges in India time.
- Acceptance: step 1 of the worked example; figures match a hand count.

### 9.3 Month-wise campaign report

- Columns in Dovesoft's order (`SummaryDataMonthWise`): Sr No., Month, Year, User Id, Campaign Name, Total Count, Pending, Failed, Blocked, Sent, Delivered, Not Delivered, DR Not Available, Read Count, Total Unit.
- Tests: each row's totals equal the campaign's messages.
- Acceptance: step 2; the file opens in Excel with the same headings.

### 9.4 Per-number campaign report

- Dovesoft's columns (`Reaplift_record1`): `sr_no`, `mobile_no`, `reason`, `status`, `sent_time`, `delivery_status`, `delivery_time`, `read_time`, `que_time`; times as `dd/mm/yyyy hh:mm:ss` in India time; streamed so a 200,000-row campaign does not run out of memory.
- Tests: a 200,000-row export within memory limits.
- Acceptance: step 3.

### 9.5 Meta cost per message

- Meta cost saved on each delivered, billable message (`messages.meta_cost_paise`, from 0002), using M6's `meta_rates` valid when it was delivered and the `pricing.category` from Meta's webhook. Meta bills ReapLift through its credit line, so this is ReapLift's real cost.
- Tests: cost by category and date.
- Acceptance: step 4's Meta cost equals a hand calculation.

### 9.6 Super admin cost, margin and errors view

- Per client and month: billed, Meta cost, margin; number quality and limit; Meta errors grouped by code.
- Tests: client and staff get 403 on every route here.
- Acceptance: step 4.

### 9.7 Monthly check against Meta's invoice

- The super admin enters the total of Meta's monthly credit-line invoice (and, if Meta provides per-account figures, those too). The check compares it with the Meta cost recorded in 9.5 and lists the largest differences.
- A difference above 0.5% notifies super admins (event `billing.meta_invoice_mismatch`, through M2), because it means a rate in `meta_rates` is wrong or messages are being billed in a category we did not expect.
- Tests: a planted wrong rate produces a mismatch.
- Acceptance: step 6 of the worked example.

## Data and API

Migration: `daily_stats`, `meta_invoices` (month, total, entered by, per-account figures if available). `meta_rates` belongs to M6.

Routes: `GET /api/clients/:clientId/dashboard`, `GET /api/clients/:clientId/reports/monthly?month=`, `GET /api/clients/:clientId/campaigns/:id/report` (CSV or Excel), `GET /api/admin/meta-view?month=`, `GET`/`POST /api/admin/meta-invoices`.

## Notifications

Only `billing.meta_invoice_mismatch` to super admins (task 9.7). Reports are made when someone asks for them, so they send nothing.

## Open questions

| Question                                     | Default                                                | Decides |
| -------------------------------------------- | ------------------------------------------------------ | ------- |
| Report counts: Dovesoft buckets or a funnel? | Dovesoft buckets in downloads, funnel on the dashboard | Owner   |

## Current reality

The Dashboard shows mock figures (`apps/web/src/data/mockData.ts`) until M1 replaces them with an empty state.

## Demo (milestone acceptance)

Using the campaigns from M7 and M8's demos: run the worked example, compare every figure to a SQL `count(*)`, open both downloads in Excel, and show the 403 for a client on the super admin view. Record in `e2e.md`.
