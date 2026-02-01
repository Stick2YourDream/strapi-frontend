const normalizeDigits = (value?: string) => String(value || "").replace(/\D/g, "");

export const normalizeDialCode = (value?: string) => normalizeDigits(value);

export const extractNationalDigits = (value?: string, dialCode?: string) => {
  const digits = normalizeDigits(value);
  if (!digits) return "";
  const dial = normalizeDialCode(dialCode);
  if (dial && digits.startsWith(dial) && digits.length > dial.length) {
    return digits.slice(dial.length);
  }
  if (digits.length > 10) return digits.slice(-10);
  return digits;
};

const formatNorthAmericanPhone = (digits: string) => {
  if (!digits) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }
  return digits;
};

export const formatPhoneInput = (value?: string, dialCode?: string) => {
  const national = extractNationalDigits(value, dialCode);
  return formatNorthAmericanPhone(national);
};

export const formatPhoneDisplay = (value?: string, dialCode?: string) => {
  const national = extractNationalDigits(value, dialCode);
  if (!national) return "";
  const formatted = formatNorthAmericanPhone(national);
  const dial = normalizeDialCode(dialCode);
  return dial ? `+${dial} ${formatted}` : formatted;
};

export const buildTelLink = (value?: string, dialCode?: string) => {
  const national = extractNationalDigits(value, dialCode);
  if (!national) return "";
  const dial = normalizeDialCode(dialCode);
  return dial ? `+${dial}${national}` : national;
};
