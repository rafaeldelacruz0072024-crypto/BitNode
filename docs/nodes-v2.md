# Nodos 2.0

The new generation has separate plan IDs: `v2-10d`, `v2-17d`, `v2-33d`, `v2-founder`.
Legacy plan IDs, rates, active states, contracts and balances are preserved.

| Business days | Daily range | Simple cycle ROI | ROI on 1,000 USDT |
| --- | --- | --- | --- |
| 10 | 0.50%-0.70% | 5%-7% | 50-70 USDT |
| 17 | 0.90%-1.30% | 15.30%-22.10% | 153-221 USDT |
| 33 | 1.50%-2.20% | 49.50%-72.60% | 495-726 USDT |

## Nodo Founder

Founder uses the 33-business-day cycle and the same tasks, principal release,
Wednesday withdrawal and reinvestment rules, at a fixed 2% per validated day
(66% simple cycle ROI). The amount must be strictly greater than 2,000 USDT;
with two-decimal amounts the minimum is 2,000.01 USDT.

Eligibility is a closed snapshot of existing Auth registrations at the time the
Founder migration runs. It does not require a currently active legacy node.
Later registrations are excluded even if they subsequently buy a legacy node.
The cohort is not writable by users or by the API service role.

The server hides Founder from ineligible users, and the database rejects creation
or reinvestment for an ineligible user independently of the UI. The plan starts
inactive and follows the unreleased V2 setting; no purchases are enabled.

ROI uses the original capital, without compounding. The V2 rate resolver does
not inherit legacy monthly ROI policies. V1 continues using its existing resolver.

## Release state

The migration inserts V2 plans with `active=false` and initializes
`platform_settings.nodes_v2_release` to `{"enabled":false}`. While unreleased,
only administrators can fetch the catalog and see `/dashboard/nodes-v2`.
The UI disables purchases. The contract trigger independently rejects creation
even if an API caller tries to bypass that UI.

A future launch requires explicit approval, enabling the release setting and
activating the chosen V2 plans. This change does not launch the product.

## Existing rules reused

- Four validated tasks advance each active contract's individual progress.
- Monday-Friday, America/Mexico_City; weekends do not advance progress.
- Projected end dates count business days. Actual completion depends on tasks;
  missing tasks can postpone completion under the existing reset/recovery rules.
- Principal is released once after 10/17/33 validated days.
- Finite ROI stays in the Wednesday withdrawal bucket, 09:00-12:00 Mexico time.
- Capital claims, fees, idempotency and reinvestment use the existing routines.
- Commission rates and funding-origin restrictions are not changed.
- SARA IA eligibility continues to require an active 21-day node.

Plan generations and V2 financial terms cannot be changed retroactively.
No live investment, reward, withdrawal or test subscription is created by the migration.

## Validation

`npm run check` and the targeted Vitest suite validate the catalog, projections,
access control and existing commission/SARA/progress behavior.

`node scripts/test-nodes-v2-sql.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js`
runs the actual migration against isolated PostgreSQL fixtures captured from the
installed engine. It simulates complete cycles and tests launch blocking, preserved
legacy ROI, immutable terms, weekday dates, rate bounds, repeated tasks, principal
idempotency, Wednesday buckets, reinvestment and claims.

Fixtures have no production user data. Clock overrides exist only in the isolated
test script and are never part of the production migration.
