/**
 * Pages Index
 *
 * Export all page components for use in MainContentPanel.
 */

export { default as ChatPage } from './ChatPage'
export { default as SourceInfoPage } from './SourceInfoPage'
export { default as SessionResourcePreviewPage } from './SessionResourcePreviewPage'
// Settings pages
export {
  SettingsNavigator,
  AppSettingsPage,
  AiSettingsPage,
  AppearanceSettingsPage,
  InputSettingsPage,
  WorkspaceSettingsPage,
  PermissionsSettingsPage,
  LabelsSettingsPage,
  ShortcutsPage,
  PreferencesPage,
} from './settings'
