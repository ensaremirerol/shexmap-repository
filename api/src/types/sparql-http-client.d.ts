// Type declarations for sparql-http-client v3 (Response-based API)
declare module 'sparql-http-client' {
  interface SparqlClientOptions {
    endpointUrl: string;
    updateUrl?: string;
    storeUrl?: string;
    user?: string;
    password?: string;
    headers?: Record<string, string>;
  }

  interface QueryOptions {
    headers?: Record<string, string>;
    [key: string]: unknown;
  }

  interface Query {
    select(query: string, options?: QueryOptions): Promise<Response>;
    ask(query: string, options?: QueryOptions): Promise<Response>;
    construct(query: string, options?: QueryOptions): Promise<Response>;
  }

  interface Store {
    update(query: string, options?: QueryOptions): Promise<Response>;
  }

  export class SimpleClient {
    constructor(options: SparqlClientOptions);
    query: Query;
    store: Store;
    postDirect(query: string, options?: QueryOptions): Promise<Response>;
    postUrlencoded(query: string, options?: QueryOptions): Promise<Response>;
  }

  export class ParsingClient {
    constructor(options: SparqlClientOptions);
    query: Query;
    store: Store;
  }

  export class StreamClient {
    constructor(options: SparqlClientOptions);
    query: Query;
    store: Store;
  }
}
