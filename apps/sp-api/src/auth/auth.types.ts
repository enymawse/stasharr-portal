import type { Request } from 'express';

export interface AuthenticatedAdmin {
  id: string;
  username: string;
  normalizedUsername: string;
  sessionVersion: number;
}

export interface RequestAuthContext {
  bootstrapRequired: boolean;
  authenticated: boolean;
  user: AuthenticatedAdmin | null;
  sessionId: string | null;
}

export interface AuthStatusResponse {
  bootstrapRequired: boolean;
  authenticated: boolean;
  username: string | null;
}

export type AuthenticatedRequest = Request & {
  authContext?: RequestAuthContext;
};
