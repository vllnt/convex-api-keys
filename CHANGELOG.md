# Changelog

## 0.1.0

- Initial release
- Key creation with SHA-256 hashing, prefix-indexed lookup
- Key validation with status/expiry/remaining checks
- Key revocation (single + bulk by tag)
- Key rotation with configurable grace period
- Key listing by owner, tag, environment
- Key update (name, scopes, tags, metadata) without rotation
- Key disable/enable (reversible pause)
- Finite-use keys (remaining counter with atomic decrement)
- Key types (secret / publishable) with type-encoded prefix
- Environment-aware key format ({prefix}_{type}_{env}_{random}_{secret})
- Multi-tenant isolation (ownerId-scoped queries)
- Audit event log (apiKeyEvents table)
- Usage analytics via event counting
- Constant-time hash comparison
- Child components: @convex-dev/rate-limiter, sharded-counter, aggregate, crons
