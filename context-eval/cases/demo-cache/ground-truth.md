# Expected facts

Synthetic example; all events and decisions are invented.

The cache is an in-process bounded LRU cache with a capacity of 64 entries. TTL is 30 seconds. Expired values are removed on lookup; misses do not extend their TTL. The agreed next change is a deterministic clock in expiry tests. No distributed cache or persistence was selected.
