// src/types/auth.ts
export type AuthUser = {
  id: number;
  username: string;
  email: string;
  confirmed: boolean;
};

// ✅ Login response from Strapi: /auth/local
export type AuthResponse = {
  jwt: string;
  user: AuthUser;
};

// ✅ Your custom register response: /register (no jwt)
export type RegisterResponse = {
  user: AuthUser;
  requiresConfirmation: boolean;
  message?: string;
};
