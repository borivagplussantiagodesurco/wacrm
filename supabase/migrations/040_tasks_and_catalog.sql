-- ============================================================
-- TAREAS + CATÁLOGO DE PRODUCTOS
-- ============================================================
-- Tareas/recordatorios ligados a un contacto, conversación o negocio.
-- Catálogo simple de productos/packs para cotizar y vincular a negocios.
-- Mismo patrón de RLS que el resto del esquema (017): lectura para
-- cualquier miembro de la cuenta, escritura según rol.

CREATE TABLE IF NOT EXISTS crm_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) > 0),
  notes TEXT,
  due_at TIMESTAMPTZ,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_account_open
  ON crm_tasks(account_id, due_at) WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_tasks_contact ON crm_tasks(contact_id);

ALTER TABLE crm_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_tasks_select ON crm_tasks;
DROP POLICY IF EXISTS crm_tasks_insert ON crm_tasks;
DROP POLICY IF EXISTS crm_tasks_update ON crm_tasks;
DROP POLICY IF EXISTS crm_tasks_delete ON crm_tasks;
CREATE POLICY crm_tasks_select ON crm_tasks FOR SELECT USING (is_account_member(account_id));
CREATE POLICY crm_tasks_insert ON crm_tasks FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY crm_tasks_update ON crm_tasks FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY crm_tasks_delete ON crm_tasks FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON crm_tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS catalog_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) > 0),
  sku TEXT,
  description TEXT,
  price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  -- NULL = no se controla stock.
  stock INTEGER CHECK (stock IS NULL OR stock >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_products_account_sku
  ON catalog_products(account_id, lower(sku)) WHERE sku IS NOT NULL AND sku <> '';
CREATE INDEX IF NOT EXISTS idx_catalog_products_account ON catalog_products(account_id, active);

ALTER TABLE catalog_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_products_select ON catalog_products;
DROP POLICY IF EXISTS catalog_products_insert ON catalog_products;
DROP POLICY IF EXISTS catalog_products_update ON catalog_products;
DROP POLICY IF EXISTS catalog_products_delete ON catalog_products;
CREATE POLICY catalog_products_select ON catalog_products FOR SELECT USING (is_account_member(account_id));
CREATE POLICY catalog_products_insert ON catalog_products FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY catalog_products_update ON catalog_products FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY catalog_products_delete ON catalog_products FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON catalog_products;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON catalog_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Producto asociado al negocio (opcional) para saber qué se está vendiendo.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS product_id UUID
  REFERENCES catalog_products(id) ON DELETE SET NULL;
