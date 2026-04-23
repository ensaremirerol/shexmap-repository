import * as grpc from '@grpc/grpc-js';

export function grpcCall<Req, Res>(
  client: grpc.Client,
  method: string,
  request: Req,
  meta: grpc.Metadata,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    (client as any)[method](request, meta, (err: any, res: Res) => {
      if (err) reject(err); else resolve(res);
    });
  });
}

export function snakeToCamel(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (obj !== null && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const camelKey = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      out[camelKey] = snakeToCamel(v);
    }
    return out;
  }
  return obj;
}
