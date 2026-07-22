# GitHub Project Setup

Run these commands locally (requires `gh` with `project` and `repo` scopes).

## 1. Authenticate with project scope

```bash
gh auth refresh -s project,repo
```

## 2. Create milestones

```bash
repo=lexwebb/LuaTorio

gh api repos/$repo/milestones -f title="v1" -f description="Expression-only compiler"
gh api repos/$repo/milestones -f title="v2" -f description="Sequential logic and tick()"
gh api repos/$repo/milestones -f title="v3" -f description="Functions (no recursion)"
gh api repos/$repo/milestones -f title="v4" -f description="Recursion, tables, bundles"
gh api repos/$repo/milestones -f title="v5" -f description="Entity placement"
gh api repos/$repo/milestones -f title="web" -f description="Browser playground"
```

## 3. Create labels

```bash
gh label create compiler --description "Parser, semantic analysis, IR" --color 1D76DB --repo $repo
gh label create ir --description "Intermediate representation" --color 5319E7 --repo $repo
gh label create emitter --description "Combinator lowering, layout, blueprint emission" --color 0E8A16 --repo $repo
gh label create cli --description "Command-line interface" --color FBCA04 --repo $repo
gh label create test --description "Testing infrastructure" --color B60205 --repo $repo
```

## 4. Create the project and link to repo

```bash
gh project create --owner lexwebb --title "LuaTorio" --format json
# Note the project number from output, then:
gh project link <PROJECT_NUMBER> --owner lexwebb --repo LuaTorio
```

## 5. Add Status field (optional)

In the GitHub UI: Project → Settings → Fields → add a **Status** field with:
`Backlog`, `Ready`, `In Progress`, `In Review`, `Done`

Or use the default GitHub Status field if available on your project template.

## 6. Add v1 issues to the project

After issues are created (see issue list below), add them all:

```bash
# List open v1 issues and add each to the project
gh issue list --repo $repo --milestone v1 --json number --jq '.[].number' | while read n; do
  gh project item-add <PROJECT_NUMBER> --owner lexwebb --url "https://github.com/$repo/issues/$n"
done
```

## 7. Close the permission-test issue

```bash
gh issue close 2 --repo $repo --comment "Permission test issue from project setup."
```

## v1 Issue Checklist

| # | Title | Labels | Depends on |
|---|---|---|---|
| 1 | Monorepo scaffold | compiler | — |
| 2 | Lua parser integration | compiler | #1 |
| 3 | Semantic analyzer (v1 subset) | compiler | #2 |
| 4 | IR types and lowering | ir | #3 |
| 5 | IR optimizations | ir | #4 |
| 6 | Combinator lowering | emitter | #4 |
| 7 | Grid layout planner | emitter | #6 |
| 8 | Blueprint emitter | emitter | #6, #7 |
| 9 | CLI | cli | #8 |
| 10 | Golden and integration tests | test | #8 |
| 11 | README and examples | documentation | #9 |

## Recommended views

- **Board** — group by Status
- **Table** — filter Milestone = `v1`, sort by issue number
- **Roadmap** — group by Milestone (optional)
