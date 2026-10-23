import { expect, test } from "bun:test";
import { composeRunError, isComposeRuntimeError } from "./errors";

test("extracts the model provider message without exposing the runtime stack", () => {
  const output = 'Error: pi model request failed: 402: {"message":"成员余额不足","type":"permission_error"}\n    at PiRunner.handleEvent (file:///runtime/pi.js:295:49)';
  expect(isComposeRuntimeError(output)).toBe(true);
  expect(composeRunError("agent execution failed", output)).toBe("成员余额不足 (HTTP 402)");
});

test("preserves ordinary errors and never treats normal answers as stderr", () => {
  expect(isComposeRuntimeError("Here is how to fix an Error: in your code")).toBe(false);
  expect(composeRunError("Sandbox unavailable", "")).toBe("Sandbox unavailable");
  expect(composeRunError(undefined, "")).toBe("Remote agent run failed");
});
