export type UriErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_ASCII'
  | 'INVALID_CHARACTER'
  | 'CONTROL_CHARACTER'
  | 'BACKSLASH_NOT_ALLOWED'
  | 'INVALID_PERCENT_ENCODING'
  | 'INVALID_SCHEME'
  | 'INVALID_AUTHORITY'
  | 'INVALID_HOST'
  | 'INVALID_PORT'
  | 'INVALID_USERINFO'
  | 'INVALID_IP_LITERAL'
  | 'BASE_NOT_ABSOLUTE';

export class UriError extends Error {
  readonly code: UriErrorCode;
  readonly position?: number;

  constructor(code: UriErrorCode, message: string, position?: number) {
    super(message);
    this.name = 'UriError';
    this.code = code;
    if (position !== undefined) this.position = position;
  }
}

export interface SerializedError {
  code: UriErrorCode;
  message: string;
  position?: number;
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof UriError) {
    return {
      code: err.code,
      message: err.message,
      ...(err.position === undefined ? {} : { position: err.position }),
    };
  }
  return { code: 'INVALID_INPUT', message: (err as Error).message ?? String(err) };
}
