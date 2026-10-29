// Shared shapes. Money is rupees (number) everywhere except inside the split engine (paise).

export type Item = {
  id: string;
  name: string;
  qty: number;
  unit_price: number | null;
  total: number;
  /** Which tax bucket the line falls in: "food" (GST), "alcohol" (VAT), "other". */
  tax_class: string;
  /**
   * How "who had what" is given for this line. Unset: counts for quantities above 1 (they must add
   * up to qty), equal shares otherwise. 'ratio': the numbers are proportions (2 : 1), any total.
   */
  split?: 'ratio';
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

/** `checksOut: false` = no read added up in `reads` tries; the person must fix the lines. */
export type ScanResponse = { receipt: Receipt; issues: string[]; model: string | null; reads: number; checksOut: boolean };
/** `ratio`: item ids the speaker split by proportion ("60/40"), to switch to ratio mode. */
export type AssignResponse = { transcript: string; assignments: Assignments; flags: string[]; ratio: string[] };
