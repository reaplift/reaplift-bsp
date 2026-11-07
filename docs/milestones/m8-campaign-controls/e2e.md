# M8 demo, end to end

Run on 5 November 2026: the spec's demo in the panel, against PostgreSQL, with a fake Meta server. Chrome, driven by hand; real API, worker, receiver and scheduler. The same throwaway database as M7's demo (`reaplift_m7demo`), after it: Northwind has a connected number (Meta limit 2K a day), marketing at ₹0.95 + 18% GST = ₹1.13, and the completed "Diwali 2026 wave 1" (918 sent, 12 failed). See [M7's e2e.md](../m7-campaigns/e2e.md) for that setup.

Before the demo, Ravi topped up ₹15,000 ("Added ₹15,000.00.", balance ₹15,940.06) and set the number's speed to 10 a second ("Limits saved."), so a campaign is slow enough to pause by hand.

## Step 3: rules, for one client

Admin Settings, Rules. Each change audited (four `rule.changed` rows).

1. Northwind Labs, "No repeat of the same template", 24 hours, On: "Saved for Northwind Labs. It applies from the next summary or confirm." The table shows `Northwind Labs | Not the same template to a number within 24 hours | On`.
   Wave 2 (same file and template as wave 1) summary: **Will send 12; Blocked 938 = Opted out 21 + Already messaged in the last 24 hours 917.** The 12 are wave 1's failures, which never reached their numbers; 917 is wave 1's 918 sent less the number that replied STOP.
2. That rule Off; Northwind Labs, "Marketing messages per number", at most 1 a day, On. Wave 2 summary: **Will send 12; Blocked 938 = Opted out 21 + Reached the marketing limit 917.**
3. Both rules Off.

```text
     client     |        type         |            values             | enabled |      by_user
----------------+---------------------+-------------------------------+---------+-------------------
 Northwind Labs | marketing_cap       | {"count": 1, "period": "day"} | f       | ravi@reaplift.com
 Northwind Labs | repeat_within_hours | {"hours": 24}                 | f       | ravi@reaplift.com
```

## Step 1: pause, resume, cancel a 10,000-message campaign

Meera (staff): "Diwali 2026 wave 3", 10,000 new numbers. Summary: will send 10,000, charge ₹11,300.00, available after ₹4,640.06, "about 120 hours" (the number's 2K daily limit). Confirmed.

**Pause** at 130 sent: "Paused. Messages already on their way finish; nothing else is sent until you resume. Nothing is charged or refunded." Resume and Cancel campaign shown. In the database, twice 10 seconds apart: `queued 9870, read 130` both times; no ledger row.

**Resume**: "Resumed. Sending carries on." 180 sent ten seconds later.

**Diagnosis** (Ravi, Campaigns, wave 3): first "Sending normally." with 9,520 waiting, speed 10 a second, daily limit 2,000 customers, 602 left today. A minute later, Check again: **"The daily limit of 2000 customers is used up. 8918 messages are waiting, and go out as the 24 hours move on."**, 0 left today.

**Cancel** (Ravi, from "Open it in the client's workspace"). The question asked first: "Cancel Diwali 2026 wave 3? Messages not sent yet are stopped and refunded. Messages already sent stay charged. This cannot be undone." (answered yes automatically in this run, so the browser dialog did not block the test tool). The page then said **"Cancelled. 8,918 messages were not sent, and ₹10,077.34 went back to the wallet."** with Charged ₹11,300.00, Refunded ₹10,077.34, Net ₹1,222.66.

```text
 status  |    block_reason    | count
---------+--------------------+-------
 blocked | campaign_cancelled |  8918
 read    |                    |  1082

  kind  | amount_paise |             note
--------+--------------+------------------------------
 charge |     -1130000 | Campaign: Diwali 2026 wave 3
 refund |      1007734 | 8918 messages cancelled
```

1,082 sent + 8,918 cancelled = 10,000 charged. Refund 8,918 × 113 = 1,007,734 paise; net 1,082 × 113 = 122,266 paise. A second cancel: `409 {"error":"ALREADY_CANCELLED","message":"This campaign is already cancelled"}`.

Notifications: `campaign.paused` and `campaign.resumed` to Meera and `ops@northwind.com` in the panel; `campaign.cancelled` to both by email and panel.

## Step 2: schedule

Wave 2's summary, "Or start it later": 17:39 India time (the box's earliest was 17:37, now + 5 minutes). The page: **"Starts at 05 Nov 2026, 17:39 (India time). ₹1,073.50 is on hold for it and is charged when it starts."** with Unschedule and Cancel campaign; Charged ₹0.00.

Unschedule: back to a draft, and the hold released (`released_because = unscheduled`). Scheduled again for 17:40. Ravi's diagnosis: "Scheduled to start at 2026-11-05T12:10:00.000Z; its money is on hold until then."

The scheduler started it at **17:40:11**:

```text
 amount_paise | released_because | released_ist
--------------+------------------+--------------
       107350 | unscheduled      | 17:33:03
       107350 | started          | 17:40:11

  kind  | amount_paise |             note             |   ist
--------+--------------+------------------------------+----------
 charge |      -107350 | Campaign: Diwali 2026 wave 2 | 17:40:11
```

`campaign.scheduled_started` to Meera and `ops@northwind.com`, email and panel. Its 929 messages then waited for the daily limit, as the diagnosis said; 21 blocked as opted out.

## Ledger check

Scheduler restarted (the check runs at start and every 24 hours): `{"clients":1,"msg":"ledger check clean"}`. Sum of the ledger equalled the balance throughout (₹14,717.40 after the cancel).

## Not covered here

- A schedule the wallet cannot cover: refused with 402 at Schedule time, as the money is held then. Proved by `m8-screens.test.tsx` and the backend's integration tests, not run by hand.
- A scheduled campaign that cannot start at its time (for example a paused number) returning to a draft: the backend's integration tests only.
- Real Meta and real email (E1, E2, E5).
