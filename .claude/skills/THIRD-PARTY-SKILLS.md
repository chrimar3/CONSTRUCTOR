# Third-party skills — provenance & audit record

Installed 2026-07-13 after content audit (every file read; injection/exfil pattern scan clean;
no network calls, no tool permissions beyond Read/Grep/Glob/Bash). See ADR in DECISIONS.md.

| Skill | Source | Commit | License | Why |
|---|---|---|---|---|
| test-driven-development | obra/superpowers (253k★, most-starred CC skill repo; highest-installed TDD skill) | d884ae0 | MIT | Article IX — enforces watch-it-fail RED before impl; testing-anti-patterns.md guards against mock-testing |
| systematic-debugging | obra/superpowers | d884ae0 | MIT | Root-cause-before-fix discipline for any red suite / bug during tasks |
| verification-before-completion | obra/superpowers | d884ae0 | MIT | "No completion claims without fresh evidence" — matches our verify gates + checkpoint honesty |
| insecure-defaults | trailofbits/skills (professional security-audit firm) | cfe5d7b | CC BY-SA 4.0 | Article IV — detects fail-open secrets (`env.X \|\| 'default'`), exactly the CONSTRUCTOR_PII_KEY failure mode |

Rejected during selection: spec-to-code-compliance (trailofbits) — hard-wired blockchain-auditor
persona would misfire here; speckit-analyze already covers spec↔code alignment. Generic mega-packs
(ComposioHQ, alirezarezvani, Jeffallan) — catalogs/breadth, not depth; nothing beyond what the
four above + built-ins cover.

Skills are project-local copies (pinned, auditable, no auto-update supply chain). To update:
re-clone source, re-audit, re-copy, update commit here.
