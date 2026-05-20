import ArtifactViewerPage from './ArtifactViewerPage'
import type { SessionResourceDetails } from '../../shared/types'
import { toSessionArtifactDetails } from '../../shared/types'

interface SessionResourcePreviewPageProps {
  resourceDetails: SessionResourceDetails
  panelId?: string
  isFocusedPanel?: boolean
}

export default function SessionResourcePreviewPage({
  resourceDetails,
  panelId,
  isFocusedPanel,
}: SessionResourcePreviewPageProps) {
  return (
    <ArtifactViewerPage
      artifactDetails={toSessionArtifactDetails(resourceDetails)}
      panelId={panelId}
      isFocusedPanel={isFocusedPanel}
    />
  )
}
