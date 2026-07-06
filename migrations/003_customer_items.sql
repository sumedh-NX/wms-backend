-- Per-customer item master: item code, name, and expected case pack.
-- Used to validate bin scans against a known catalog instead of trusting
-- whatever case pack a QR label happens to encode.
CREATE TABLE customer_items (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  item_name TEXT,
  case_pack INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (customer_id, item_code)
);
