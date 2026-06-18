import React from 'react'
import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

mock.module('@/context/AppShellContext', () => ({
  useAppShellContext: () => ({
    activeWorkspaceId: 'workspace-1',
  }),
}))

mock.module('sonner', () => ({
  toast: {
    error: () => {},
  },
}))

mock.module('@/components/app-shell/PanelHeader', () => ({
  PanelHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}))

mock.module('@/components/ui/HeaderMenu', () => ({
  HeaderMenu: () => <button type="button">menu</button>,
}))

mock.module('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

mock.module('@/components/ui/button', () => ({
  Button: ({ children, title }: { children: React.ReactNode; title?: string }) => <button type="button" title={title}>{children}</button>,
}))

mock.module('@/lib/navigate', () => ({
  routes: {
    view: {
      settings: (slug: string) => `/settings/${slug}`,
    },
  },
}))

mock.module('@/components/settings', () => ({
  SettingsCard: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  SettingsCardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SettingsSection: ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </section>
  ),
  SettingsToggle: ({ label, description }: { label: string; description?: string }) => (
    <label>
      <span>{label}</span>
      {description && <small>{description}</small>}
    </label>
  ),
}))

const { default: SecuritySettingsPage, AllowedPathRulesList } = await import('../SecuritySettingsPage')

describe('SecuritySettingsPage', () => {
  it('renders the personal protection controls without a safety-mode selector', () => {
    const html = renderToStaticMarkup(<SecuritySettingsPage />)

    expect(html).toContain('settings.security.sensitiveContextProtection')
    expect(html).toContain('settings.security.enableProtection')
    expect(html).toContain('settings.security.sensitiveFiles')
    expect(html).toContain('settings.security.outputRedaction')
    expect(html).toContain('settings.security.fieldRedaction')
    expect(html).toContain('settings.security.egressConfirmation')
    expect(html).toContain('common.comingSoon')
    expect(html).toContain('settings.security.allowedPaths')
    expect(html).not.toContain('settings.security.effectiveBehavior')
    expect(html).not.toContain('settings.security.modePersonal')
    expect(html).not.toContain('settings.security.modeBalanced')
    expect(html).not.toContain('settings.security.modeStrict')
  })

  it('renders permanent sensitive-path allow rules with a revoke action', () => {
    const html = renderToStaticMarkup(
      <AllowedPathRulesList
        allowRules={[
          {
            scope: 'workspace',
            kind: 'sensitive_path_allow',
            path: '/repo/.env.local',
            createdBy: 'permission_prompt',
            createdAt: '2026-06-18T08:00:00.000Z',
          },
        ]}
        onRevoke={() => {}}
        t={(key: string) => key}
      />,
    )

    expect(html).toContain('/repo/.env.local')
    expect(html).toContain('title=\"common.remove\"')
    expect(html).not.toContain('settings.security.noAllowedPaths')
  })

  it('renders an empty state when no sensitive paths are permanently allowed', () => {
    const html = renderToStaticMarkup(
      <AllowedPathRulesList
        allowRules={[]}
        onRevoke={() => {}}
        t={(key: string) => key}
      />,
    )

    expect(html).toContain('settings.security.noAllowedPaths')
  })
})
