export class ComposeConfigurationError extends Error {}

/** Runtime stderr is diagnostic output, never an assistant response. */
export function isComposeRuntimeError(output: string): boolean {
  return /^\s*(?:Error: )?pi model request failed:/i.test(output);
}

export function composeRunError(summary: string | undefined, output: string): string {
  const detail = isComposeRuntimeError(output) ? output : summary || "Remote agent run failed";
  const firstLine = detail.split(/\r?\n/)[0]!.split(/\s+at (?:async |\w+[.(]|file:)/)[0]!.trim();
  const status = firstLine.match(/(?:request failed:|HTTP)\s*(\d{3})/i)?.[1];
  const providerMessage = firstLine.match(/"message"\s*:\s*("(?:[^"\\]|\\.)*")/);
  if (providerMessage) {
    try {
      const message = JSON.parse(providerMessage[1]!) as string;
      return status ? `${message} (HTTP ${status})` : message;
    } catch {}
  }
  return firstLine || "Remote agent run failed";
}
