import type { ApiError } from '../types/api.js';

export const http = {
  get: async (_url: string): Promise<unknown> => ({}),
  post: async (_url: string, _body: unknown): Promise<unknown> => ({}),
};

export class HttpError extends Error {
  constructor(public detail: ApiError) {
    super(detail.error);
  }
}
