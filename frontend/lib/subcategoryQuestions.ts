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
//   - "niveau" on running (hardlopen) is compared against a product's
//     specs.level, so keep its option VALUES as "beginner" / "gevorderd".
// Every other field id is just stored for future ranking rules.
// ============================================================================

export interface SubcategoryField {
  id: string;
  label: string;
  type: "number" | "select" | "text";
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export interface SubcategoryConfig {
  intro: string; // shown above the form, in the shop-assistant's voice
  fields: SubcategoryField[];
}

export const SUBCATEGORY_QUESTIONS: Record<string, SubcategoryConfig> = {
  // ---- Home & furniture ----
  woonkamer: {
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
  slaapkamer: {
    intro: "Tell us the room and bed size, and we'll narrow the frames and mattresses down to ones that actually fit.",
    fields: [
      { id: "roomSize", label: "Room size (m²)", type: "number", placeholder: "e.g. 14" },
      { id: "rooms", label: "How many bedrooms?", type: "number", placeholder: "e.g. 1" },
      {
        id: "bedSize", label: "Bed size", type: "select",
        options: [
          { value: "single", label: "Single" },
          { value: "double", label: "Double" },
          { value: "queen", label: "Queen" },
          { value: "king", label: "King" },
        ],
      },
    ],
  },
  keuken: {
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
  hardlopen: {
    intro: "Tell us how you run, and we'll skip the shoes and watches that aren't right for you.",
    fields: [
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
          { value: "5-10km", label: "5-10km" },
          { value: "10-25km", label: "10-25km" },
          { value: "marathon", label: "Marathon or beyond" },
          { value: "general", label: "Just staying fit" },
        ],
      },
    ],
  },
  fietsen: {
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
    ],
  },
  fitness: {
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
    ],
  },

  // ---- Technology ----
  laptops: {
    intro: "What you'll actually use it for matters far more than the spec sheet.",
    fields: [
      {
        id: "useCase", label: "Main use", type: "select",
        options: [
          { value: "everyday", label: "Everyday browsing" },
          { value: "work", label: "Work / office" },
          { value: "gaming", label: "Gaming" },
          { value: "creative", label: "Creative / video editing" },
        ],
      },
      {
        id: "budget", label: "Budget", type: "select",
        options: [
          { value: "value", label: "Keep it affordable" },
          { value: "mid", label: "Mid-range" },
          { value: "premium", label: "Premium" },
        ],
      },
    ],
  },
  smartphones: {
    intro: "Tell us what matters most and we'll rank accordingly, not by who pays us the most.",
    fields: [
      {
        id: "priorityFeature", label: "What matters most?", type: "select",
        options: [
          { value: "camera", label: "Camera" },
          { value: "battery", label: "Battery life" },
          { value: "performance", label: "Performance" },
          { value: "price", label: "Price" },
        ],
      },
      {
        id: "budget", label: "Budget", type: "select",
        options: [
          { value: "value", label: "Keep it affordable" },
          { value: "mid", label: "Mid-range" },
          { value: "premium", label: "Premium" },
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
