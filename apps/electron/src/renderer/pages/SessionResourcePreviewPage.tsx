import ArtifactViewerPage from './ArtifactViewerPage'
import type { SessionResourceDetails } from '../../shared/types'
import { toSessionArtifactDetails } from '../../shared/types'

interface SessionResourcePreviewPageProps {
  resourceDetails: SessionResourceDetails
}

export default function SessionResourcePreviewPage({
  resourceDetails,
}: SessionResourcePreviewPageProps) {
  return <ArtifactViewerPage artifactDetails={toSessionArtifactDetails(resourceDetails)} />
}
