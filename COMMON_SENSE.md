# MemeLab – Common Sense Coding Rules

## Zweck

Diese Regeln sichern die bestehende Funktionalität von MemeLab bei jeder Codeänderung. Sie gelten für kleine Änderungen genauso wie für größere Erweiterungen.

## 1. Erst verstehen, dann ändern

- Vor einer Änderung den betroffenen Code und seine Abhängigkeiten prüfen.
- Bestehende Daten-, Kontroll- und Initialisierungsflüsse nachvollziehen.
- Keine Änderung auf Verdacht.
- Wenn die Ursache eines Fehlers unklar ist, zuerst diagnostizieren.

## 2. Kleine, lokale Änderungen

- Nur die Dateien und Codebereiche ändern, die für die Aufgabe erforderlich sind.
- Bestehende funktionierende Logik nicht unnötig refactoren.
- Bestehende Funktionen nicht ersetzen, wenn eine Ergänzung ausreicht.
- Keine parallelen Verbesserungen in einem gezielten Bugfix.

## 3. Nach jeder Änderung prüfen

Jede Codeänderung wird vor dem Commit geprüft.

### Python
- Syntaxprüfung durchführen.
- Relevante Module importieren bzw. Startpfad prüfen.
- Betroffene Runtime-Funktion testen.

### JavaScript
- Syntaxprüfung durchführen.
- Anwendung bzw. betroffenen Runtime-Pfad ausführen.
- Browser-/Console-Fehler prüfen.

### HTML/CSS
- Parsing bzw. Struktur prüfen.
- Prüfen, dass erwartete IDs und Elemente vorhanden sind.

## 4. Runtime ist wichtiger als Syntax

Ein erfolgreicher Syntaxcheck bedeutet nicht, dass die Anwendung funktioniert.

Nach Änderungen an zentralem Code muss geprüft werden, ob:
- die Anwendung startet,
- Daten geladen werden,
- Initialisierung vollständig durchläuft,
- betroffene UI-Bereiche gerendert werden,
- keine neuen Runtime-Fehler auftreten.

## 5. Regression vermeiden

Bei Änderungen an zentralen Dateien müssen angrenzende Funktionen mitgeprüft werden.

Insbesondere bei zentralen Integrationsdateien wie `jupiter-live.js` darf nicht nur die unmittelbar geänderte Funktion getestet werden.

## 6. Datenfluss nicht unbeabsichtigt verändern

Bei Änderungen an Engine, Watchlist, Lifecycle oder Paper Trading ist der bestehende Datenfluss zu erhalten:

Jupiter Feed → Token Universe → Lifecycle → Engine Candidates → MEMELAB_ENGINE → Paper Trading

Eine Änderung an einem Glied darf die anderen Bereiche nicht unbeabsichtigt leeren oder deaktivieren.

## 7. Keine ungeprüften Commits

Ein Commit gilt erst als bereit, wenn:
- Syntax OK
- Runtime/Start OK
- betroffene Funktion OK
- relevante Regressionstests OK

## 8. Änderungen nachvollziehbar halten

- Commit-Nachricht beschreibt die tatsächliche Änderung.
- Keine unnötigen Dateien im Commit.
- Nach dem Commit SHA und Prüfergebnis festhalten.

## 9. Bei Unsicherheit stoppen

Wenn ein Test fehlschlägt oder die Ursache nicht eindeutig ist:
- nicht weiter auf Verdacht ändern,
- Fehler eingrenzen,
- letzten funktionierenden Stand erhalten,
- erst danach den nächsten Fix durchführen.

## 10. Grundregel

**Code ändern ist nicht gleich Problem gelöst.**

Eine Änderung gilt erst dann als erfolgreich, wenn das erwartete Verhalten nachweislich verifiziert wurde.
