-- SHOEPOS schema. Money columns are REAL in base currency (USD), rounded to 2dp
-- through app.money.round_base_money before every write. Timestamps are ISO-8601 TEXT (UTC).

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pos_users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL CHECK (role IN ('admin','manager','cashier')),
  pin_salt   TEXT NOT NULL,
  pin_hash   TEXT NOT NULL,
  -- JSON allowlist of sections; NULL = role default. Column reserved, UI cut in v1.
  sections   TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  is_default_pin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES pos_users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shoe_models (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  brand        TEXT,
  category     TEXT,
  image        TEXT,               -- icon key ('icon:sneaker'), data-URL thumbnail, or legacy emoji
  color_images TEXT,               -- JSON object: color name -> data-URL thumbnail
  tile_color   TEXT,               -- POS tile theme color key
  base_price   REAL NOT NULL DEFAULT 0,
  default_cost REAL NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shoe_variants (
  id             TEXT PRIMARY KEY,
  model_id       TEXT NOT NULL REFERENCES shoe_models(id),
  color          TEXT NOT NULL,
  size           TEXT NOT NULL,
  sku            TEXT UNIQUE,
  barcode        TEXT,
  price_override REAL,             -- NULL = inherit shoe_models.base_price
  stock_qty      INTEGER NOT NULL DEFAULT 0,
  last_cost      REAL,             -- updated on receive; frozen into sale lines
  active         INTEGER NOT NULL DEFAULT 1,
  UNIQUE (model_id, color, size)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id            TEXT PRIMARY KEY,
  variant_id    TEXT NOT NULL REFERENCES shoe_variants(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN
                  ('receive','sale','return','adjustment','void_restock')),
  qty           INTEGER NOT NULL,          -- signed: receive/return/void +, sale -
  unit_cost     REAL,
  ref_sale_id   TEXT,
  ref_return_id TEXT,
  ref_purchase_id TEXT,
  note          TEXT,
  needs_review  INTEGER NOT NULL DEFAULT 0, -- oversell (sold beyond available stock)
  reviewed_at   TEXT,
  reviewed_by   TEXT,
  review_note   TEXT,
  user_id       TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  phone        TEXT,
  note         TEXT,
  credit_limit REAL NOT NULL DEFAULT 0,    -- 0 = unlimited
  store_credit REAL NOT NULL DEFAULT 0,    -- excess return credit held for the customer
  is_system    INTEGER NOT NULL DEFAULT 0, -- walk-in cash customer, protected
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  id              TEXT PRIMARY KEY,          -- client-generatable (offline replay idempotency)
  order_no        INTEGER,                   -- sequential human label (ORD-00042)
  customer_id     TEXT REFERENCES customers(id),
  status          TEXT NOT NULL CHECK (status IN ('completed','partial','unpaid','voided')),
  subtotal        REAL NOT NULL,
  discount_amount REAL NOT NULL DEFAULT 0,
  discount_reason TEXT,
  tax_amount      REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL,
  upfront_paid    REAL NOT NULL DEFAULT 0,   -- register-paid at sale time; NEVER a payments row
  paid_amount     REAL NOT NULL DEFAULT 0,
  due_amount      REAL NOT NULL DEFAULT 0,
  returned_amount REAL NOT NULL DEFAULT 0,
  return_status   TEXT CHECK (return_status IN (NULL,'partial','full')),
  items_count     INTEGER NOT NULL DEFAULT 0,
  tender_currency TEXT NOT NULL,
  tender_rate     REAL,                      -- frozen at sale time, never re-derived
  void_reason     TEXT,
  voided_at       TEXT,
  voided_by       TEXT,
  status_before_void TEXT,
  user_id         TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_items (
  id           TEXT PRIMARY KEY,
  sale_id      TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  variant_id   TEXT,                -- NULL = custom/misc line (no stock impact)
  -- Frozen labels so history and printing survive catalog edits:
  model_name   TEXT NOT NULL,
  brand        TEXT,
  color        TEXT,
  size         TEXT,
  sku          TEXT,
  qty          INTEGER NOT NULL,
  returned_qty INTEGER NOT NULL DEFAULT 0,
  unit_price   REAL NOT NULL,
  unit_cost    REAL NOT NULL DEFAULT 0,   -- frozen at sale time -> profit reports
  line_total   REAL NOT NULL
);

-- Collection payments. A collection spanning N orders is N rows sharing a group id:
-- row id = '<groupId>:<n>'. The sale-time upfront payment is sales.upfront_paid ONLY.
CREATE TABLE IF NOT EXISTS payments (
  id              TEXT PRIMARY KEY,
  customer_id     TEXT REFERENCES customers(id),
  sale_id         TEXT NOT NULL REFERENCES sales(id),
  amount          REAL NOT NULL,
  method          TEXT NOT NULL DEFAULT 'cash',
  kind            TEXT NOT NULL DEFAULT 'collection'
                  CHECK (kind IN ('collection','store_credit_use')),
  notes           TEXT,
  tender_currency TEXT,
  tender_rate     REAL,
  user_id         TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_returns (
  id              TEXT PRIMARY KEY,
  sale_id         TEXT NOT NULL REFERENCES sales(id),
  customer_id     TEXT,
  total_value     REAL NOT NULL,            -- discount+tax-adjusted value of returned lines
  applied_to_due  REAL NOT NULL DEFAULT 0,  -- part that reduced the sale's open due
  refund_cash     REAL NOT NULL DEFAULT 0,  -- part physically refunded from the drawer
  refund_credit   REAL NOT NULL DEFAULT 0,  -- part granted as store credit
  refund_method   TEXT NOT NULL CHECK (refund_method IN ('cash','store_credit')),
  reason          TEXT,
  tender_currency TEXT,
  tender_rate     REAL,
  user_id         TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_return_items (
  id           TEXT PRIMARY KEY,
  return_id    TEXT NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_item_id TEXT,
  variant_id   TEXT,
  model_name   TEXT,
  color        TEXT,
  size         TEXT,
  qty          INTEGER NOT NULL,
  unit_price   REAL NOT NULL,
  unit_cost    REAL NOT NULL DEFAULT 0,
  line_value   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  note       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Supplier purchases (goods-in). Receiving a purchase increments variant stock and
-- writes matching stock_movements 'receive' rows (ref_purchase_id). An optional
-- drawer payment writes one cash_drawer_movements 'paid_out' row; voiding reverses
-- stock with 'adjustment' rows and refunds the drawer with a 'cash_in' row.
CREATE TABLE IF NOT EXISTS purchases (
  id          TEXT PRIMARY KEY,
  purchase_no INTEGER,                     -- sequential human label (PUR-00042)
  supplier_id TEXT REFERENCES suppliers(id),
  invoice_no  TEXT,
  status      TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','voided')),
  total_cost  REAL NOT NULL DEFAULT 0,
  items_count INTEGER NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,     -- part paid from the drawer at entry time
  notes       TEXT,
  void_reason TEXT,
  voided_at   TEXT,
  voided_by   TEXT,
  user_id     TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id          TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  variant_id  TEXT,
  -- Frozen labels so history survives catalog edits:
  model_name  TEXT NOT NULL,
  color       TEXT,
  size        TEXT,
  sku         TEXT,
  qty         INTEGER NOT NULL,
  unit_cost   REAL NOT NULL,
  line_total  REAL NOT NULL
);

-- Manual drawer movements only (paid-outs, cash drops/ins). Sales cash-in, collection
-- cash-in and return refunds are DERIVED from sales/payments/sale_returns rows, exactly
-- like the original's client-built cash ledger. No double entry.
CREATE TABLE IF NOT EXISTS cash_drawer_movements (
  id              TEXT PRIMARY KEY,
  amount          REAL NOT NULL,            -- base USD, signed (+ in, - out)
  movement_type   TEXT NOT NULL CHECK (movement_type IN ('paid_out','cash_in')),
  category        TEXT,                     -- owner_draw/cash_drop/supplier/petty_cash/refund/other/note
  notes           TEXT,
  tender_currency TEXT NOT NULL,
  tender_rate     REAL,
  user_id         TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale    ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_sale      ON payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer  ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_movements_variant  ON stock_movements(variant_id);
CREATE INDEX IF NOT EXISTS idx_movements_review   ON stock_movements(needs_review) WHERE needs_review = 1;
CREATE INDEX IF NOT EXISTS idx_sales_customer     ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_created      ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_variants_model     ON shoe_variants(model_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_created  ON purchases(created_at);
