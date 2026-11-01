# Open questions

Questions that are waiting on ReapLift or Meta. Add new ones here. When one is answered, move it to "Answered" with the date, the source, and the code or spec it changed.

**Plan (owner, 2 November 2026):** once the product is built, demo it to ReapLift and go through this document. Everything here must be closed or consciously accepted before launch. Each question says what the product assumes today, so the demo shows that assumption working. The GST questions (G1 to G7) and pricing questions (P1 to P12) are the ones to settle in that meeting; the rest go to Meta or Dovesoft.

## For ReapLift: client pricing (D10) and campaign size

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
| P12 | Should a sent message that is never delivered still be charged? If not, after how long does it count as undelivered? | The design charges it. Turning the switch off is refused until this is decided and built | Charged |
| P13 | Will any client send outside India? Which countries, and when? | See "Other countries" in the M7 spec; it is real work, and clients are limited to India until then | India only |
| P11 | Later, should clients be able to pay for higher priority? | Not built. Clients on their own numbers do not compete today, except on one shared WhatsApp account's daily limit | Everyone equal |
| P10 | Is 10,000 or 20,000 rows the right limit per campaign? Does any client send more in one go today? | A larger audience must be split into several campaigns | 20,000; a setting, so changing it needs no code |
| P9 | Who may change a client's rates later, and do changes affect campaigns already confirmed? | A rate change during a running campaign | Super admin only; confirmed campaigns keep their price |

## For ReapLift's accountant: GST

GST is built as a setting, default 18%, charged with each message and included in what clients pay. These answers may change that method, so please have a chartered accountant confirm them before real clients are charged.

| # | Question | Why it matters | What we assume until answered |
| --- | --- | --- | --- |
| G1 | Is GST due when a client tops up the wallet, or when messages are sent? Many prepaid services charge GST on the top-up, so ₹1,000 costs ₹1,180 and messages then deduct without GST | It changes the whole money flow, and what the wallet balance means | When messages are charged, as the owner described |
| G2 | Can ReapLift claim the GST it pays Meta as input tax credit? | If yes, ReapLift's real cost is 86 paise, not ₹1.01, and the margin is much higher | Not counted either way |
| G3 | Does Meta bill ReapLift with Indian GST, or from abroad under reverse charge? | Decides what ReapLift pays and how it is recorded | Ask Meta during E7 too |
| G4 | Is a price including GST, rounded up to a whole paisa, with GST worked backwards on the statement, acceptable? | Rounding GST separately on each message would make it not exactly 18% | Yes |
| G5 | Who issues tax invoices, and when? Do we need each client's GSTIN and state, for CGST and SGST or IGST? (D11) | Clients may need invoices to claim their own credit; we hold neither field today | Outside the platform at launch, with a monthly statement |
| G6 | Is GST refunded in full with a failed message? Is a credit note needed? | Refunds are frequent | Refunded in full, with no credit note |
| G7 | The client's message says a marketing message will cost ₹1.03 with GST. 86 paise + 18% is ₹1.0148, and 88 paise + 18% is ₹1.0384. Which price and margin does ReapLift intend? | Sets what clients are charged; ₹1.03 leaves about 1.5 paise a message | Prices are set per client by the super admin |

## For Meta

Things Meta's documentation does not settle, which Meta must answer or a real number must prove. The last column says how to close each one: **Ask** means ask Meta or a Meta partner manager; **Test** means the first run on a real number will show it.

Docs last checked: 31 October 2026, Graph API v26.0.

## Needed before real clients and money

| # | Question | Why it matters | What we assume today | Close by |
| --- | --- | --- | --- | --- |
| 1 | What does ReapLift need to become a Solution Partner with a credit line (E7), and how long does it take? | Clients stay on Dovesoft until this is done | Tech Provider first, then Solution Partner | Ask |
| 2 | In which currency does Meta invoice the credit line (D12)? | If dollars, the markup must also cover exchange-rate changes | Rupees | Ask |
| 3 | Meta says new credit-sharing steps are being tested and will replace `whatsapp_credit_sharing_and_attach`. When, and do we need to change? | M5 task 5.2 is built on the current call | The current call keeps working | Ask |
| 4 | A client's account can have several partners, as this one has Dove Soft and Haptik. Can it add ReapLift and keep its number, templates and quality? Meta's page says a credit line cannot be changed once attached, so can it move from Dovesoft's credit line to ReapLift's, or does it need a new account? | Decides how clients move from Dovesoft (M11) | They may need a new account, with templates submitted again | Ask |
| 5 | Now that `pricing.billable` is deprecated, which webhook fields show what Meta bills ReapLift for each message? | Clients pay the rates set per client (D10), by the template's category. This field shows ReapLift's own cost, so M9 can work out margin and spot messages Meta bills in a dearer category | `pricing.type` and `pricing.category`, not yet stored in full | Ask, Test |
| 6 | If the same template goes out twice to one person after a timeout, does Meta bill twice? | Sets the real cost of a double send | Yes, billed twice | Ask |

## Needed for sending reliably

| # | Question | Why it matters | What we assume today | Close by |
| --- | --- | --- | --- | --- |
| 7 | Is there any way to stop a duplicate send, such as an idempotency key or a status lookup? We found none. | A send that times out may already be accepted | None exists; `send-stats` measures duplicates, and M7 task 7.6a reduces them | Ask |
| 8 | Is `biz_opaque_callback_data` accepted on template sends, and returned in `failed` webhooks as well as sent, delivered and read? | `send-stats` and M7 task 7.6a depend on it | Accepted on every send; `failed` not confirmed | Test |
| 9 | How soon after a send does the `sent` webhook usually arrive? | Sets how long 7.6a holds a timed-out message | 2 to 5 minutes is long enough | Test |
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
| 26 | How does "business portfolio pacing" for large template campaigns (in Meta's changelog) affect our sending and delivery speed? | It may hold back part of a campaign to check quality | Not handled | Ask, Test |
| 24 | What does Meta do with messages above the daily messaging limit: refuse them, or queue them? | The summary warns and does not block | They fail, and are refunded | Ask, Test |
| 25 | Does Meta refuse a template send with an empty variable? | A blank cell in a client's sheet would fail and be refunded | Refused | Test |
| 20 | Are Meta's messaging limits per business portfolio for all of ReapLift's client accounts? If clients own their accounts, whose portfolio counts? | The limit decides how much a client can send | Each client's own portfolio; we copy the value to each number | Ask |

## For ReapLift: daily limits

Asked on 2 November 2026; nothing is decided until ReapLift answers.

- **Should our own daily limit count customers or messages?** Built as customers, which matches how Meta counts, so the two can be compared directly. It cannot cap message volume: 500 customers can receive more than 500 messages. Change it if ReapLift wants a cap for cost control.
- **Do marketing, utility and authentication all count towards Meta's daily limit in the same way?** Meta's page gives one limit and does not say. Built as one count for all three. Confirm with Meta or Dovesoft.

## Answered

- **D13 and whether limits are shared, 31 October 2026, owner's screenshot of a Dovesoft client's Business Suite:** the client's portfolio assigns its WhatsApp account to Dove Soft as a partner, so the client owns it. Each client has its own Meta limit. One client's account was checked; confirm with Dovesoft that all are the same.
- **Question 10, 31 October 2026, Meta's throughput page:** Meta retries failed webhooks for up to 7 days with exponential backoff, so a short planned stop is safe. It also says to size webhook handling for 3 times outgoing traffic.
