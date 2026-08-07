# Zusage-Link auf die Fast-Track-Seite korrigieren

## Was der Screenshot zeigt
Die Zusage-Mail ("Willkommen im Team") kam von der Vermittlung (MuS Marketing), und der Button "Jetzt registrieren" führt auf eine Adresse, die es nicht gibt.

## Ursache (im Code nachgelesen, Datenwerte noch nicht geprüft)
Der Registrierungslink wird in `src/lib/interview-engine.server.ts` in `resolvePortalBase()` gebaut:

1. `applications.target_landing_id` -> `landing_pages.domain`
2. sonst `applications.tenant_id` -> `tenants.primary_domain/domain`
3. sonst Origin des aktuellen Requests

Ergebnis ist immer `https://portal.<domain>/register?token=...`.

Der Absender wird dagegen über einen anderen, deutlich robusteren Weg bestimmt (`supabase/functions/_shared/sender-resolver.ts`): dort läuft die Fast-Track-Seite über `applications.fasttrack_tenant_id`, ersatzweise `target_landing_id`, ersatzweise `source_landing_id -> linked_fasttrack_landing_id` — und fällt bewusst NICHT auf `applications.tenant_id` (= Vermittlung) zurück.

Fehlt `target_landing_id`, greift beim Link also Stufe 2 und es entsteht `portal.<Vermittlungs-Domain>` — eine Domain, die für das Mitarbeiter-Portal nicht existiert. Das passt zum Screenshot. Dieselbe fehlerhafte Ableitung steckt auch in `supabase/functions/process-invite-resend-queue/index.ts` (`portal.${t.primary_domain ?? t.domain}`).

Erster Schritt bei der Umsetzung: an der betroffenen Bewerbung prüfen, welche dieser Felder gesetzt sind, damit die Diagnose bestätigt ist, bevor umgebaut wird.

## Umbau

1. **Eine einzige Quelle für die Portal-Basis**
   Neue Funktion `resolveFasttrackPortalBase(applicationId)` in einem gemeinsamen Server-Modul, die exakt der Fast-Track-Kette des Sender-Resolvers folgt:
   `fasttrack_tenant_id` -> `target_landing_id` (nur wenn `flow_type != 'broker'`) -> `source_landing_id.linked_fasttrack_landing_id` -> Fehler.
   Kein Fallback mehr auf `applications.tenant_id` und keiner auf den Request-Origin.

2. **Kein Raten der Subdomain**
   Statt hart `portal.<domain>` zu bauen, wird die Portal-URL aus der Fast-Track-Landingpage bzw. deren Tenant übernommen (`primary_domain`/`domain`); das `portal.`-Präfix wird nur ergänzt, wenn die Domain noch keine eigene Subdomain hat.

3. **Lieber keine Mail als eine kaputte**
   Lässt sich keine Fast-Track-Portal-Domain bestimmen, wird die Zusage-Mail nicht mit falschem Link verschickt, sondern als `skipped` mit Grund `missing_fasttrack_portal` protokolliert und in Admin -> Bewerbungen sichtbar gemacht, inklusive Button für den manuellen Nachversand nach Korrektur.

4. **Betroffene Stellen mitziehen**
   `interview-engine.server.ts` (`resolvePortalBase`, `buildRegistrationLink`, `getExistingRegistrationLink`), `process-invite-resend-queue` sowie der Fallback-Link im Zusage-Screen (`src/routes/interview.$appId.tsx`, `interview.voice.$appId.tsx`).

5. **Sichtbarkeit im Admin**
   Im Landing-Generator pro Fast-Track-Seite die resultierende Portal-URL anzeigen und pro Vermittlungs-Seite, mit welcher Fast-Track-Seite sie verknüpft ist. Fehlt die Verknüpfung, deutliche Warnung — das ist die eigentliche Fehlerquelle.

6. **Bereits verschickte kaputte Links reparieren**
   Skript `scripts/fix-registration-links.sh`, das Zusagen der letzten Tage findet, deren Link auf eine Nicht-Fast-Track-Domain zeigt, und die Zusage-Mail einmalig mit korrektem Link erneut versendet (Dry-Run als Standard, damit kein Spam entsteht).

## Zur Rückfrage "Landingpage-Texte"
Die Texte auf euren Bewerber-Seiten stehen nicht im Quellcode, sondern als Inhalt pro Landingpage in der Datenbank (Admin -> Landing-Generator: Überschrift, Fließtext, Ablaufbeschreibung, Kontaktperson usw.). Ich kann Code-Vorlagen ändern, aber nicht die Texte, die ihr dort eingepflegt habt — die sehe ich hier nicht. Deshalb: schickt mir den aktuellen Text einer Seite (oder deren URL), dann formuliere ich ihn passend zum Ablauf Bewerbung -> Online-Interview zur gebuchten Uhrzeit -> Zusage -> Registrierung im Mitarbeiter-Portal um.

## Was zuletzt gemacht wurde
- Interview-Link steckt jetzt direkt in der Terminbestätigung, dauerhaft gültig
- Bestätigungsmail sagt ausdrücklich: Online-Interview, kein Anruf, Start per Button
- 4-Schritte-Ablauf in Mail und Buchungsseite
- Retry-Queue für fehlgeschlagene Mails, Entdopplung, SMTP-Diagnose, No-Show-Analyse

## Weitere Conversion-Ideen (nach dem Fix)
- **Zusage-Mail messbar machen:** Klicks auf "Jetzt registrieren" zählen, damit sichtbar wird, ob Zustellung oder Text das Problem ist
- **Registrierung ohne Link:** auf der Portal-Startseite ein Feld "Zusage erhalten? E-Mail eingeben" als Rettungsanker für verlorene Links
- **Nachfass nach Zusage:** 24 h und 72 h nach Zusage ohne Registrierung eine kurze Erinnerung mit demselben Link
- **Interview-Seite mit Aufwandsangabe:** "ca. 8 Minuten, jetzt starten" statt reinem Termin-Wording
- **Zusage direkt abschließen:** Registrierung optional sofort auf dem Zusage-Screen starten, statt nur auf die Mail zu verweisen