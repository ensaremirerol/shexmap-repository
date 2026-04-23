import * as grpc from '@grpc/grpc-js';
import type { AuthContext } from '@shexmap/shared';
import { AUTH_META } from '@shexmap/shared';

export function buildAuthMeta(ctx: AuthContext): grpc.Metadata {
  const md = new grpc.Metadata();
  md.set(AUTH_META.USER_ID,      ctx.userId);
  md.set(AUTH_META.ROLE,         ctx.role);
  md.set(AUTH_META.AUTH_ENABLED, String(ctx.authEnabled));
  return md;
}
