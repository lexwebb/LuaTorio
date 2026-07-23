# Combinator cookbook 2.0 schematic dump

Scraped from [Combinator cookbook 2.0](https://forums.factorio.com/viewtopic.php?t=124776) for LuaTorio emit research (#52).

## Refresh

```bash
pnpm rip:cookbook
# or
node scripts/rip-cookbook-2.0.mjs
```

Writes under this directory:

| Path | Contents |
|------|----------|
| `catalog.json` | Index of every extracted blueprint + feature tags |
| `patterns.md` | Human summary of opt-relevant idioms |
| `out/<id>.json` | Decoded Factorio plan (gitignored) |
| `raw/<id>.bp` | Encoded blueprint string (gitignored) |

Source HTML is not committed; re-fetch on each run.
