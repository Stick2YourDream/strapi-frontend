export const PRIVACY_TITLE = "Your Social Place Privacy Policy";
import type { PolicyRegionId } from "./policy-regions";

type PolicySection = {
  id?: string;
  title: string;
  body: string[];
};

export const PRIVACY_UPDATED = "Feb 20, 2026";

export const PRIVACY_SECTIONS: PolicySection[] = [
  {
    id: "overview",
    title: "1. Overview",
    body: [
      "Your Social Place is a motivational support network operated by Stick2YourDreams. This Privacy Policy explains how we collect, use, and share information when you use our services.",
    ],
  },
  {
    id: "information-we-collect",
    title: "2. Information we collect",
    body: [
      "Account data: name, email, phone number, login credentials, and verification preferences.",
      "Profile data: photos, bio, interests, and optional location details you choose to provide.",
      "Content and activity: posts, messages, comments, and engagement signals.",
      "Security data: trusted device identifiers and verification metadata.",
      "Push notifications: subscription tokens if you enable web push.",
      "Technical data: device type, browser, IP address, and basic usage analytics.",
    ],
  },
  {
    id: "how-we-use",
    title: "3. How we use information",
    body: [
      "Provide and improve the Service, including features like messaging, groups, and personalization.",
      "Verify accounts, send security codes, and honor trusted device settings.",
      "Deliver notifications you opt into, including push alerts.",
      "Moderate content, enforce rules, and protect the safety of the community.",
      "Send important service updates and respond to support requests.",
    ],
  },
  {
    id: "cookies",
    title: "4. Cookies and analytics",
    body: [
      "We use cookies and similar technologies to operate the Service and measure performance. You can accept or decline optional analytics storage in the cookie banner.",
      "To change your preferences later, use the Manage cookies option in the banner or visit the Cookie Policy page.",
    ],
  },
  {
    id: "sharing",
    title: "5. Sharing and disclosure",
    body: [
      "We do not sell your personal information.",
      "We may share data with trusted service providers who help us operate the Service (hosting, analytics, support).",
      "We may disclose information if required by law or to protect the safety of our community.",
    ],
  },
  {
    id: "retention",
    title: "6. Data retention",
    body: [
      "We keep account data while your account is active. You can request deletion at any time.",
      "Backups may retain information for a limited period after deletion.",
    ],
  },
  {
    id: "your-choices",
    title: "7. Your choices",
    body: [
      "Access, update, or delete your profile through your account settings.",
      "Control profile visibility, search indexing, and notification preferences.",
      "Enable or disable two-factor authentication and manage trusted devices.",
      "Use the Delete account or Delete data pages to submit requests.",
    ],
  },
  {
    id: "security",
    title: "8. Security",
    body: [
      "We use reasonable technical and organizational safeguards to protect your data, but no system is 100% secure.",
    ],
  },
  {
    id: "contact",
    title: "9. Contact",
    body: ["Questions or concerns? Email us at support@yoursocialplace.com."],
  },
];

export const PRIVACY_REGIONAL_SECTIONS: Record<PolicyRegionId, PolicySection[]> = {
  us: [
    {
      title: "United States privacy rights",
      body: [
        "Depending on your state, you may have rights to access, delete, or correct personal information.",
        "We do not sell personal information, and we honor lawful opt-out requests where applicable.",
      ],
    },
  ],
  eea_uk: [
    {
      title: "EEA/UK legal bases",
      body: [
        "We process personal data based on consent, performance of a contract, legitimate interests, and legal obligations.",
        "You can withdraw consent at any time without affecting prior processing.",
      ],
    },
    {
      title: "EEA/UK data subject rights",
      body: [
        "You may request access, rectification, erasure, restriction, portability, or object to processing.",
        "You may lodge a complaint with your local supervisory authority.",
      ],
    },
    {
      title: "International transfers",
      body: [
        "If we transfer personal data outside the EEA/UK, we use approved safeguards such as Standard Contractual Clauses.",
      ],
    },
  ],
  ca: [
    {
      title: "Canada privacy rights",
      body: [
        "You may request access to or correction of your personal information under PIPEDA and provincial laws.",
        "We may transfer data to service providers outside Canada with appropriate safeguards.",
      ],
    },
  ],
  anz: [
    {
      title: "Australia and New Zealand privacy rights",
      body: [
        "We comply with the Australian Privacy Principles and New Zealand Privacy Act where applicable.",
        "You can request access to or correction of your personal information.",
      ],
    },
  ],
  jp: [
    {
      title: "Japan privacy rights",
      body: [
        "We comply with the Act on the Protection of Personal Information (APPI).",
        "You may request disclosure, correction, or deletion of personal information as permitted by law.",
      ],
    },
  ],
  br: [
    {
      title: "Brazil privacy rights",
      body: [
        "We comply with the LGPD and process data based on legal bases such as consent, contract, and legitimate interests.",
        "You may request access, correction, deletion, or portability of your personal data.",
      ],
    },
  ],
  global: [
    {
      title: "International users",
      body: [
        "Local privacy laws may apply based on where you live.",
        "Contact us if you need help exercising your privacy rights.",
      ],
    },
  ],
};
