# Haushalt-App (iPhone-Web-App)

Einkaufsliste mit lernenden Vorschlägen, Haushaltsaufgaben mit Intervallen und Ampel, Ordnungs-Score 0–100.
Mehrere iPhones arbeiten live an denselben Daten (Firebase Firestore, kostenloser Spark-Tarif reicht).

## Schritt 1: Firebase einrichten (einmalig, ca. 10 Minuten)

1. https://console.firebase.google.com öffnen, mit Google-Konto anmelden, **Projekt hinzufügen** (Analytics kann aus bleiben).
2. **Build → Authentication → Los geht's → Anmeldemethode → „Anonym“ aktivieren**.
3. **Build → Firestore Database → Datenbank erstellen** (Produktionsmodus, Standort z. B. `eur3` / Europa).
4. Reiter **Regeln** öffnen, alles ersetzen durch das Folgende und **Veröffentlichen**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /households/{haushalt}/{alles=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

5. **Projekteinstellungen (Zahnrad) → Allgemein → Deine Apps → Web (`</>`)**: App registrieren, die angezeigte `firebaseConfig` kopieren und in `firebase-config.js` eintragen.

## Schritt 2: Auf GitHub hochladen

1. Neues Repository anlegen (z. B. `haushalt`).
2. Alle Dateien dieses Ordners hochladen (Add file → Upload files): `index.html`, `style.css`, `app.js`, `firebase-config.js`, `sw.js`, `manifest.json`, drei PNG-Icons, `README.md`.
3. **Settings → Pages → Branch: `main`, Ordner `/ (root)` → Save**.
4. Nach ca. 1 Minute ist die App unter `https://DEINNAME.github.io/haushalt/` erreichbar.

## Schritt 3: Aufs iPhone

1. Link in **Safari** öffnen → Teilen-Symbol → **Zum Home-Bildschirm**.
2. Beim ersten Start **„Neuen Haushalt erstellen“**. Der Code steht unter ⚙︎ (oben rechts).
3. Auf dem zweiten iPhone dieselbe Seite öffnen, **„Mit Code beitreten“**.

## Hinweise

- **Zugriffsschutz:** Der 12-stellige Haushaltscode ist das „Passwort“. Wer ihn kennt, sieht die Daten – nur an Vertraute weitergeben.
- **Offline:** Änderungen ohne Netz werden gespeichert und automatisch synchronisiert, sobald wieder Internet da ist.
- **Firebase-Config im Repo:** Der Web-API-Key ist kein Geheimnis, der Schutz kommt von den Regeln aus Schritt 1.
- **Score:** Pro Aufgabe grün (<75 % des Intervalls vergangen) = 100, gelb (75–100 %) = 100→50, rot (überfällig) = 50→0, bei doppelter Intervallzeit 0. Der Gesamtscore ist der Durchschnitt.
- **Updates:** Dateien auf GitHub ersetzen, App auf dem iPhone einmal schließen und neu öffnen.
