// ============================================================================
// SUBCATEGORY INTAKE QUESTIONS
// ----------------------------------------------------------------------------
// A short, subcategory-specific set of questions shown when a shopper clicks
// through from a category page (e.g. Home & furniture -> Living room). This
// is the "deeper questionnaire" the contract already has a home for:
// ShopperProfile.detail is keyed by subcategory id (see contract/types.ts),
// so answers here are saved straight into that shape and the existing
// personalisation engine (lib/profile.ts) can use them immediately.
//
// Field ids are free-form EXCEPT where they intentionally match a key the
// scoring engine already reads (see lib/profile.ts scoreProduct):
//   - "niveau" on running is compared against a product's specs.level, so
//     keep its option VALUES as "beginner" / "gevorderd".
// Every other field id is just stored for future ranking rules.
//
// Subcategory ids are English throughout (running, cycling, fitness-gym, ...),
// matching backend/src/api/contract-queries.ts SUBCATEGORY_META and the tags
// in backend/src/sources/ebay.ts DEFAULT_QUERIES.
// ============================================================================

export interface SubcategoryField {
  id: string;
  label: string;
  type: "number" | "select" | "text";
  placeholder?: string;
  options?: { value: string; label: string }[];
  hint?: string; // optional help text shown below the field
}

export interface SubcategoryConfig {
  intro: string; // shown above the form, in the shop-assistant's voice
  fields: SubcategoryField[];
}

export const SUBCATEGORY_QUESTIONS: Record<string, SubcategoryConfig> = {
  // ---- Home & furniture ----
  furniture: {
    intro: "A few details about the room, and we'll point you at the right sofa, table and rug instead of every one in the catalogue.",
    fields: [
      { id: "roomSize", label: "Room size (m²)", type: "number", placeholder: "e.g. 24" },
      { id: "rooms", label: "How many living rooms are you furnishing?", type: "number", placeholder: "e.g. 1" },
      {
        id: "style", label: "Style you're after", type: "select",
        options: [
          { value: "modern", label: "Modern" },
          { value: "classic", label: "Classic" },
          { value: "scandi", label: "Scandinavian" },
          { value: "any", label: "No preference" },
        ],
      },
    ],
  },
  bedroom: {
    intro: "Tell us the room and bed size, and we'll narrow the frames and mattresses down to ones that actually fit.",
    fields: [
      { id: "roomSize", label: "Room size (m²)", type: "number", placeholder: "e.g. 14" },
      { id: "rooms", label: "How many bedrooms?", type: "number", placeholder: "e.g. 1" },
      {
        id: "bedSize", label: "Bed size", type: "select",
        options: [
          { value: "single", label: "Single (90 cm)" },
          { value: "double", label: "Double (140 cm)" },
          { value: "queen", label: "Queen (160 cm)" },
          { value: "king", label: "King (180 cm+)" },
        ],
      },
    ],
  },
  'kitchen-dining': {
    intro: "A quick sense of the kitchen and who you cook for shapes what's actually worth buying.",
    fields: [
      {
        id: "kitchenSize", label: "Kitchen size", type: "select",
        options: [
          { value: "compact", label: "Compact" },
          { value: "medium", label: "Medium" },
          { value: "large", label: "Large" },
        ],
      },
      { id: "people", label: "How many people do you usually cook for?", type: "number", placeholder: "e.g. 2" },
    ],
  },

  // ---- Sport ----
  running: {
    intro: "Tell us how you run, and we'll skip the shoes and watches that aren't right for you.",
    fields: [
      {
        id: "shoeSize", label: "Shoe size (EU)", type: "select",
        options: [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48].map((s) => ({
          value: String(s), label: String(s),
        })),
      },
      {
        id: "niveau", label: "Your level", type: "select",
        options: [
          { value: "beginner", label: "Beginner" },
          { value: "gevorderd", label: "Advanced" },
        ],
      },
      {
        id: "afstand", label: "What are you training for?", type: "select",
        options: [
          { value: "5-10km", label: "5–10 km" },
          { value: "10-25km", label: "10–25 km" },
          { value: "marathon", label: "Marathon or beyond" },
          { value: "general", label: "Just staying fit" },
        ],
      },
    ],
  },
  cycling: {
    intro: "The right bike and kit depend entirely on how and how far you ride.",
    fields: [
      {
        id: "type", label: "Type of cycling", type: "select",
        options: [
          { value: "road", label: "Road" },
          { value: "mountain", label: "Mountain" },
          { value: "city", label: "City / commuting" },
          { value: "electric", label: "Electric" },
        ],
      },
      { id: "distance", label: "Typical distance per week (km)", type: "number", placeholder: "e.g. 40" },
      {
        id: "clothingSize", label: "Clothing size", type: "select",
        options: [
          { value: "XS", label: "XS" },
          { value: "S", label: "S" },
          { value: "M", label: "M" },
          { value: "L", label: "L" },
          { value: "XL", label: "XL" },
          { value: "XXL", label: "XXL" },
        ],
      },
    ],
  },
  'fitness-gym': {
    intro: "What you're training for and where you'll train changes what's worth buying.",
    fields: [
      {
        id: "goal", label: "Main goal", type: "select",
        options: [
          { value: "strength", label: "Strength" },
          { value: "cardio", label: "Cardio" },
          { value: "weight-loss", label: "Weight loss" },
          { value: "general", label: "General fitness" },
        ],
      },
      {
        id: "space", label: "Where will you train?", type: "select",
        options: [
          { value: "small-space", label: "Small space at home" },
          { value: "large-space", label: "Garage / large space" },
          { value: "gym", label: "Gym membership" },
        ],
      },
      {
        id: "clothingSize", label: "Clothing size", type: "select",
        options: [
          { value: "XS", label: "XS" },
          { value: "S", label: "S" },
          { value: "M", label: "M" },
          { value: "L", label: "L" },
          { value: "XL", label: "XL" },
          { value: "XXL", label: "XXL" },
        ],
      },
    ],
  },

  // ---- Technology ----
  // We ask what the shopper will DO with the device, not what specs they want.
  // Scoopt translates the use case into the right RAM, storage and display —
  // the shopper should never have to know those numbers themselves.
  'laptops-computers': {
    intro: "Tell us what you'll actually use it for — we'll translate that into the right RAM, storage and display so you don't have to.",
    fields: [
      {
        id: "useCase", label: "What will you mainly use it for?", type: "select",
        options: [
          { value: "everyday", label: "Everyday browsing & email" },
          { value: "work", label: "Work / office (documents, video calls)" },
          { value: "school", label: "School or university" },
          { value: "gaming", label: "Gaming" },
          { value: "creative", label: "Creative work (video editing, design, music)" },
        ],
        hint: "Don't worry about specs — we'll match those to your answer.",
      },
      {
        id: "portability", label: "How often will you carry it?", type: "select",
        options: [
          { value: "always", label: "Every day — lightness matters" },
          { value: "sometimes", label: "Sometimes — balance is fine" },
          { value: "rarely", label: "Rarely — mostly on a desk" },
        ],
      },
      {
        id: "budget", label: "Budget", type: "select",
        options: [
          { value: "value", label: "Keep it affordable (under €600)" },
          { value: "mid", label: "Mid-range (€600–€1,200)" },
          { value: "premium", label: "Premium (€1,200+)" },
        ],
      },
    ],
  },
  smartphones: {
    intro: "Tell us what matters most and we'll rank accordingly — not by who pays us the most.",
    fields: [
      {
        id: "priorityFeature", label: "What matters most to you?", type: "select",
        options: [
          { value: "camera", label: "Camera quality" },
          { value: "battery", label: "Battery life" },
          { value: "performance", label: "Speed & performance" },
          { value: "price", label: "Price" },
          { value: "compact", label: "Compact size" },
        ],
      },
      {
        id: "budget", label: "Budget", type: "select",
        options: [
          { value: "value", label: "Keep it affordable (under €300)" },
          { value: "mid", label: "Mid-range (€300–€700)" },
          { value: "premium", label: "Premium (€700+)" },
        ],
      },
    ],
  },
};

// A generic fallback so a subcategory we haven't hand-tuned yet is still
// clickable and useful, rather than a dead end.
export const DEFAULT_SUBCATEGORY_CONFIG: SubcategoryConfig = {
  intro: "A couple of quick questions, and we'll point you at the right products instead of the whole catalogue.",
  fields: [
    {
      id: "budget", label: "Budget", type: "select",
      options: [
        { value: "value", label: "Keep it affordable" },
        { value: "mid", label: "Mid-range" },
        { value: "premium", label: "Premium" },
      ],
    },
    {
      id: "priority", label: "What matters most?", type: "select",
      options: [
        { value: "price", label: "Price" },
        { value: "quality", label: "Quality" },
        { value: "newest", label: "Newest" },
      ],
    },
  ],
};

export function getSubcategoryConfig(subcategoryId: string): SubcategoryConfig {
  return SUBCATEGORY_QUESTIONS[subcategoryId] ?? DEFAULT_SUBCATEGORY_CONFIG;
}
