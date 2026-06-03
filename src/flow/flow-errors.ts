export type FlowErrorCode =
  | "ACTION_NOT_AVAILABLE"
  | "MISSING_REQUIRED_INPUT"
  | "INPUT_NOT_OBSERVED"
  | "MISSING_MANUAL_VALUE"
  | "UNKNOWN_OPERATION"
  | "UNEXPECTED_STATUS"
  | "UNKNOWN_STATE";

/**
 * A guard/validation failure in the flow runtime, carrying a machine-readable
 * code and structured details so the CLI can surface it to an agent as JSON
 * ({ ok: false, error: { code, message, ...details } }).
 */
export class FlowError extends Error {
  readonly code: FlowErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: FlowErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "FlowError";
    this.code = code;
    this.details = details;
  }
}
