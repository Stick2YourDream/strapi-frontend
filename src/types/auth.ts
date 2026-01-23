// src/types/auth.ts
export type AuthUser = {
  id: number;
  email: string;
  confirmed: boolean;
  appRole?: "user" | "moderator" | "admin";
};

// ? Login response from Strapi: /auth/local or /auth/login/verify
export type AuthResponse = {
  jwt: string;
  user: AuthUser;
};

export type LoginStartResponse =
  | {
      jwt: string;
      user: AuthUser;
      trustedDevice?: boolean;
    }
  | {
      requiresVerification: true;
      method: "sms" | "email" | "totp";
      challengeId: string;
      deliveryHint?: string;
    };

// ? Your custom register response: /register (no jwt)
export type RegisterResponse = {
  user: AuthUser;
  requiresConfirmation: boolean;
  message?: string;
};
