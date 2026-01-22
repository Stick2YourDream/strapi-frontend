// src/types/auth.ts
export type AuthUser = {
  id: number;
  username: string;
  email: string;
  confirmed: boolean;
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
      method: "sms" | "email";
      challengeId: string;
      deliveryHint?: string;
    };

// ? Your custom register response: /register (no jwt)
export type RegisterResponse = {
  user: AuthUser;
  requiresConfirmation: boolean;
  message?: string;
};
