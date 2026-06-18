# Manual UI Checklist

Use this checklist in the Electron app under:

`Settings -> Security & Privacy -> Sensitive Context Protection`

## Settings Visibility

- [ ] Security & Privacy appears in Settings navigation.
- [ ] Sensitive Context Protection section is visible.
- [ ] Enable protection toggle is visible and persists after reload.
- [ ] Four personal-protection toggles are visible: Sensitive files, Output redaction, Field redaction, Confirm before external sends.
- [ ] Advanced mode selectors are not required for the default personal flow.
- [ ] Allowed sensitive paths section is visible and can revoke permanent path approvals.

## Settings Persistence

- [ ] Disabling Sensitive files persists after reload.
- [ ] Disabling Output redaction persists after reload.
- [ ] Disabling Field redaction persists after reload.
- [ ] Disabling Confirm before external sends persists after reload.
- [ ] Re-enabling global protection restores the saved per-feature toggle states.

## Runtime Behavior

- [ ] With Output redaction enabled, a tool result containing a synthetic OpenAI key is redacted before model context.
- [ ] With Output redaction disabled, the same synthetic key is allowed through by policy.
- [ ] With Sensitive files enabled, a private key path is blocked before file contents are read.
- [ ] With Field redaction enabled, JSON/CSV table outputs with `email`, `phone`, `token`, or `password` fields show redacted values in chat.
- [ ] Redacted tool results show a visible "Sensitive data redacted" notice with finding type/count summary and no raw values.
- [ ] Suspicious unconfigured structured fields such as `salary` or `address` are temporarily redacted and show a "Sensitive field rule suggestion" notice.
- [ ] A saved `keep` field rule suppresses future suggestions for that field.
- [ ] With Audit enabled, `audit/sensitive-context.jsonl` receives metadata-only entries.
- [ ] With Audit disabled, no new sensitive-context audit entries are written.

## Negative Checks

- [ ] Audit entries do not contain raw API keys, tokens, emails, phone numbers, or private key bodies.
- [ ] Credential path blocks happen before file contents appear in the transcript.
- [ ] External send prompts show destination, finding summary, and a redacted send preview with no raw sensitive values.
- [ ] Choosing Send redacted sends a redacted payload.
- [ ] Turning off global protection disables both result scanning and credential path guard behavior.
