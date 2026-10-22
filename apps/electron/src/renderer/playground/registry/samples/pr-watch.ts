/**
 * PR watcher fixtures for the chat header playground entries: one `PrWatchState` per scenario the
 * Coding-mode PR chip and its card have to handle. Timestamps are relative to when the module loads.
 */

import * as React from 'react'
import type {
  PrCheck,
  PrDetails,
  PrSummary,
  PrWatchState,
} from '@/components/app-shell/chat-header/pr-watch/pr-watch-state'

const MINUTE = 60_000
const now = Date.now()

const REPO = 'https://github.com/craft-ai-agents/craft-agents'

const passingChecks: PrCheck[] = [
  { name: 'typecheck:all', status: 'success', url: `${REPO}/actions/runs/1` },
  { name: 'unit (bun test)', status: 'success', url: `${REPO}/actions/runs/2` },
  { name: 'lint', status: 'success', url: `${REPO}/actions/runs/3` },
  { name: 'e2e (macos)', status: 'success', url: `${REPO}/actions/runs/4` },
  { name: 'e2e (windows)', status: 'success', url: `${REPO}/actions/runs/5` },
  { name: 'docs-site preview', status: 'skipped' },
]

const runningChecks: PrCheck[] = [
  { name: 'typecheck:all', status: 'success', url: `${REPO}/actions/runs/1` },
  { name: 'lint', status: 'success', url: `${REPO}/actions/runs/3` },
  { name: 'unit (bun test)', status: 'pending', url: `${REPO}/actions/runs/2` },
  { name: 'e2e (macos)', status: 'pending', url: `${REPO}/actions/runs/4` },
  { name: 'e2e (windows)', status: 'pending', url: `${REPO}/actions/runs/5` },
]

const failingChecks: PrCheck[] = [
  { name: 'typecheck:all', status: 'failure', url: `${REPO}/actions/runs/1` },
  { name: 'unit (bun test)', status: 'success', url: `${REPO}/actions/runs/2` },
  { name: 'lint', status: 'success', url: `${REPO}/actions/runs/3` },
  { name: 'e2e (macos)', status: 'pending', url: `${REPO}/actions/runs/4` },
  { name: 'e2e (windows)', status: 'success', url: `${REPO}/actions/runs/5` },
  { name: 'i18n locale parity', status: 'failure', url: `${REPO}/actions/runs/6` },
]

function summary(overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    number: 481,
    title: 'Coding mode: PR watcher in the chat header',
    url: `${REPO}/pull/481`,
    state: 'open',
    headRef: 'feat/coding-mode',
    baseRef: 'main',
    checks: 'success',
    reviewDecision: 'review_required',
    mergeState: 'blocked',
    unresolvedThreads: 0,
    localAhead: 0,
    localDirty: false,
    fetchedAt: now - 12_000,
    via: 'gh',
    ...overrides,
  }
}

function details(overrides: Partial<PrDetails> = {}): PrDetails {
  return {
    lastCommit: {
      sha: '769558f6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
      headline: 'chore(sdk): Claude Agent SDK 0.3.296 -> 0.3.302',
      author: 'Mona Lisa',
      committedAt: now - 14 * MINUTE,
    },
    checks: passingChecks,
    reviewers: [
      { login: 'octocat', state: 'pending' },
      { login: 'monalisa', state: 'commented' },
    ],
    additions: 412,
    deletions: 88,
    changedFiles: 26,
    ...overrides,
  }
}

export type PrScenario =
  | 'open-passing'
  | 'open-running'
  | 'open-failing'
  | 'changes-requested'
  | 'open-threads'
  | 'approved-with-threads'
  | 'approved'
  | 'unpushed'
  | 'draft'
  | 'merged'
  | 'closed'
  | 'conflicting'
  | 'everything-wrong'
  | 'details-loading'
  | 'long-title'
  | 'loading'
  | 'none'
  | 'no-token'
  | 'not-git'

export const PR_SCENARIOS: Record<PrScenario, PrWatchState> = {
  'open-passing': { kind: 'pr', summary: summary(), details: details() },
  'open-running': {
    kind: 'pr',
    summary: summary({ checks: 'pending', mergeState: 'unknown' }),
    details: details({ checks: runningChecks }),
  },
  'open-failing': {
    kind: 'pr',
    summary: summary({ checks: 'failure', mergeState: 'unstable' }),
    details: details({ checks: failingChecks }),
  },
  'changes-requested': {
    kind: 'pr',
    summary: summary({ reviewDecision: 'changes_requested', unresolvedThreads: 3, via: 'GitHub (source)' }),
    details: details({
      reviewers: [
        { login: 'octocat', state: 'changes_requested' },
        { login: 'monalisa', state: 'approved' },
        { login: 'hubot', state: 'commented' },
      ],
    }),
  },
  'open-threads': {
    kind: 'pr',
    summary: summary({ reviewDecision: 'review_required', unresolvedThreads: 2 }),
    details: details({
      reviewers: [
        { login: 'octocat', state: 'commented' },
        { login: 'monalisa', state: 'commented' },
      ],
    }),
  },
  'approved-with-threads': {
    kind: 'pr',
    summary: summary({ reviewDecision: 'approved', mergeState: 'clean', unresolvedThreads: 1 }),
    details: details({ reviewers: [{ login: 'octocat', state: 'approved' }] }),
  },
  approved: {
    kind: 'pr',
    summary: summary({ reviewDecision: 'approved', mergeState: 'clean' }),
    details: details({ reviewers: [{ login: 'octocat', state: 'approved' }] }),
  },
  unpushed: {
    kind: 'pr',
    summary: summary({ mergeState: 'behind', localAhead: 2, localDirty: true }),
    details: details(),
  },
  draft: {
    kind: 'pr',
    summary: summary({ state: 'draft', checks: 'pending', title: 'WIP: PR watcher RPCs and token chain' }),
    details: details({ checks: runningChecks, reviewers: [] }),
  },
  merged: {
    kind: 'pr',
    summary: summary({ state: 'merged', reviewDecision: 'approved', mergeState: 'clean' }),
    details: details({ reviewers: [{ login: 'octocat', state: 'approved' }] }),
  },
  closed: {
    kind: 'pr',
    summary: summary({ state: 'closed', checks: 'failure', reviewDecision: 'none', mergeState: 'unknown' }),
    details: details({ checks: failingChecks, reviewers: [] }),
  },
  conflicting: {
    kind: 'pr',
    summary: summary({ mergeState: 'conflicting' }),
    details: details(),
  },
  'everything-wrong': {
    kind: 'pr',
    summary: summary({ checks: 'failure', reviewDecision: 'changes_requested', unresolvedThreads: 2, mergeState: 'conflicting' }),
    details: details({
      checks: failingChecks,
      reviewers: [{ login: 'octocat', state: 'changes_requested' }],
    }),
  },
  'details-loading': { kind: 'pr', summary: summary({ checks: 'pending' }) },
  'long-title': {
    kind: 'pr',
    summary: summary({
      number: 12873,
      title: 'Session continuation: keep the stale-auth retry and the path asymmetry fix together so the follow-up PR stays reviewable',
      headRef: 'bugfix/session-continuation-stale-auth-and-path-asymmetry',
    }),
    details: details(),
  },
  loading: { kind: 'loading' },
  none: { kind: 'none' },
  'no-token': { kind: 'unavailable', reason: 'no-token' },
  'not-git': { kind: 'unavailable', reason: 'not-git' },
}

export const PR_SCENARIO_OPTIONS: Array<{ label: string; value: PrScenario }> = [
  { label: 'Open · checks passing', value: 'open-passing' },
  { label: 'Open · checks running', value: 'open-running' },
  { label: 'Open · checks failing', value: 'open-failing' },
  { label: 'Changes requested (3 threads)', value: 'changes-requested' },
  { label: 'Comments only (2 open threads)', value: 'open-threads' },
  { label: 'Approved, 1 open thread', value: 'approved-with-threads' },
  { label: 'Approved · ready to merge', value: 'approved' },
  { label: 'Unpushed commits + dirty tree', value: 'unpushed' },
  { label: 'Draft', value: 'draft' },
  { label: 'Merged', value: 'merged' },
  { label: 'Closed', value: 'closed' },
  { label: 'Merge conflicts', value: 'conflicting' },
  { label: 'Conflicts + review + failing CI', value: 'everything-wrong' },
  { label: 'Card details loading', value: 'details-loading' },
  { label: 'Long title + branch', value: 'long-title' },
  { label: 'First lookup running (hidden)', value: 'loading' },
  { label: 'No PR for the branch (hidden)', value: 'none' },
  { label: 'Not a git repo (hidden)', value: 'not-git' },
  { label: 'No GitHub credential (hidden)', value: 'no-token' },
]

/**
 * The playground's stand-in for the future `usePrWatch` hook: the scenario's state, and a Refresh
 * that shows `refreshing` (and drops the details, like a real refetch) for a moment.
 */
export function useMockPrWatch(scenario: PrScenario): { state: PrWatchState; refresh: () => void; onCardOpenChange: (open: boolean) => void } {
  const base = PR_SCENARIOS[scenario]
  const [refreshing, setRefreshing] = React.useState(false)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const refresh = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setRefreshing(true)
    timerRef.current = setTimeout(() => setRefreshing(false), 900)
  }, [])

  const state = React.useMemo<PrWatchState>(() => {
    if (base.kind !== 'pr') return base
    return refreshing
      ? { ...base, refreshing: true, details: undefined }
      : { ...base, summary: { ...base.summary, fetchedAt: Date.now() - 12_000 } }
  }, [base, refreshing])

  return { state, refresh, onCardOpenChange: NOOP }
}

const NOOP = () => {}
