---
title: "Postmortem: the 47-minute checkout outage on March 3"
url: https://example.com/engineering/checkout-outage-postmortem
language: en
source: fictional, written for this eval
---
On March 3, customers could not complete purchases on our web store for 47 minutes, from 14:12 to 14:59 UTC. About 3,100 checkout attempts failed during that time. No payment was charged twice and no customer data was exposed. This postmortem explains what happened and what we are changing.

What happened

At 14:05 we deployed a change that added a new index to the orders table to speed up the order history page. The migration tool ran the index creation as a normal operation instead of a concurrent one, which locked the orders table for writes while the index was built. On a table with 180 million rows, that took 47 minutes.

Every checkout writes a row to the orders table, so every checkout waited on the lock until it timed out after 30 seconds. Our alerts fired at 14:15, three minutes after the first failures, but the on-call engineer first suspected the payment provider because the errors showed up as payment timeouts.

At 14:41 we identified the lock. Cancelling the index build would have rolled back the migration and taken several more minutes, so we let it finish. Checkouts recovered at 14:59.

Why it happened

The migration was reviewed and tested, but our staging database has only 2 million orders, where the same index builds in under a minute. Our migration checklist says large tables must use concurrent index creation, but nothing enforces it, and the reviewer did not know the orders table counts as large.

What we are changing

1. A lint rule now rejects index creation on our 20 largest tables unless it is concurrent. It runs in CI and blocks the merge.
2. Checkout errors now report lock waits separately from payment timeouts, so the on-call engineer can tell them apart.
3. We will refresh the staging database monthly with an anonymized copy of production, so migrations are tested at realistic sizes.
4. Schema changes to tables on the checkout path will be deployed outside peak hours, which for us means before 09:00 or after 22:00 UTC.

We are sorry for the disruption. Customers who contacted support about a failed order received a 10 percent discount code.
