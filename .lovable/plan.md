# Neue Vermittlungs-Vorlage: „Noir" (Executive Black)

Eine zusätzliche Landing-Vorlage im Generator — Premium Executive Search statt klassischer Jobbörse. Die bestehende Vermittlungslogik bleibt unangetastet: gleicher Bewerbungsflow, gleiches Bewerbungs-Modal, gleiche Partnerfirmen-Weiterleitung, gleiche Calendly-Anbindung. Es kommt ausschließlich eine neue Optik dazu.

## Was neu entsteht

Ein Theme `theme-noir-executive`, im Generator sichtbar als **Noir** in der Kategorie *Vermittlung*.

Aufbau der Seite:

1. **Header** – links Wortmarke „VERMITTLUNG", Mitte die Navigation (Für Bewerber, Für Unternehmen, Über uns, Vermittlung, FAQ, Kontakt), rechts ein deutlich abgesetzter Button „Jetzt bewerben". Der Header wird beim Scrollen kompakter. Mobil ein reduziertes Overlay-Menü, der Bewerben-Button bleibt sichtbar.
2. **Hero** – dunkle Bühne, sehr große Headline „Menschen. Möglichkeiten. Perspektiven.", Subheadline, primärer CTA „Jetzt bewerben", sekundär „Unsere Vermittlung". Rechts ein cinematisches, angeschnittenes Business-Bild mit weichem Verlauf.
3. **Trust** – „Persönlich. Gezielter. Professioneller." mit vier kurzen Aussagen, ohne erfundene Zahlen.
4. **Vermittlung** – die fünf Schritte 01 Bewerbung, 02 Profil, 03 Matching, 04 Vermittlung, 05 Nächster Schritt als vertikale Zeitachse mit Linie, die beim Scrollen mitwächst.
5. **Für Bewerber** – „Nicht irgendeine Position. Die richtige." mit fünf Punkten und CTA.
6. **Für Unternehmen** – „Talente gezielt erreichen." mit Bild eines modernen Unternehmensumfelds.
7. **Brand Statement** – bildschirmfüllende, rein typografische Sektion: „THE RIGHT CONNECTION CHANGES THE NEXT STEP."
8. **Über uns** – wenig Text, starke Typografie, ein hochwertiges Portrait/Team-Bild.
9. **FAQ** – elegantes Accordion mit dünnen Trennlinien.
10. **Abschluss-CTA** – „Ihr nächster Schritt beginnt hier." mit großem Button.
11. **Footer** – minimalistisch, mit Kontakt, Impressum und Datenschutz.

## Gestaltung

- Farbwelt: tiefes Schwarz (#0A0A0A), Anthrazit (#151515), Off-White (#F2EFEA), warmer Akzent in gedecktem Bronze (#B08D57), sparsam eingesetzt als Haarlinie, Zahl oder Unterstrich — keine Goldverläufe.
- Typografie: eine ruhige Serif für Headlines, eine präzise Grotesk für Fließtext; sehr große Schriftgrade, enge Zeilenabstände, weite Buchstabenabstände bei Labels.
- Viel Weißraum bzw. Schwarzraum, dünne Linien statt Karten, keine Schatten-Boxen.
- Animation: langsame Fade-ins beim Scrollen, zeilenweiser Typografie-Reveal in Hero und Brand Statement, sehr dezente Parallax-Bewegung der Bilder, ruhige Hover-States mit unterfahrender Linie. Alles respektiert „reduzierte Bewegung" im Betriebssystem.
- Vollständig responsiv; auf dem Handy klebt zusätzlich ein schmaler Bewerben-Balken am unteren Rand.

## Bilder

Vier KI-generierte Motive im Stil einer internationalen Kampagne, dunkel und filmisch belichtet:
Hero (Führungskraft in moderner Architektur), Unternehmen (Besprechungssituation), Über uns (Team-/Portraitszene), Textur (Architekturdetail für das Brand Statement). Keine weißen Studio-Gruppenbilder.

## Bewerbungsflow

Alle „Jetzt bewerben"-Elemente verweisen wie in allen Vorlagen auf `#bewerbung-form`. Damit greift automatisch das vorhandene Bewerbungs-Modal mit dem echten Formular, der bestehenden Absendelogik und der Weiterleitung zu Calendly. Es wird nichts am Formular selbst geändert; das Modal bekommt lediglich eine passende dunkle Variante, damit es nicht als weißer Fremdkörper aufspringt.

## Technische Umsetzung

- Neuer Ordner `src/landing-themes/theme-noir-executive/` mit `template.html`, `style.css`, `script.js`, `meta.json` und `assets/`.
- Eigene Formular-Variante `src/landing-themes/_shared/form-section-noir.html` und `.css` im dunklen Look; Registrierung in `pickFormAssets`.
- Registrierung in `src/lib/landing-themes.ts`: Raw-Imports, Eintrag in `THEMES`, `THEME_FLOW` auf `"broker"`, Anzeigename „Noir" in `THEME_DISPLAY`.
- Bilder als generierte JPGs unter `assets/`; sie werden vom bestehenden Asset-Mechanismus in ZIP-Export und Landing-Server ausgeliefert.
- Slots in `meta.json` für alle Texte, Bilder, Kontaktdaten und SEO-Felder, damit im Generator alles editierbar bleibt.
