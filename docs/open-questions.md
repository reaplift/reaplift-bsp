# Open questions

Questions that are waiting on ReapLift or Meta. Add new ones here. When one is answered, move it to "Answered" with the date, the source, and the code or spec it changed.

## For ReapLift: client pricing (D10)

Proposed by Anirudh on 31 October 2026, and **not agreed yet**. Nothing is built, so changing it costs nothing today. M6 builds it.

**The proposal:** when registering a client, the super admin sets that client's rates per message type, as either a fixed price or a percentage on top of Meta's rate.

| Message type | Fixed price example | Percentage example |
| --- | --- | --- |
| Utility | 15 paise | 15% |
| Marketing ("Promotion") | 88 paise | 25% |
| Authentication | Not given yet | Not given yet |

| # | Question for ReapLift | Example or why it matters | What we assume until answered |
| --- | --- | --- | --- |
| P1 | Are rates set per client and per message type? | Northwind pays 15% on utility and 25% on marketing, while Greenleaf pays something else | Yes |
| P2 | Can a client be on either fixed prices or percentages? Can one client mix them across message types? | A fixed 88 paise on marketing with 15% on utility | Either, with no mixing within one client |
| P3 | Does the percentage go on top of Meta's rate? | Meta charges 11.50 paise, so 15% makes it 13.2, rounded up to 14 paise | Yes, rounded up to a whole paisa |
| P4 | What are the rates for authentication messages? | Meta has this third type, and it is missing from the examples | Treated like the other types; the super admin sets it |
| P5 | What happens if no rates are set at registration? | Block the registration, or use a default | The default 25% markup applies |
| P6 | Fixed prices do not follow Meta's rate. What if Meta's rate rises above the fixed price? | ReapLift would lose money on each message | The admin screen warns; sending is not blocked |
| P7 | Do clients send outside India? Meta's rates differ by country, but a fixed price here is one number per type. | A cheap fixed price could lose money on another country | India only for fixed prices |
| P8 | If Meta bills a message in a different category from its template, who absorbs the difference? | Utility template billed as marketing, or a free message inside a 24-hour reply window | The client pays by template category; ReapLift takes the gain or loss |
| P9 | Who may change a client's rates later, and do changes affect campaigns already confirmed? | A rate change during a running campaign | Super admin only; confirmed campaigns keep their price |

## For Meta

Things Meta's documentation does not settle, which Meta must answer or a real number must prove. The last column says how to close each one: **Ask** means ask Meta or a Meta partner manager; **Test** means the first run on a real number will show it.

Docs last checked: 31 October 2026, Graph API v26.0.

## Needed before real clients and money

| # | Question | Why it matters | What we assume today | Close by |
| --- | --- | --- | --- | --- |
| 1 | What does ReapLift need to become a Solution Partner with a credit line (E7), and how long does it take? | Clients stay on Dovesoft until this is done | Tech Provider first, then Solution Partner | Ask |
| 2 | In which currency does Meta invoice the credit line (D12)? | If dollars, the markup must also cover exchange-rate changes | Rupees | Ask |
| 3 | Meta says new credit-sharing steps are being tested and will replace `whatsapp_credit_sharing_and_attach`. When, and do we need to change? | M5 task 5.2 is built on the current call | The current call keeps working | Ask |
| 4 | If a client's WhatsApp account is on Dovesoft, can it come to ReapLift through Embedded Signup and keep its templates and quality (D13)? This one is also for Dovesoft: who owns the accounts? | Decides whether numbers must be moved and templates submitted again | Numbers are moved and templates submitted again | Ask |
| 5 | Now that `pricing.billable` is deprecated, which webhook fields show what Meta bills ReapLift for each message? | Clients pay the rates set per client (D10), by the template's category. This field shows ReapLift's own cost, so M9 can work out margin and spot messages Meta bills in a dearer category | `pricing.type` and `pricing.category`, not yet stored in full | Ask, Test |
| 6 | If the same template goes out twice to one person after a timeout, does Meta bill twice? | Sets the real cost of a double send | Yes, billed twice | Ask |

## Needed for sending reliably

| # | Question | Why it matters | What we assume today | Close by |
| --- | --- | --- | --- | --- |
| 7 | Is there any way to stop a duplicate send, such as an idempotency key or a status lookup? We found none. | A send that times out may already be accepted | None exists; `send-stats` measures duplicates, and M7 task 7.6a reduces them | Ask |
| 8 | Is `biz_opaque_callback_data` accepted on template sends, and returned in `failed` webhooks as well as sent, delivered and read? | `send-stats` and M7 task 7.6a depend on it | Accepted on every send; `failed` not confirmed | Test |
| 9 | How soon after a send does the `sent` webhook usually arrive? | Sets how long 7.6a holds a timed-out message | 2 to 5 minutes is long enough | Test |
| 10 | How long and how often does Meta retry a webhook when our server is down? | Decides how much downtime is safe, including a database move | Long enough for a short planned stop | Ask |
| 11 | Are the error classes in the M4 spec right in practice, especially codes Meta's page does not describe in detail? | A wrong class retries what should fail, or the reverse | As listed in M4 task 4.2.2 | Test |

## Needed for numbers and templates (M5)

| # | Question | Why it matters | What we assume today | Close by |
| --- | --- | --- | --- | --- |
| 12 | Is `RED` the `quality_rating` value for what WhatsApp Manager shows as Low? Meta's messaging limits page names no values. | Pausing on Low depends on this exact value | `RED` is Low, `YELLOW` is Medium | Ask, Test |
| 13 | Does any webhook report a change in quality rating? `phone_number_quality_update` documents only `ONBOARDING` and `THROUGHPUT_UPGRADE`. | Without one, a drop to Low can take up to an hour to notice | No webhook; the hourly sync finds it | Ask |
| 14 | What are all the values of `whatsapp_business_manager_messaging_limit`? The page shows only `TIER_250`. | The account box shows it | Stored and shown as Meta sends it | Ask, Test |
| 15 | Does `current_limit` still arrive, given Meta said it would be removed in February 2026? | We read the newer field first and fall back to this one | The newer field is sent | Test |
| 16 | What does creating a template return? The docs we read do not list the response fields. | We save the returned ID | `{ id, status, category }` | Test |
| 17 | Does Meta accept the component types in capitals? Its examples use both `HEADER` and `header`. | Every submission uses them | Capitals are accepted | Test |
| 18 | After a rejected template is edited, what status does it get, and does Meta send a webhook for it? | We set `PENDING` when the edit is accepted | `PENDING`, with a webhook when reviewed | Test |
| 19 | Are these rejected: a body that starts or ends with a variable, and two variables side by side? Meta's components page does not say. | Our local rules refuse them, so they may be stricter than needed | Rejected, as our spec says | Ask, Test |
| 21 | Does the 4000 error on a repeat credit-line share still mean "already shared"? We read this from a search result, not a current page. | We treat it as shared, so an account could go active when it is not | Yes | Test |
| 22 | Do review samples have other limits than the sizes for sent media (image 5 MB, video 16 MB, document 100 MB)? Also, the upload guide lists only PDF, JPEG, PNG and MP4. | A file could pass our check and fail at Meta | The sent-media sizes apply | Test |
| 23 | Is Embedded Signup v4 the version our flow should use, and does the onboarding order on Meta's page still apply to it? Meta said v2 and v3 are deprecated from 15 October 2026. | The panel's signup button depends on it | v4, in the documented order | Ask, Test |
| 20 | Are Meta's messaging limits per business portfolio for all of ReapLift's client accounts? If clients own their accounts, whose portfolio counts? | The limit decides how much a client can send | Each client's own portfolio; we copy the value to each number | Ask |

## Answered

None yet.
