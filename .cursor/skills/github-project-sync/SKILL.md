---
name: github-project-sync
description: >-
  Keeps the LuaTorio GitHub Project board and issues in sync with real work
  progress. Use when starting, finishing, merging, or abandoning work on a
  tracked issue; after closing a PR for an issue; when the user mentions the
  GitHub project, board, milestone, or issue status; or at the end of any
  implementation session that touched tracked issues.
---

# GitHub Project Sync (LuaTorio)

## Hard rule

**Never leave the board stale.** If you complete, start, or abandon issue-tracked work in this repo, update GitHub **in the same turn** before telling the user you are done.

Do not wait for the user to remind you.

## Project identity

| | |
|---|---|
| Repo | `lexwebb/LuaTorio` |
| Project | owner `lexwebb`, number `1`, title `LuaTorio` |
| URL | https://github.com/users/lexwebb/projects/1 |
| Status options | `Todo` · `In Progress` · `Done` |

## When to sync

| Event | Issue | Project Status | Notes |
|---|---|---|---|
| Start implementing an issue | leave open | `In Progress` | Comment optional |
| Finish issue (merged / accepted locally) | close `--reason completed` | `Done` | Check off acceptance criteria in body |
| Abandon / won't do | close `--reason not planned` (or leave open) | `Todo` or remove from project | Say why in a comment |
| Blocked | leave open | `In Progress` | Comment with blocker |
| Partial progress (PR open, not done) | leave open | `In Progress` | Link the PR in a comment |

## Workflow (every finish)

Copy and complete:

```
Project sync:
- [ ] Identify issue number(s) for this work
- [ ] Update acceptance criteria checkboxes if done
- [ ] Set project Status (Todo / In Progress / Done)
- [ ] Close issue if complete (with short comment)
- [ ] Confirm via `gh issue view N --json state,projectItems`
```

## Commands

```bash
REPO=lexwebb/LuaTorio
OWNER=lexwebb
PROJECT_NUMBER=1

# Issue + project item status
gh issue view <N> --repo $REPO --json number,state,title,projectItems

# List project items
gh project item-list $PROJECT_NUMBER --owner $OWNER --format json --limit 50

# Status field + option IDs
gh project field-list $PROJECT_NUMBER --owner $OWNER --format json \
  | jq '.fields[] | select(.name=="Status")'

# Set Status (Need: project id, item id, field id, option id)
gh project item-edit \
  --project-id <PROJECT_ID> \
  --id <ITEM_ID> \
  --field-id <STATUS_FIELD_ID> \
  --single-select-option-id <OPTION_ID>

# Close completed issue
gh issue close <N> --repo $REPO --reason completed \
  --comment "<one-line what landed>"
```

Resolve IDs from live `gh` output — do not hard-code option IDs across sessions (they can change if the field is edited).

## Nudge points (mandatory)

Invoke this skill's sync steps **before** the final user-facing message when any of these happen:

1. Finishing a development branch (merge / PR / "done")
2. Closing out a plan's last task
3. User says work on an issue is complete
4. You claim acceptance criteria are met

If you almost forgot: stop, sync, then report — include the issue URL and new Status in the summary.

## When a design introduces new work (mandatory prompt)

If a design/spec adds a new milestone slice, feature area, or multi-step delivery (e.g. web playground), **prompt the user in that same design turn** to create GitHub issues + add them to the LuaTorio project — do not wait until after the spec is approved or until the user asks. Offer a concrete issue checklist from the design's tracking section and create them on approval.

## Out of scope

- Creating the project or milestones (see `docs/github-project-setup.md`)
- Rewriting issue bodies beyond acceptance checkboxes + brief status notes
- Linear / other trackers
