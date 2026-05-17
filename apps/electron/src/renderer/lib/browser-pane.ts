export interface OpenInAppBrowserTarget {
  url?: string
  filePath?: string
  bindToSessionId?: string | null
}

export async function openInAppBrowser(target: OpenInAppBrowserTarget): Promise<string> {
  const browserPaneApi = window.electronAPI?.browserPane
  if (!browserPaneApi) {
    throw new Error('In-app browser is unavailable')
  }

  const navigateTarget = target.url ?? target.filePath
  if (!navigateTarget) {
    throw new Error('Missing browser target')
  }

  const instanceId = await browserPaneApi.create({
    show: true,
    ...(target.bindToSessionId ? { bindToSessionId: target.bindToSessionId } : {}),
  })

  await browserPaneApi.navigate(instanceId, navigateTarget)
  await browserPaneApi.focus(instanceId)
  return instanceId
}
