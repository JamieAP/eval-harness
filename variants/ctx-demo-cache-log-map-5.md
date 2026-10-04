Synthetic example; all events and decisions are invented.

# Current State (per project)

- **demo-cache**: Make expiry tests deterministic → Agreed to inject a deterministic clock next; implementation remains pending.
- **demo-docs**: Add a usage example → Drafted a fictional cache usage example; it does not change cache design decisions.

# Recent Activity (last 5)

- 2025-01-02T09:00:00Z [demo-cache]: Set the maximum capacity to 64 entries; evict the least recently used item on overflow.
- 2025-01-03T09:00:00Z [demo-cache]: Set TTL to 30 seconds and remove expired values on lookup.
- 2025-01-04T09:00:00Z [demo-cache]: Confirmed a cache miss must not extend TTL; added a failing expiry test.
- 2025-01-05T09:00:00Z [demo-cache]: Agreed to inject a deterministic clock next; implementation remains pending.
- 2025-01-06T09:00:00Z [demo-docs]: Drafted a fictional cache usage example; it does not change cache design decisions.
