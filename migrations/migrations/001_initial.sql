-- 001_initial.sql -----------------------------------------------------------
-- Users
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT CHECK (role IN ('admin','supervisor','operator')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Customers
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Mapping user <-> customer
CREATE TABLE user_customers (
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, customer_id)
);

-- Validation Strategies
CREATE TABLE validation_strategies (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,                     -- e.g., 'one_bin_to_one_pick'
  name TEXT NOT NULL,
  description TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  custom_js TEXT,                               -- optional custom script
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Customer ↔ Strategy link
CREATE TABLE customer_strategies (
  customer_id INT REFERENCES customers(id) ON DELETE CASCADE,
  strategy_id INT REFERENCES validation_strategies(id) ON DELETE CASCADE,
  PRIMARY KEY (customer_id, strategy_id)
);

-- Dispatches
CREATE SEQUENCE dispatch_number_seq START 1;
CREATE TABLE dispatches (
  id SERIAL PRIMARY KEY,
  dispatch_number BIGINT UNIQUE NOT NULL DEFAULT nextval('dispatch_number_seq'),
  customer_id INT REFERENCES customers(id) ON DELETE RESTRICT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT CHECK (status IN ('IN_PROGRESS','COMPLETED')) NOT NULL DEFAULT 'IN_PROGRESS',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Reference data captured from the **first** bin QR
  ref_product_code TEXT,
  ref_case_pack INT,
  ref_supply_date DATE,
  ref_schedule_sent_date DATE,
  ref_schedule_number TEXT,
  supply_quantity INT,
  total_schedule_bins INT,
  smg_qty INT DEFAULT 0,
  bin_qty INT DEFAULT 0
);

-- Bin entries (one row per scanned bin label)
CREATE TABLE dispatch_bins (
  id SERIAL PRIMARY KEY,
  dispatch_id INT REFERENCES dispatches(id) ON DELETE CASCADE,
  bin_number TEXT NOT NULL,
  product_code TEXT NOT NULL,
  case_pack INT NOT NULL,
  schedule_sent_date DATE,
  schedule_number TEXT,
  supply_quantity INT,
  supply_date DATE,
  vendor_code TEXT,
  invoice_number TEXT,
  product_name TEXT,
  unload_loc TEXT,
  raw_qr TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (dispatch_id, bin_number)
);

-- Pick‑list entries (one row per scanned pick‑list)
CREATE TABLE dispatch_picks (
  id SERIAL PRIMARY KEY,
  dispatch_id INT REFERENCES dispatches(id) ON DELETE CASCADE,
  pick_code TEXT NOT NULL,
  product_code TEXT NOT NULL,
  case_pack INT,
  raw_qr TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (dispatch_id, pick_code)
);

-- Audit log – every successful or failed scan
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  dispatch_id INT REFERENCES dispatches(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT now(),
  type TEXT CHECK (type IN ('BIN_LABEL','PICKLIST')) NOT NULL,
  code TEXT NOT NULL,               -- bin number or pick code
  product_code TEXT,
  result TEXT CHECK (result IN ('PASS','FAIL')) NOT NULL,
  operator_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  error_message TEXT,
  raw_qr TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
