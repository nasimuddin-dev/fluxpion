# Subscriptions: Free, Pro, Team, Enterprise

How TestPion makes money without taking anything away from people who use it locally.

## Positioning

- **The desktop app and the CLI stay free and complete for local work.** Every protocol, scripts, the collection runner, mocks, load tests, AI features with your own key, git integration (local and with your own remote), import / export. This is the reason people pick TestPion over tools that lock local features behind sign-in.
- **Paid plans sell what costs us money or what teams need:** cloud sync and collaboration, sharing and permissions, cloud runners and monitors, hosted mocks and MCP, included AI usage, administration, security and support.
- **No account needed** for the free desktop app. An account is needed only for cloud features.

## Plans

| | **Free** | **Pro** (individual) | **Team** (per member) | **Enterprise** |
|---|---|---|---|---|
| Who | Everyone, local | Freelancers, power users | Teams of 2+ | Larger organizations |
| Desktop app + CLI, all local features | ✓ | ✓ | ✓ | ✓ |
| Git integration (local, own remote) | ✓ | ✓ | ✓ | ✓ |
| AI with your own API key / local model | ✓ | ✓ | ✓ | ✓ |
| Cloud account and personal cloud sync between devices | 1 workspace | Unlimited | Unlimited | Unlimited |
| Share workspaces / collections | Read-only links | With up to 3 guests | Team, roles, guests | + custom roles |
| Real-time collaboration, comments, version history | — | History 30 days | ✓, history 1 year | ✓, unlimited |
| Cloud collection runs (per month) | 100 | 2,000 | 10,000 per org + 1,000 / member | Custom |
| Cloud monitors | 1, hourly | 5, every 5 min | 25, every minute, regions | Custom |
| Hosted mock servers / MCP endpoint | 1 / — | 5 / 1 | 25 / 5 | Custom |
| Included AI credits (no own key needed) | — | ✓ | ✓ (pooled) | Custom |
| Self-hosted runners | — | — | ✓ | ✓ |
| Git-backed cloud workspaces (GitHub App) | — | ✓ | ✓ | ✓ |
| SSO (SAML / OIDC), SCIM, audit log, policies | — | — | Audit log | ✓ |
| Data residency, single-tenant / on-prem | — | — | — | ✓ |
| Support | Community | Email | Email, priority | SLA, dedicated contact |

Limits are starting points to validate; keep them in one entitlements table (SUB-201), never hard-coded in features.

### Prices (to decide)

Placeholders until there is usage data; check competitors' current prices before deciding:

- **Pro:** $8–10 per month (or ~20% less yearly).
- **Team:** $12–15 per member per month, minimum 2 members.
- **Enterprise:** custom, from ~$25 per member per month, annual contract.
- **Free for:** open-source maintainers (Team plan for a public project), students and teachers (Pro), with verification.
- **Trials:** 14 days of Team for a new organization, no card needed.

## How entitlements work

- **One entitlements service** maps an organization (or a personal account) to its plan and limits: `can(org, feature)` and `remaining(org, quota)`. The UI, the API, the runners and the CLI all ask it; nothing checks a plan name directly.
- **Quotas** are metered (runs, monitor checks, AI credits, storage) and shown in Settings ▸ Usage; at 80% a warning, at 100% the feature pauses with a clear message and an upgrade link (never deletes data).
- **The desktop app** reads entitlements when signed in and caches them (works offline for 14 days); local features never check a licence.
- **Downgrades** keep data read-only above the new limits (e.g. extra monitors are paused, not deleted).

## Billing

- Stripe Billing: checkout, customer portal (cards, invoices, tax), webhooks to the entitlements service; seats for Team (prorated); yearly and monthly; invoices / purchase orders for Enterprise.
- Taxes via Stripe Tax; receipts by email; currency USD first (EUR later).

## Backlog

### Phase S0: groundwork (with the cloud foundations)
- [ ] **SUB-001 Entitlements model** (M). Plans, features, quotas as data; `can` / `remaining`; tests.
- [ ] **SUB-002 Usage metering** (M). Count runs, monitor checks, AI credits, storage per organization; daily aggregates.

### Phase S1: launch Free + Pro
- [ ] **SUB-101 Stripe integration** (L). Checkout, portal, webhooks, plan changes, cancellations, failed payments (grace period).
- [ ] **SUB-102 Upgrade flows in the app** (M). Uniform "upgrade" prompt component at limits; Settings ▸ Plan and usage; no dark patterns (the free app keeps working).
- [ ] **SUB-103 Included AI credits** (M). A built-in provider for subscribers (no own key), metered; the existing per-workspace usage view shows credits.
- [ ] **SUB-104 Pricing page and docs** (S).

### Phase S2: Team
- [ ] **SUB-201 Seats** (M). Members count toward seats; invitations check seats; admins add seats.
- [ ] **SUB-202 Trials** (S). 14-day Team trial per new organization; reminders; downgrade to Free with data kept.
- [ ] **SUB-203 Education and open-source programs** (S). Application form, verification, coupons.

### Phase S3: Enterprise
- [ ] **SUB-301 Contracts and invoicing** (M). Manual plans, purchase orders, custom limits per organization.
- [ ] **SUB-302 Single-tenant / on-prem licence** (L). Licence keys with an expiry, offline validation, for the self-hosted edition.

## Metrics to watch

Activation (first request sent, first collection run), weekly active users, free → paid conversion, seat expansion, churn, cloud run volume per plan, AI credit use, support load per plan.

## Open decisions (owner)

1. Is personal cloud sync on Free (1 workspace) worth its cost as an acquisition hook?
2. Included AI credits: which model and how many per plan.
3. Prices and whether to launch Pro and Team together.
