import {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

export interface MockReply {
  status: number;
  data?: unknown;
}

/** A reply, or a function computing it from the request (may be async to simulate latency). */
export type MockResponder =
  | MockReply
  | 'network-error'
  | ((
      config: InternalAxiosRequestConfig,
    ) => MockReply | 'network-error' | Promise<MockReply | 'network-error'>);

export interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  data: unknown;
  withCredentials: boolean | undefined;
}

/**
 * Minimal in-memory transport for axios. Responders are registered per `METHOD url` and used in
 * order; the last one stays in place for further calls.
 */
export function createMockAdapter() {
  const responders = new Map<string, MockResponder[]>();
  const requests: RecordedRequest[] = [];

  function on(method: string, url: string, ...replies: MockResponder[]) {
    responders.set(`${method.toUpperCase()} ${url}`, replies);
  }

  const adapter: AxiosAdapter = async (config) => {
    const method = (config.method ?? 'get').toUpperCase();
    const url = config.url ?? '';
    const authorization = config.headers.get('Authorization');
    requests.push({
      method,
      url,
      authorization: typeof authorization === 'string' ? authorization : undefined,
      data: typeof config.data === 'string' ? (JSON.parse(config.data) as unknown) : config.data,
      withCredentials: config.withCredentials,
    });

    const queue = responders.get(`${method} ${url}`);
    const responder = queue && queue.length > 1 ? queue.shift() : queue?.[0];
    if (!responder) {
      throw new Error(`No mock response for ${method} ${url}`);
    }
    const reply = typeof responder === 'function' ? await responder(config) : responder;
    if (reply === 'network-error') {
      throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config);
    }

    const response: AxiosResponse = {
      data: reply.data,
      status: reply.status,
      statusText: '',
      headers: new AxiosHeaders(),
      config,
    };
    const validateStatus = config.validateStatus ?? ((status: number) => status < 300);
    if (validateStatus(reply.status)) {
      return response;
    }
    throw new AxiosError(
      `Request failed with status code ${reply.status}`,
      reply.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      response,
    );
  };

  function requestsTo(method: string, url: string): RecordedRequest[] {
    return requests.filter((r) => r.method === method.toUpperCase() && r.url === url);
  }

  return { adapter, on, requests, requestsTo };
}

export type MockAdapter = ReturnType<typeof createMockAdapter>;

/** Promise whose resolution is controlled by the test. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export function errorBody(code: string, message = code) {
  return { error: { code, message } };
}
