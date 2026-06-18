# Sensitive Context Protection Eval Materials

This directory contains standardized eval materials for Sensitive Context Protection.
All secrets and personal data are synthetic fixtures. Do not replace them with real values.

## Files

- `tool-result-cases.jsonl`: tool-result scanning, redaction, blocking, and policy-mode cases.
- `bypass-regression-cases.jsonl`: regression cases derived from known redaction bypass reports.
- `path-guard-cases.jsonl`: pre-tool credential path blocking cases.
- `audit-cases.jsonl`: expected audit behavior and metadata-only assertions.
- `manual-ui-checklist.md`: manual Electron settings validation checklist.
- `spike-0-built-in-tool-redaction.md`: technical boundary record for built-in tool output rewriting.

## Common Fields

- `id`: stable case identifier.
- `area`: scanner, policy, path_guard, audit, or ui.
- `toolName`: tool name passed to the guard.
- `toolInput`: representative tool input.
- `resultText`: synthetic tool result text, when applicable.
- `permissionMode`: `safe`, `ask`, or `allow-all`.
- `config`: partial Sensitive Context Protection config override.
- `expected`: normalized expected behavior.

## Scoring Guidance

Use these baseline pass criteria:

- No raw secret value appears in model-visible protected output when action is `redact`, `prompt`, or `block`.
- Disabled coverage areas are allowed without redaction or blocking.
- Audit records contain finding type, severity, confidence, count, tool, action, and session only.
- Audit records never contain raw sensitive values.
- Credential path blocks happen before file contents are read.

Recommended minimum release gate:

- Critical cases: 100% pass.
- High cases: 95% pass.
- Medium/low cases: reviewed failures must be accepted explicitly.

Automated runner:

- `../eval-cases.test.ts` runs `tool-result-cases.jsonl` and `bypass-regression-cases.jsonl` against `guardToolResult`.
- The same runner executes `path-guard-cases.jsonl` and `egress-cases.jsonl` against `runPreToolUseChecks`, and `audit-cases.jsonl` against metadata-only audit entry creation.
- Add new bypass reports to `bypass-regression-cases.jsonl` first, then add focused unit tests only when a failure needs lower-level diagnosis.

Case files:

- `tool-result-cases.jsonl`: scanner, output redaction, and structured field redaction.
- `bypass-regression-cases.jsonl`: transformed-output bypass regressions such as chunking, whitespace splitting, and hex dump output.
- `path-guard-cases.jsonl`: sensitive file/path pre-tool-use guard.
- `redactionRules`: optional workspace `redaction.json` fixture for permanent allow/field rules.
- Source-specific field rules may also live at `sources/{sourceSlug}/redaction.json`.
- `egress-cases.jsonl`: sensitive data confirmation before external sends.
- `audit-cases.jsonl`: audit metadata and raw-value retention checks.

XLSX coverage means field redaction after an XLSX-capable tool such as `xlsx-tool` or `markitdown` has converted the workbook into structured text/JSON. The guard does not parse raw binary `.xlsx` bytes directly.
