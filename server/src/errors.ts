export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = (what = 'Data') => new HttpError(404, `${what} tidak ditemukan.`);
export const badRequest = (msg: string, extra: Record<string, unknown> = {}) => new HttpError(400, msg, extra);
