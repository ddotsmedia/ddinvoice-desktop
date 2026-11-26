import { ErrorCode } from '@ddinvoice/contracts';

/** Maps 1:1 to the ApiError body {code, message, fields?}. */
export class ApiException extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiException';
  }

  static notFound(what = 'Resource'): ApiException {
    return new ApiException(404, ErrorCode.NotFound, `${what} not found`);
  }
  static forbidden(message = 'Permission denied'): ApiException {
    return new ApiException(403, ErrorCode.Forbidden, message);
  }
  static unprocessable(code: string, message: string, fields?: Record<string, string>): ApiException {
    return new ApiException(422, code, message, fields);
  }
  static conflict(code: string, message: string): ApiException {
    return new ApiException(409, code, message);
  }
  /** 409 VERSION_CONFLICT carrying the current server record so the client can show mine vs theirs. */
  static versionConflict(message: string, current: unknown): ApiException {
    return new ApiException(409, ErrorCode.VersionConflict, message, undefined, { current });
  }
  static validation(message: string, fields?: Record<string, string>): ApiException {
    return new ApiException(400, ErrorCode.ValidationFailed, message, fields);
  }
}
