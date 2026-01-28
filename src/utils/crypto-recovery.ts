import api from "../api/strapi";

type RecoveryStartResponse = {
  deliveryHint?: string;
  expiresAt?: string | number | null;
};

type RecoveryVerifyResponse = {
  token: string;
  expiresAt?: string | number | null;
};

type RecoveryCodesStatus = {
  hasCodes: boolean;
  remaining: number;
  generatedAt?: string | null;
};

export const requestRecoveryEmailCode = async () => {
  const res = await api.post("/crypto-recovery/start");
  return res.data as RecoveryStartResponse;
};

export const verifyRecoveryEmailCode = async (code: string) => {
  const res = await api.post("/crypto-recovery/verify", { code });
  return res.data as RecoveryVerifyResponse;
};

export const resetEncryptedProfileOnServer = async (payload: {
  token?: string;
  recoveryCode?: string;
}) => {
  const res = await api.post("/crypto-recovery/reset", payload);
  return res.data as { ok?: boolean };
};

export const fetchRecoveryCodesStatus = async () => {
  const res = await api.get("/crypto-recovery/codes/status");
  return res.data as RecoveryCodesStatus;
};

export const regenerateRecoveryCodes = async () => {
  const res = await api.post("/crypto-recovery/codes/regenerate");
  const codes = res.data?.codes;
  return Array.isArray(codes) ? (codes as string[]) : [];
};
