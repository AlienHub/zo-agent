import type { AnnotationV1 } from '../../../../shared/types'

export const ARTIFACT_SESSION_ID = 'playground-artifact-session'

export function getResourceAnnotationMessageId(kind: string): string {
  return `resource:artifact:${kind}`
}

function getResourceSourceLabel(kind: string): string {
  return `artifact://${kind}`
}

export function formatResourceFollowUpMessage(params: {
  artifactKind: string
  note: string
  selectedText: string
}): string {
  const quoteText = params.selectedText.replace(/\s+/g, ' ').trim()
  return [
    '**Follow-ups**',
    '',
    `> [#1] Source: \`${getResourceSourceLabel(params.artifactKind)}\``,
    `> ${quoteText}`,
    `→ ${params.note}`,
  ].join('\n')
}

export function markFollowUpSent(annotation: AnnotationV1, note: string): AnnotationV1 {
  const sentAt = Date.now()
  const currentMeta = annotation.meta ?? {}
  const currentFollowUp = currentMeta.followUp && typeof currentMeta.followUp === 'object' && !Array.isArray(currentMeta.followUp)
    ? currentMeta.followUp as Record<string, unknown>
    : {}

  return {
    ...annotation,
    updatedAt: sentAt,
    meta: {
      ...currentMeta,
      followUp: {
        ...currentFollowUp,
        text: note,
        lastSentAt: sentAt,
        lastSentText: note,
      },
    },
  }
}
