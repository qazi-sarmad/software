# Config control plane — decisions

Every entry: number, task, unclear point, options, choice, reason, how to reverse.

## D-C3 — AI provenance stripped; owner sole author

The repository is the owner's work and property. All AI-agent authorship, co-author and session
provenance is stripped from tracked files on this branch (C0b), and no new commits carry agent,
co-author or session trailers. New commits on this branch use the owner identity
`Qazi Sarmad Ali Mahesar <qazisarmadalimahesar@gmail.com>` only. Historical commit messages already on
`main` or earlier branches are NOT rewritten (no force-push, no history rewrite). Product flags such as
`ai_enabled` are configuration, not provenance, and are retained.
Verification: `rg -i 'co-authored-by:|claude-session|openhands|all-hands\.dev|created by an ai|ai agent|noreply@anthropic|chatgpt|openai\.com/codex' --glob '!.git/*'` must return no hits in tracked
content except this decision line.

How to reverse: not applicable (owner policy).
