export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;
  constructor(status: number, message: string, code = 'BAD_REQUEST', options: ErrorOptions & { headers?: Record<string, string> } = {}) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.headers = options.headers || {};
  }
}

export function requireValue(condition: unknown, message: string, code = 'VALIDATION_ERROR'): asserts condition {
  if (!condition) throw new ApiError(400, message, code);
}
