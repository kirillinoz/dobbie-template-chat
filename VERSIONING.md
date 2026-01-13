# Versioning Strategy

This project follows [Semantic Versioning](https://semver.org/).

## Version Format: `MAJOR.MINOR.PATCH`

### Initial State

- `v0.0.0` - Placeholder contract (deployed automatically when project is created)

### Version Bumps

| When to bump        | Example                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| **MAJOR** (`X.0.0`) | Breaking changes: storage layout changes, removed functions, renamed functions |
| **MINOR** (`0.X.0`) | New features: new functions, new events (backward compatible)                  |
| **PATCH** (`0.0.X`) | Bug fixes: logic corrections, gas optimizations (backward compatible)          |

### Examples

```
v0.0.0  → Initial placeholder (auto-deployed)
v1.0.0  → First real implementation
v1.1.0  → Added `getUserBalance()` function
v1.1.1  → Fixed rounding error in calculation
v1.2.0  → Added `batchTransfer()` function
v2.0.0  → Restructured storage for gas optimization (breaking)
```

### Important Notes

1. **Storage Layout**: Changing storage variable order or types requires a MAJOR bump
2. **Function Signatures**: Changing function parameters requires a MAJOR bump
3. **New Functions**: Adding new functions is a MINOR bump
4. **Internal Changes**: Gas optimizations without API changes are PATCH bumps
