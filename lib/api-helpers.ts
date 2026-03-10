import { type NextRequest } from 'next/server'

export function getRequestId(request: NextRequest): string {
  return request.headers.get('x-request-id') ?? crypto.randomUUID()
}

export function createResponseHeaders(
  requestId: string,
  additionalHeaders?: Record<string, string>
): Record<string, string> {
  return {
    'x-request-id': requestId,
    ...additionalHeaders,
  }
}
