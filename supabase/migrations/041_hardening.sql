-- ============================================================
-- ENDURECIMIENTO (auditoría 2026-10-24)
-- Idempotente y sin borrar datos. Se puede volver a ejecutar.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Funciones SECURITY DEFINER que no deben ser llamables desde el
--    navegador. En Supabase, REVOKE ... FROM PUBLIC no alcanza: los
--    privilegios por defecto dan EXECUTE directo a anon/authenticated.
--    Todas se usan solo con el cliente service-role o desde triggers
--    (que son DEFINER y corren como propietario), así que no se rompe nada.
-- ------------------------------------------------------------
DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.record_webhook_failure(uuid, integer)',
    'public.claim_ai_reply_slot(uuid, integer)',
    'public._bcast_bump(uuid, text, integer)',
    'public.recompute_broadcast_counts(uuid)',
    'public.merge_duplicate_contacts()',
    'public.merge_duplicate_conversations()'
  ] LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'función no encontrada, se omite: %', f;
    END;
  END LOOP;

  -- touch_presence la usa el navegador (authenticated) pero nunca anon.
  BEGIN
    REVOKE ALL ON FUNCTION public.touch_presence(text) FROM anon;
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE 'touch_presence no encontrada, se omite';
  END;
END $$;

-- ------------------------------------------------------------
-- 2) Las claves foráneas no pasan por RLS: sin esto, una tarea o un negocio
--    de la cuenta A podría apuntar a filas de la cuenta B. Se valida que el
--    padre pertenezca a la MISMA cuenta.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_tasks_same_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contacts c WHERE c.id = NEW.contact_id AND c.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'contact_id no pertenece a la cuenta' USING ERRCODE = '23514';
  END IF;
  IF NEW.conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM conversations c WHERE c.id = NEW.conversation_id AND c.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'conversation_id no pertenece a la cuenta' USING ERRCODE = '23514';
  END IF;
  IF NEW.deal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM deals d WHERE d.id = NEW.deal_id AND d.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'deal_id no pertenece a la cuenta' USING ERRCODE = '23514';
  END IF;
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.user_id = NEW.assigned_to AND p.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'assigned_to no es miembro de la cuenta' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_tasks_same_account ON crm_tasks;
CREATE TRIGGER crm_tasks_same_account
  BEFORE INSERT OR UPDATE OF account_id, contact_id, conversation_id, deal_id, assigned_to
  ON crm_tasks
  FOR EACH ROW EXECUTE FUNCTION public.crm_tasks_same_account();

CREATE OR REPLACE FUNCTION public.deals_product_same_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM catalog_products p WHERE p.id = NEW.product_id AND p.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'product_id no pertenece a la cuenta' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_product_same_account ON deals;
CREATE TRIGGER deals_product_same_account
  BEFORE INSERT OR UPDATE OF product_id, account_id
  ON deals
  FOR EACH ROW EXECUTE FUNCTION public.deals_product_same_account();

-- ------------------------------------------------------------
-- 3) Políticas de UPDATE explícitas (WITH CHECK) para que nadie pueda mover
--    una fila a otra cuenta cambiando account_id.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS crm_tasks_update ON crm_tasks;
CREATE POLICY crm_tasks_update ON crm_tasks FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS catalog_products_update ON catalog_products;
CREATE POLICY catalog_products_update ON catalog_products FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- 4) Índices que faltaban (borrados con ON DELETE SET NULL y lecturas del hilo).
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_crm_tasks_conversation ON crm_tasks(conversation_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_deal ON crm_tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_assigned ON crm_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_deals_product ON deals(product_id);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_deals_conversation ON deals(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
