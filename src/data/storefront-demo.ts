export const STOREFRONT_DEMO_ENABLED_KEY = "storefront:demoListingsEnabled";
export const STOREFRONT_DEMO_COUNT_KEY = "storefront:demoListingsCount";
export const STOREFRONT_DEMO_MAX = 20;

export type StorefrontDemoSeed = {
  id: string;
  title: string;
  category: string;
  condition: string;
  location: string;
  description: string;
  images: string[];
  stock: number;
  localPickup: boolean;
  cashAccepted: boolean;
};

const DEMO_SEEDS: StorefrontDemoSeed[] = [
  {
    id: "demo-1",
    title: "Vintage film camera kit",
    category: "Art & Collectibles",
    condition: "Good",
    location: "Seattle, WA",
    description:
      "35mm film camera with two lenses, strap, and fresh film rolls. Great starter kit for analog photography.",
    images: ["https://picsum.photos/seed/ysp-demo-vintage-film-camera/1600/900"],
    stock: 1,
    localPickup: true,
    cashAccepted: true,
  },
  {
    id: "demo-2",
    title: "Ergonomic office chair",
    category: "Furniture",
    condition: "Like new",
    location: "Portland, OR",
    description:
      "Mesh ergonomic desk chair with lumbar support and adjustable armrests.",
    images: ["https://picsum.photos/seed/ysp-demo-ergonomic-office-chair/1600/900"],
    stock: 2,
    localPickup: true,
    cashAccepted: true,
  },
  {
    id: "demo-3",
    title: "Wireless noise-canceling headphones",
    category: "Electronics",
    condition: "Good",
    location: "Austin, TX",
    description:
      "Over-ear Bluetooth headphones with active noise canceling and carrying case.",
    images: ["https://picsum.photos/seed/ysp-demo-wireless-headphones/1600/900"],
    stock: 3,
    localPickup: false,
    cashAccepted: false,
  },
  {
    id: "demo-4",
    title: "Trail mountain bike",
    category: "Sports & Outdoors",
    condition: "Good",
    location: "Denver, CO",
    description:
      "27.5-inch hardtail mountain bike, recently tuned and ready for trails.",
    images: ["https://picsum.photos/seed/ysp-demo-trail-mountain-bike/1600/900"],
    stock: 1,
    localPickup: true,
    cashAccepted: true,
  },
  {
    id: "demo-5",
    title: "Acoustic guitar bundle",
    category: "Music & Instruments",
    condition: "Like new",
    location: "Nashville, TN",
    description:
      "Acoustic guitar with gig bag, tuner, and extra strings. Perfect for beginners.",
    images: ["https://picsum.photos/seed/ysp-demo-acoustic-guitar-bundle/1600/900"],
    stock: 1,
    localPickup: true,
    cashAccepted: true,
  },
  {
    id: "demo-6",
    title: "Gaming laptop 15-inch",
    category: "Computers",
    condition: "Good",
    location: "San Diego, CA",
    description:
      "High-refresh display gaming laptop with dedicated GPU and 16GB RAM.",
    images: ["https://picsum.photos/seed/ysp-demo-gaming-laptop/1600/900"],
    stock: 1,
    localPickup: false,
    cashAccepted: false,
  },
  {
    id: "demo-7",
    title: "Stainless espresso machine",
    category: "Appliances",
    condition: "Good",
    location: "Chicago, IL",
    description:
      "Home espresso machine with steam wand and tamper. Pulls rich shots consistently.",
    images: ["https://picsum.photos/seed/ysp-demo-espresso-machine/1600/900"],
    stock: 1,
    localPickup: true,
    cashAccepted: false,
  },
  {
    id: "demo-8",
    title: "4K aerial drone",
    category: "Cameras & Drones",
    condition: "Like new",
    location: "Phoenix, AZ",
    description:
      "Foldable drone with 4K camera, extra propellers, and two batteries.",
    images: ["https://picsum.photos/seed/ysp-demo-4k-drone/1600/900"],
    stock: 1,
    localPickup: false,
    cashAccepted: false,
  },
  {
    id: "demo-9",
    title: "Road running shoes",
    category: "Shoes",
    condition: "New",
    location: "Miami, FL",
    description:
      "Lightweight cushioned running shoes in original box, never worn.",
    images: ["https://picsum.photos/seed/ysp-demo-running-shoes/1600/900"],
    stock: 4,
    localPickup: true,
    cashAccepted: true,
  },
  {
    id: "demo-10",
    title: "4-person camping tent",
    category: "Sports & Outdoors",
    condition: "New",
    location: "Boise, ID",
    description:
      "Weather-resistant family tent with rainfly and carrying bag.",
    images: ["https://picsum.photos/seed/ysp-demo-camping-tent/1600/900"],
    stock: 2,
    localPickup: true,
    cashAccepted: true,
  },
  {
    id: "demo-11",
    title: "GPS smartwatch",
    category: "Electronics",
    condition: "Good",
    location: "Atlanta, GA",
    description:
      "Fitness smartwatch with heart-rate tracking, GPS, and charger included.",
    images: ["https://picsum.photos/seed/ysp-demo-gps-smartwatch/1600/900"],
    stock: 2,
    localPickup: false,
    cashAccepted: false,
  },
  {
    id: "demo-12",
    title: "Blender and juicer set",
    category: "Appliances",
    condition: "Like new",
    location: "Orlando, FL",
    description:
      "Countertop blender plus compact juicer for smoothies and meal prep.",
    images: ["https://picsum.photos/seed/ysp-demo-blender-juicer/1600/900"],
    stock: 1,
    localPickup: true,
    cashAccepted: true,
  },
  {
    id: "demo-13",
    title: "Record player turntable",
    category: "Music & Instruments",
    condition: "Good",
    location: "Minneapolis, MN",
    description:
      "Belt-drive turntable with built-in preamp and Bluetooth output.",
    images: ["https://picsum.photos/seed/ysp-demo-turntable-vinyl/1600/900"],
    stock: 1,
    localPickup: true,
    cashAccepted: true,
  },
  {
    id: "demo-14",
    title: "All-terrain baby stroller",
    category: "Baby & Kids",
    condition: "Good",
    location: "Charlotte, NC",
    description:
      "Foldable stroller with storage basket, canopy, and suspension wheels.",
    images: ["https://picsum.photos/seed/ysp-demo-baby-stroller/1600/900"],
    stock: 1,
    localPickup: true,
    cashAccepted: true,
  },
  {
    id: "demo-15",
    title: "Cordless power tool combo",
    category: "Tools",
    condition: "Like new",
    location: "Dallas, TX",
    description:
      "Drill, impact driver, batteries, and charger in a hard carrying case.",
    images: ["https://picsum.photos/seed/ysp-demo-power-tool-drill/1600/900"],
    stock: 2,
    localPickup: true,
    cashAccepted: true,
  },
  {
    id: "demo-16",
    title: "Handmade ceramic dinnerware set",
    category: "Home & Garden",
    condition: "New",
    location: "Santa Fe, NM",
    description:
      "Artisan ceramic plates and bowls, service for four.",
    images: ["https://picsum.photos/seed/ysp-demo-ceramic-dinnerware/1600/900"],
    stock: 1,
    localPickup: false,
    cashAccepted: false,
  },
  {
    id: "demo-17",
    title: "Portrait prime camera lens",
    category: "Cameras & Drones",
    condition: "Like new",
    location: "Los Angeles, CA",
    description:
      "Fast prime lens ideal for portraits and low-light photography.",
    images: ["https://picsum.photos/seed/ysp-demo-portrait-prime-lens/1600/900"],
    stock: 1,
    localPickup: true,
    cashAccepted: false,
  },
  {
    id: "demo-18",
    title: "Modern cat tree tower",
    category: "Pets & Supplies",
    condition: "Good",
    location: "Salt Lake City, UT",
    description:
      "Multi-level cat tower with scratching posts and a soft perch.",
    images: ["https://picsum.photos/seed/ysp-demo-cat-tree-tower/1600/900"],
    stock: 1,
    localPickup: true,
    cashAccepted: true,
  },
  {
    id: "demo-19",
    title: "Electric standing desk",
    category: "Office & Business",
    condition: "Good",
    location: "Boston, MA",
    description:
      "Height-adjustable desk with memory presets and cable tray.",
    images: ["https://picsum.photos/seed/ysp-demo-standing-desk/1600/900"],
    stock: 1,
    localPickup: true,
    cashAccepted: false,
  },
  {
    id: "demo-20",
    title: "Recreational kayak",
    category: "Sports & Outdoors",
    condition: "Good",
    location: "Tampa, FL",
    description:
      "Single-person kayak with paddle and seat cushion included.",
    images: ["https://picsum.photos/seed/ysp-demo-recreational-kayak/1600/900"],
    stock: 1,
    localPickup: true,
    cashAccepted: true,
  },
];

const clampDemoCount = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(STOREFRONT_DEMO_MAX, Math.floor(value)));
};

export const readStorefrontDemoEnabled = () => {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STOREFRONT_DEMO_ENABLED_KEY) === "true";
};

export const readStorefrontDemoCount = () => {
  if (typeof window === "undefined") return 0;
  const raw = Number(window.localStorage.getItem(STOREFRONT_DEMO_COUNT_KEY) || 0);
  return clampDemoCount(raw);
};

export const buildStorefrontDemoListings = (count: number, startIndex = 0) => {
  const total = clampDemoCount(count);
  if (!total) return [] as StorefrontDemoSeed[];
  return Array.from({ length: total }).map((_, index) => {
    const seed = startIndex + index;
    const source = DEMO_SEEDS[seed % DEMO_SEEDS.length];
    return {
      ...source,
      id: `demo-${seed + 1}`,
      images: [...source.images],
    };
  });
};
