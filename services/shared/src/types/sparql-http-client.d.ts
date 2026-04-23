declare module 'sparql-http-client' {
  interface QueryOptions {
    headers?: Record<string, string>;
  }

  interface ClientOptions {
    endpointUrl: string;
    updateUrl?: string;
    headers?: Record<string, string>;
  }

  export class SimpleClient {
    constructor(options: ClientOptions);
    query: {
      select(query: string, options?: QueryOptions): Promise<Response>;
      ask(query: string, options?: QueryOptions): Promise<Response>;
      construct(query: string, options?: QueryOptions): Promise<Response>;
    };
    postUrlencoded(body: string, options?: { update?: boolean }): Promise<Response | void>;
  }
}
