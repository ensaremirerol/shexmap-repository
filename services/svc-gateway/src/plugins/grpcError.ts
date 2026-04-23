import type { FastifyReply } from 'fastify';

const GRPC_TO_HTTP: Record<number, number> = {
  5:  404,
  16: 401,
  7:  403,
  3:  400,
  13: 500,
};

export function grpcErrorToHttp(reply: FastifyReply, err: any): FastifyReply {
  const code = err?.code ?? err?.details?.code;
  const status = GRPC_TO_HTTP[code as number] ?? 500;
  const message = err?.details ?? err?.message ?? 'Internal error';
  return reply.code(status).send({ error: message });
}
