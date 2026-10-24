/** Browser-safe execution policy. A persisted sandbox path also identifies an unavailable remote connection. */
export function getExecutionCapabilities(connection?: { compose?: unknown } | null, workingDirectory?: string) {
  const remote = !!connection?.compose || !!workingDirectory?.startsWith('/__agent_compose__/');
  return {
    remote,
    localTools: !remote,
    workingDirectory: !remote,
    permissions: !remote,
    thinking: !remote,
    modelOverride: !remote,
    codingMode: !remote,
    compaction: !remote,
    backgroundCommands: !remote,
  };
}
