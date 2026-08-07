-- Doppelbewerbungen (Doppelklick / Doppel-Absenden) verhindern,
-- echte Wiederbewerbungen nach 60 Tagen aber weiterhin erlauben.
--
-- Der strenge Index applications_tenant_email_unique aus
-- 20260817000000 konnte nicht angelegt werden, weil es historische
-- Mehrfachbewerbungen gibt. Statt dessen: Eindeutigkeit pro
-- 60-Tage-Bucket (immutable Ausdruck, daher indexierbar).

DROP INDEX IF EXISTS public.applications_tenant_email_unique;

CREATE UNIQUE INDEX IF NOT EXISTS applications_tenant_email_unique
  ON public.applications (
    tenant_id,
    lower(email),
    (floor(extract(epoch FROM created_at) / (60 * 86400)))
  )
  WHERE tenant_id IS NOT NULL AND is_test IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
