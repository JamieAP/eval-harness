Synthetic example; all events and decisions are invented.

# Recent Sessions (last 5 of 6)

### demo-cache (2025-01-02T09:00:00Z)
**Focus:** Choose capacity
**Done:** Set the maximum capacity to 64 entries; evict the least recently used item on overflow.
**Files:** src/cache.ts, tests/cache.test.ts

### demo-cache (2025-01-03T09:00:00Z)
**Focus:** Define expiry
**Done:** Set TTL to 30 seconds and remove expired values on lookup.
**Files:** src/cache.ts

### demo-cache (2025-01-04T09:00:00Z)
**Focus:** Check miss semantics
**Done:** Confirmed a cache miss must not extend TTL; added a failing expiry test.
**Files:** tests/cache.test.ts

### demo-cache (2025-01-05T09:00:00Z)
**Focus:** Make expiry tests deterministic
**Done:** Agreed to inject a deterministic clock next; implementation remains pending.
**Files:** tests/cache.test.ts

### demo-docs (2025-01-06T09:00:00Z)
**Focus:** Add a usage example
**Done:** Drafted a fictional cache usage example; it does not change cache design decisions.
**Files:** README.md
