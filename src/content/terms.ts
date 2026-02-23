export const TERMS_TITLE = "Your Social Place Terms and Conditions";
import type { PolicyRegionId } from "./policy-regions";

type PolicySection = {
  title: string;
  body: string[];
};

export const TERMS_UPDATED = "Feb 18, 2026";

export const TERMS_SECTIONS: PolicySection[] = [
  {
    title: "1. Acceptance of these Terms",
    body: [
      "By creating an account or using Your Social Place (the \"Service\"), you agree to these Terms and Conditions. If you do not agree, do not use the Service.",
      "If you are using the Service on behalf of an organization, you represent that you have the authority to bind that organization to these Terms.",
    ],
  },
  {
    title: "2. Eligibility and Accounts",
    body: [
      "You must be at least 18 years old to use the Service. You are responsible for the accuracy of the information you provide and for safeguarding your account credentials.",
      "You agree to keep your account information current and to notify us promptly of any unauthorized use of your account.",
      "You must provide a valid phone number or email for verification. We may send verification codes by email or SMS and offer optional two-factor authentication.",
    ],
  },
  {
    title: "3. Community Standards",
    body: [
      "Your Social Place is a motivational support network operated by Stick2YourDreams. Harassment, hateful conduct, threats, impersonation, and discriminatory content are not allowed.",
      "You agree not to post illegal content, malicious code, spam, or anything that would disrupt the Service or harm other users.",
    ],
  },
  {
    title: "3a. StoreFront prohibited listings",
    body: [
      "StoreFront is for physical goods only. Service listings, jobs, or paid tasks are not permitted.",
      "Adult content, sexual services, and explicit items (including pornography, nudity, adult toys, or sex dolls) are prohibited.",
      "Listings that violate these rules may be removed and accounts may be suspended or terminated.",
    ],
  },
  {
    title: "4. Content You Post",
    body: [
      "You own the content you submit, but you grant Your Social Place a non-exclusive, worldwide, royalty-free license to host, store, and display that content for operating the Service.",
      "You are responsible for the content you post and for ensuring you have the rights to any media or links you share.",
    ],
  },
  {
    title: "5. Moderation and Enforcement",
    body: [
      "We may remove content or restrict accounts that violate these Terms or our community standards.",
      "We may issue warnings and temporarily or permanently restrict accounts for repeated violations. This includes content that is abusive, hateful, or otherwise harmful.",
    ],
  },
  {
    title: "6. Beta Service Notice",
    body: [
      "The Service is in Beta. Features may change, break, or be removed without notice. You may experience interruptions or data loss.",
      "We appreciate your feedback and will use it to improve the Service.",
    ],
  },
  {
    title: "7. Privacy",
    body: [
      "We respect your privacy and handle data according to our policies. You control what you share with others.",
      "By using the Service, you acknowledge that we process your information to provide and improve the Service.",
      "You can manage profile visibility, search discoverability, and notification preferences in your account settings.",
    ],
  },
  {
    title: "8. Disclaimers",
    body: [
      "The Service is provided \"as is\" without warranties of any kind. We do not guarantee that the Service will be uninterrupted or error free.",
      "We are not responsible for user generated content or external links shared by users.",
    ],
  },
  {
    title: "9. Limitation of Liability",
    body: [
      "To the maximum extent permitted by law, Your Social Place will not be liable for any indirect, incidental, special, consequential, or punitive damages.",
      "Our total liability for any claim related to the Service will not exceed the amount you paid to use the Service in the past 12 months (if any).",
    ],
  },
  {
    title: "10. Termination",
    body: [
      "You may stop using the Service at any time. We may suspend or terminate your account if you violate these Terms or if required to protect the community.",
    ],
  },
  {
    title: "11. Changes to these Terms",
    body: [
      "We may update these Terms from time to time. If we make material changes, we will notify you by posting the updated Terms.",
      "Your continued use of the Service after updates means you accept the revised Terms.",
    ],
  },
  {
    title: "12. Contact",
    body: [
      "Questions or concerns can be sent to support@yoursocialplace.com.",
    ],
  },
];

export const TERMS_REGIONAL_SECTIONS: Record<PolicyRegionId, PolicySection[]> = {
  us: [
    {
      title: "United States governing law",
      body: [
        "If you live in the United States, these Terms are governed by U.S. law and the laws of the state where Stick2YourDreams is headquartered, without regard to conflict-of-law rules.",
        "You agree to bring disputes in the state or federal courts located in that state, unless mandatory law provides another venue.",
      ],
    },
    {
      title: "U.S. communications and notices",
      body: [
        "You consent to receive electronic communications and notices from us.",
        "If you provide a phone number, standard SMS and carrier rates may apply.",
      ],
    },
  ],
  eea_uk: [
    {
      title: "EEA/UK consumer protections",
      body: [
        "Nothing in these Terms limits any consumer rights that cannot be waived under the laws of your country.",
        "If there is a conflict between these Terms and mandatory local law, the local law prevails.",
      ],
    },
    {
      title: "Local courts and dispute resolution",
      body: [
        "You may bring claims in the courts of your habitual residence within the EEA/UK.",
        "We will not prevent you from using alternative dispute resolution where required by law.",
      ],
    },
  ],
  ca: [
    {
      title: "Canada consumer protections",
      body: [
        "Provincial consumer protection laws apply and may provide additional rights.",
        "If a provision is unenforceable in your province, it will be limited to the minimum extent necessary.",
      ],
    },
  ],
  anz: [
    {
      title: "Australia and New Zealand consumer guarantees",
      body: [
        "Our services come with guarantees that cannot be excluded under the Australian Consumer Law and New Zealand Consumer Guarantees Act.",
        "You may be entitled to a refund, replacement, or compensation for reasonably foreseeable loss.",
      ],
    },
  ],
  jp: [
    {
      title: "Japan consumer protections",
      body: [
        "Mandatory protections under Japanese consumer law apply.",
        "We do not exclude liability where prohibited by law.",
      ],
    },
  ],
  br: [
    {
      title: "Brazil consumer protections",
      body: [
        "Mandatory protections under the Brazilian Consumer Defense Code apply.",
        "We do not exclude liability where prohibited by law.",
      ],
    },
  ],
  global: [
    {
      title: "International use",
      body: [
        "If you access the Service outside the United States, you are responsible for complying with local laws.",
        "Nothing in these Terms limits rights that cannot be waived under your local law.",
      ],
    },
  ],
};
