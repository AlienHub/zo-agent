const PATH_BASED_TOOLS = new Set([
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Glob',
  'Grep',
]);

export function normalizePiToolInputForPreToolUse(
  sdkToolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (!PATH_BASED_TOOLS.has(sdkToolName)) return input;
  if (typeof input.path !== 'string' || input.file_path) return input;
  return { ...input, file_path: input.path };
}
