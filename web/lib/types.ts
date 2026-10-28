// Shared shapes. Money is rupees (number) everywhere except inside the split engine (paise).

export type Item = {
  id: string;
  name: string;
  qty: number;
  unit_price: number | null;
  total: number;
  /** Which tax bucket the line falls in: "food" (GST), "alcohol" (VAT), "other". */
  tax_class: string;
};

/** A tax, service charge, packing charge or discount (negative amount). */
export type Adjustment = {
  name: string;
  amount: number;
  /** "all" = shared by everyone's item subtotal; otherwise a tax_class. */
  applies_to: string;
};

export type Receipt = {
  restaurant: string | null;
  items: Item[];
  charges: Adjustment[];
  taxes: Adjustment[];
  round_off: number;
  subtotal: number | null;
  grand_total: number;
};

export type Person = { id: string; name: string };

/** item id -> person id -> units (weights; equal units = equal split). */
export type Assignments = Record<string, Record<string, number>>;

export type PersonTotal = {
  person_id: string;
  name: string;
  items: { item_id: string; name: string; amount: number }[];
  items_subtotal: number;
  /** Their part of taxes, charges and round-off. */
  extras: number;
  total: number;
};

export type SplitResult = { people: PersonTotal[]; bill_total: number; warnings: string[] };

export type ScanResponse = { receipt: Receipt; issues: string[]; model: string | null };
export type AssignResponse = { transcript: string; assignments: Assignments; flags: string[] };
