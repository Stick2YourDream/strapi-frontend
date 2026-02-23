// src/types/auth.ts
export type AuthUser = {
  id: number;
  email: string;
  confirmed: boolean;
  appRole?: "user" | "moderator" | "admin";
  ageVerified?: boolean;
  ageVerifiedAt?: string | null;
  ageVerificationRequired?: boolean;
  ageVerificationDueAt?: string | null;
  ageVerificationOverdue?: boolean;
  ageVerificationDaysRemaining?: number | null;
  ageVerificationDobMismatchAt?: string | null;
  ageVerificationDobMismatchDueAt?: string | null;
  ageVerificationDobMismatchOverdue?: boolean;
  ageVerificationDobMismatchDaysRemaining?: number | null;
};

// ? Login response from Strapi: /auth/local or /auth/login/verify
export type AuthResponse = {
  jwt: string;
  user: AuthUser;
  trustedDevice?: boolean;
};

export type LoginStartResponse =
  | {
      jwt: string;
      user: AuthUser;
      trustedDevice?: boolean;
    }
  | {
      requiresEmailConfirmation: true;
      confirmationId: string;
      deliveryHint?: string;
    }
  | {
      requiresVerification: true;
      method: "sms" | "email" | "totp";
      challengeId: string;
      deliveryHint?: string;
      totpInvalid?: boolean;
    };

// ? Your custom register response: /register (no jwt)
export type RegisterResponse = {
  user: AuthUser;
  requiresConfirmation: boolean;
  emailConfirmationId?: string;
  message?: string;
};
