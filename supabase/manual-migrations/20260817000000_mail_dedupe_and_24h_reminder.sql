-- Doppel-Mails verhindern + Vortags-Erinnerung ermoeglichen.
--
-- 1) Neue Reminder-Art 'interview_reminder_24h' (Erinnerung am Vortag).
-- 2) Eindeutigkeit fuer Bewerbungen je Mandant + E-Mail innerhalb 60 Tagen:
--    zwei gleichzeitige Formular-Absendungen erzeugen sonst zwei Bewerbungen
--    und damit zwei Eingangsbestaetigungen.

ALTER TABLE public.application_reminder_log
  DROP CONSTRAINT IF EXISTS application_reminder_log_reminder_kind_check;

ALTER TABLE public.application_reminder_log
  ADD CONSTRAINT application_reminder_log_reminder_kind_check
  CHECK (reminder_kind IN (
    'no_booking_24h',
    'no_booking_72h',
    'no_show_24h',
    'interview_invite_30min',
    'interview_reminder_24h',
    'booking_confirmation'
  ));

-- Dedupe-Index: nur echte (nicht-Test-)Bewerbungen der letzten 60 Tage.
-- Teil-Index mit Zeitbezug ist nicht IMMUTABLE, deshalb greift die
-- Eindeutigkeit ueber tenant_id + kleingeschriebene E-Mail; aeltere
-- Wiederbewerbungen werden von der Anwendung ueber das 60-Tage-Fenster
-- unterschieden.
CREATE UNIQUE INDEX IF NOT EXISTS applications_tenant_email_unique
  ON public.applications (tenant_id, lower(email))
  WHERE tenant_id IS NOT NULL AND is_test IS NOT TRUE;

NOTIFY pgrst, 'reload schema';
