// =====================================================================
//  Haushalt-App – Einkaufsliste + Aufgaben mit Ampel + Ordnungs-Score
//  Aufbau (objektorientiert):
//    Session          – Haushaltscode auf dem Gerät speichern
//    Repository       – alle Datenbankzugriffe (Firebase Firestore)
//    ScoreCalculator  – Ampel- und Score-Berechnung
//    Modal            – Dialog von unten
//    Toast            – kurze Hinweismeldung
//    ShoppingView     – Einkaufsliste inkl. Vorschläge und Gruppen
//    TasksView        – Aufgaben, Ampel, Score
//    App              – setzt alles zusammen
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, increment, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const DAY = 86400000; // Millisekunden pro Tag

// ---------- kleine Hilfsfunktion zum Bauen von HTML-Elementen ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

// =====================================================================
//  Icons: schlichte Linien-Symbole als SVG (statt Emojis)
// =====================================================================
class Icons {
  static PATHS = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
    tasks: '<path d="M9.5 6H20M9.5 12H20M9.5 18H20"/><path d="m3.5 6 1.3 1.3L7 4.8M3.5 12l1.3 1.3L7 10.8M3.5 18l1.3 1.3L7 16.8"/>',
    cart: '<circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/><path d="M2.5 3.5h3l2.4 11.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20.5 8H6"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    edit: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="m13.5 8.5 3 3"/>'
  };
  // Liefert ein fertiges Element, Farbe folgt der Textfarbe (currentColor)
  static get(name, size = 22) {
    const el = document.createElement("span");
    el.className = "icon";
    el.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${Icons.PATHS[name]}</svg>`;
    return el;
  }
}

// =====================================================================
//  Session: Haushaltscode (wer denselben Code hat, teilt dieselben Daten)
// =====================================================================
class Session {
  static KEY = "haushalt-code";
  static get() { return localStorage.getItem(Session.KEY); }
  static set(code) { localStorage.setItem(Session.KEY, code); }
  static clear() { localStorage.removeItem(Session.KEY); }

  // Neuer zufälliger Code, 12 Zeichen (ohne verwechselbare Zeichen wie 0/O, 1/I)
  static generate() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(bytes, (b) => abc[b % abc.length]).join("");
  }
  // Eingabe säubern: Großbuchstaben, ohne Leerzeichen/Bindestriche
  static normalize(text) { return text.toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  // Anzeige: XXXX-XXXX-XXXX
  static format(code) { return code.match(/.{1,4}/g).join("-"); }
}

// =====================================================================
//  Repository: Datenbankzugriff. Pfad: households/{code}/{items|suggestions|groups|tasks}
//  Schreibvorgänge werden nicht abgewartet, damit die App auch offline flüssig bleibt –
//  Firestore sendet sie automatisch, sobald wieder Netz da ist.
// =====================================================================
class Repository {
  constructor(db, code) {
    this.db = db;
    this.code = code;
    this.unsubscribers = [];
  }
  col(name) { return collection(this.db, "households", this.code, name); }
  ref(name, id) { return doc(this.db, "households", this.code, name, id); }
  // Fehler sichtbar machen: App setzt hier eine Funktion, die ein rotes Banner zeigt
  static onError = null;
  static report(text, err) {
    console.error(text, err);
    Repository.onError?.(`${text} ${err?.code || ""} ${err?.message || ""}`.trim());
  }

  fire(promise) { promise.catch((e) => Repository.report("Speichern fehlgeschlagen:", e)); }

  // Live-Abo: callback(liste, ausCache) wird bei jeder Änderung (auch von anderen iPhones) aufgerufen.
  // ausCache = true: noch nicht vom Server bestätigt (frisch geöffnet oder offline)
  listen(name, callback) {
    const stop = onSnapshot(this.col(name), { includeMetadataChanges: true }, (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })), snap.metadata.fromCache);
    }, (err) => Repository.report("Lesefehler:", err));
    this.unsubscribers.push(stop);
  }
  stop() { this.unsubscribers.forEach((s) => s()); this.unsubscribers = []; }

  // --- Einkaufsliste ---
  static suggestionKey(name) { return name.trim().toLowerCase().replace(/[\/\s]+/g, "_").slice(0, 100); }
  addItem(name) {
    this.fire(addDoc(this.col("items"), { name, done: false, createdAt: Date.now() }));
    // Vorschlagsliste lernen: Zähler +1, damit häufige Artikel oben stehen
    this.fire(setDoc(this.ref("suggestions", Repository.suggestionKey(name)),
      { name, count: increment(1) }, { merge: true }));
  }
  setItemDone(id, done) { this.fire(updateDoc(this.ref("items", id), { done })); }
  deleteItem(id) { this.fire(deleteDoc(this.ref("items", id))); }
  renameItem(id, name) { this.fire(updateDoc(this.ref("items", id), { name })); }
  clearDone(ids) {
    const batch = writeBatch(this.db);
    ids.forEach((id) => batch.delete(this.ref("items", id)));
    this.fire(batch.commit());
  }

  // --- Aufgaben ---
  addTask(data) { this.fire(addDoc(this.col("tasks"), { ...data, createdAt: Date.now() })); }
  updateTask(id, data) { this.fire(updateDoc(this.ref("tasks", id), data)); }
  completeTask(id) { this.fire(updateDoc(this.ref("tasks", id), { lastDone: Date.now() })); }
  deleteTask(id) { this.fire(deleteDoc(this.ref("tasks", id))); }

  // --- Gruppen (z. B. "Essentials"): { name, items: [Produktnamen] } ---
  addGroup(data) { this.fire(addDoc(this.col("groups"), { ...data, createdAt: Date.now() })); }
  updateGroup(id, data) { this.fire(updateDoc(this.ref("groups", id), data)); }
  deleteGroup(id) { this.fire(deleteDoc(this.ref("groups", id))); }
}

// =====================================================================
//  ScoreCalculator: Ampel & Score
//  Verhältnis = vergangene Zeit / Intervall
//    < 75 %   -> grün  (Aufgabenscore 100)
//    75–100 % -> gelb  (Aufgabenscore 100 -> 50)
//    > 100 %  -> rot   (Aufgabenscore 50 -> 0, bei doppelter Intervallzeit = 0)
//  Gesamtscore = Durchschnitt aller Aufgaben
// =====================================================================
class ScoreCalculator {
  static UNITS = {
    tage: { days: 1, one: "Tag", many: "Tage" },
    wochen: { days: 7, one: "Woche", many: "Wochen" },
    monate: { days: 30, one: "Monat", many: "Monate" }
  };

  static intervalDays(task) { return task.intervalValue * ScoreCalculator.UNITS[task.intervalUnit].days; }
  static ratio(task, now) { return (now - task.lastDone) / (ScoreCalculator.intervalDays(task) * DAY); }

  static state(ratio) { return ratio < 0.75 ? "green" : ratio < 1 ? "yellow" : "red"; }

  static taskScore(ratio) {
    if (ratio < 0.75) return 100;
    if (ratio < 1) return 100 - ((ratio - 0.75) / 0.25) * 50;
    if (ratio < 2) return 50 - (ratio - 1) * 50;
    return 0;
  }

  static overall(tasks, now) {
    if (!tasks.length) return null;
    const sum = tasks.reduce((s, t) => s + ScoreCalculator.taskScore(ScoreCalculator.ratio(t, now)), 0);
    return Math.round(sum / tasks.length);
  }

  static label(score) {
    if (score >= 85) return "Top gepflegt";
    if (score >= 60) return "Ordentlich";
    if (score >= 35) return "Es wird Zeit";
    return "Chaos-Alarm";
  }
  static scoreColor(score) { return score >= 75 ? "var(--green)" : score >= 45 ? "var(--yellow)" : "var(--red)"; }

  // Textbeschreibung, z. B. "in 12 Tagen fällig" / "seit 3 Tagen überfällig"
  static describe(task, now) {
    const total = ScoreCalculator.intervalDays(task) * DAY;
    const left = total - (now - task.lastDone);
    if (left > 0) {
      const d = Math.ceil(left / DAY);
      return d === 1 ? "morgen fällig" : `in ${d} Tagen fällig`;
    }
    const over = Math.floor(-left / DAY);
    return over === 0 ? "heute fällig" : over === 1 ? "seit 1 Tag überfällig" : `seit ${over} Tagen überfällig`;
  }
  static intervalText(task) {
    const u = ScoreCalculator.UNITS[task.intervalUnit];
    return `alle ${task.intervalValue} ${task.intervalValue === 1 ? u.one : u.many}`;
  }
}

// =====================================================================
//  Modal: Dialog, der von unten hochfährt
// =====================================================================
class Modal {
  static open(...content) {
    Modal.close();
    document.getElementById("toast")?.classList.remove("show"); // Hinweis nicht über dem Dialog stehen lassen
    const sheet = h("div", { class: "sheet" });
    const overlay = h("div", { class: "overlay", id: "modal", onclick: (e) => { if (e.target === overlay) Modal.close(); } }, sheet);
    sheet.append(Modal.grabber(sheet, overlay), ...content);
    document.body.append(overlay);
  }
  static close() { document.getElementById("modal")?.remove(); }

  // Griff oben am Dialog: nach unten ziehen (oder antippen) schließt das Fenster,
  // bei zu kurzem Ziehen springt es zurück
  static grabber(sheet, overlay) {
    const grab = h("div", { class: "grabber", role: "button", "aria-label": "Schließen" });
    let startY = null, dy = 0;

    grab.addEventListener("pointerdown", (e) => {
      startY = e.clientY; dy = 0;
      grab.setPointerCapture(e.pointerId);
      sheet.style.transition = "none";
    });
    grab.addEventListener("pointermove", (e) => {
      if (startY === null) return;
      dy = Math.max(0, e.clientY - startY); // nur nach unten
      sheet.style.transform = `translateY(${dy}px)`;
    });
    const finish = (cancelled) => {
      if (startY === null) return;
      startY = null;
      sheet.style.transition = "transform .2s ease";
      if (!cancelled && (dy > 80 || dy < 4)) { // weit gezogen oder nur angetippt -> schließen
        sheet.style.transform = "translateY(110%)";
        setTimeout(() => overlay.remove(), 180);
      } else {
        sheet.style.transform = ""; // zurückfedern
      }
    };
    grab.addEventListener("pointerup", () => finish(false));
    grab.addEventListener("pointercancel", () => finish(true));
    return grab;
  }
}

// =====================================================================
//  Toast: kurze Hinweismeldung über der Tab-Leiste
// =====================================================================
class Toast {
  static timer = null;
  static show(text) {
    let el = document.getElementById("toast");
    if (!el) { el = h("div", { class: "toast", id: "toast" }); document.body.append(el); }
    el.textContent = text;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(Toast.timer);
    Toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
  }
}

// =====================================================================
//  ShoppingView: Einkaufsliste mit lernenden Vorschlägen und Gruppen
// =====================================================================
class ShoppingView {
  constructor(repo) {
    this.repo = repo;
    this.items = [];
    this.suggestions = [];
    this.groups = [];
    this.loaded = { items: false, suggestions: false }; // Daten schon eingetroffen?
    this.queue = [];                                    // wartende Aktionen (z. B. Schnell-Hinzufügen)

    this.input = h("input", { type: "text", placeholder: "Was wird gebraucht?", autocomplete: "off", autocapitalize: "sentences", enterkeyhint: "done" });
    this.input.addEventListener("input", () => this.renderChips());
    this.chipBox = h("div", { class: "chips" });
    this.chipTitle = h("div", { class: "section-title" });
    this.listBox = h("div", { class: "card" });
    this.groupBox = h("div", { class: "chips" });
    this.groupHead = h("div", { class: "section-head" },
      h("span", { class: "section-title" }, "Gruppen"),
      this.manageBtn = h("button", { class: "link-btn hidden", onclick: () => this.openGroupManager() }, "Verwalten"));

    this.el = h("section", { class: "content" },
      h("form", { class: "add-row", onsubmit: (e) => { e.preventDefault(); this.add(this.input.value); } },
        this.input, h("button", { class: "btn primary add-btn", type: "submit", "aria-label": "Hinzufügen" }, Icons.get("plus", 22))),
      this.groupHead, this.groupBox, this.chipTitle, this.chipBox, this.listBox);

    this.render(); // sofort leeren Zustand zeigen, bis Daten eintreffen
    repo.listen("items", (list, fromCache) => {
      this.items = list;
      if (!fromCache) this.loaded.items = true; // erst jetzt ist die Liste vollständig
      this.render();
      if (this.loaded.items && this.loaded.suggestions) this.flush();
    });
    repo.listen("groups", (list) => {
      this.groups = list.sort((a, b) => a.createdAt - b.createdAt);
      this.renderGroups();
    });
    repo.listen("suggestions", (list, fromCache) => {
      this.suggestions = list;
      if (!fromCache) this.loaded.suggestions = true;
      this.renderChips();
      if (this.loaded.items && this.loaded.suggestions) this.flush();
    });

    // Antwortet der Server nicht (offline), nach 4 s trotzdem mit den lokalen Daten weiterarbeiten
    setTimeout(() => {
      this.loaded.items = this.loaded.suggestions = true;
      this.render();
      this.flush();
    }, 4000);
  }

  // Führt eine Aktion erst aus, wenn Liste und Vorschläge vom Server geladen sind
  whenLoaded(action) {
    if (this.loaded.items && this.loaded.suggestions) return action();
    this.queue.push(action);
  }
  flush() {
    const waiting = this.queue;
    this.queue = [];
    waiting.forEach((action) => action());
  }

  // Fügt einen Artikel hinzu, sofern er nicht schon offen auf der Liste steht.
  // Rückgabe: true = wirklich hinzugefügt
  addItemByName(text) {
    let name = text.trim();
    if (!name) return false;
    const key = Repository.suggestionKey(name);
    const known = this.suggestions.find((s) => s.id === key);
    if (known) name = known.name; // gelernte Schreibweise verwenden
    else name = name.charAt(0).toUpperCase() + name.slice(1);
    const open = this.items.some((i) => !i.done && Repository.suggestionKey(i.name) === key);
    if (open) return false;
    this.repo.addItem(name);
    return true;
  }

  // Eingabe aus dem Textfeld oder einem Vorschlag übernehmen
  add(text) {
    if (!text.trim()) return;
    this.addItemByName(text);
    this.input.value = "";
    this.renderChips();
    this.input.focus();
  }

  // ----- Gruppen -----

  // Alle Produkte einer Gruppe auf einmal hinzufügen (bereits offene werden übersprungen)
  addGroup(group) {
    const added = group.items.filter((name) => this.addItemByName(name)).length;
    Toast.show(added
      ? `${added} ${added === 1 ? "Produkt" : "Produkte"} aus „${group.name}“ hinzugefügt`
      : `Alles aus „${group.name}“ steht schon auf der Liste`);
  }

  // Gruppen als Schnellwahl-Knöpfe über der Liste
  renderGroups() {
    this.manageBtn.classList.toggle("hidden", !this.groups.length);
    if (!this.groups.length) { // noch keine Gruppe: Einstieg zum Anlegen anbieten
      this.groupBox.replaceChildren(h("button", { class: "chip", onclick: () => this.openGroupEditor() },
        "Gruppe anlegen, z. B. Essentials"));
      return;
    }
    this.groupBox.replaceChildren(...this.groups.map((g) =>
      h("button", { class: "chip group", onclick: () => this.addGroup(g) }, g.name, h("small", {}, String(g.items.length)))));
  }

  // Übersicht aller Gruppen zum Bearbeiten
  openGroupManager() {
    const rows = this.groups.map((g) =>
      h("button", { class: "group-row", onclick: () => this.openGroupEditor(g) },
        h("span", {}, h("strong", {}, g.name), h("small", {}, `${g.items.length} ${g.items.length === 1 ? "Produkt" : "Produkte"}`)),
        Icons.get("edit", 18)));
    Modal.open(
      h("h3", {}, "Gruppen"),
      ...(rows.length ? rows : [h("p", { class: "hint" }, "Noch keine Gruppen angelegt.")]),
      h("button", { class: "btn primary block", onclick: () => this.openGroupEditor() }, Icons.get("plus", 20), "Neue Gruppe"));
  }

  // Dialog zum Anlegen (group = undefined) oder Bearbeiten einer Gruppe
  openGroupEditor(group) {
    const items = [...(group?.items ?? [])]; // Arbeitskopie, wird erst beim Speichern übernommen
    const name = h("input", { type: "text", placeholder: "z. B. Essentials", value: group?.name ?? "", autocomplete: "off", autocapitalize: "sentences" });
    const entry = h("input", { type: "text", placeholder: "Produkt hinzufügen", autocomplete: "off", autocapitalize: "sentences", enterkeyhint: "done" });
    const list = h("div", { class: "chips" });

    // Produkte der Gruppe anzeigen; Tippen entfernt das Produkt
    const renderList = () => list.replaceChildren(...items.map((n, i) =>
      h("button", { class: "chip removable", onclick: () => { items.splice(i, 1); renderList(); } }, n, Icons.get("close", 14))));
    renderList();

    // Eingabe in die Produktliste übernehmen (ohne Doppelte, mit gelernter Schreibweise)
    const addEntry = (refocus = true) => {
      let n = entry.value.trim();
      if (!n) return;
      const key = Repository.suggestionKey(n);
      const known = this.suggestions.find((s) => s.id === key);
      n = known ? known.name : n.charAt(0).toUpperCase() + n.slice(1);
      if (!items.some((x) => Repository.suggestionKey(x) === key)) items.push(n);
      entry.value = "";
      renderList();
      if (refocus) entry.focus();
    };

    const save = () => {
      addEntry(false); // noch nicht bestätigte Eingabe nicht verlieren
      const n = name.value.trim();
      if (!n) return name.focus();
      if (!items.length) return entry.focus();
      const data = { name: n, items };
      group ? this.repo.updateGroup(group.id, data) : this.repo.addGroup(data);
      Modal.close();
    };

    Modal.open(
      h("h3", {}, group ? "Gruppe bearbeiten" : "Neue Gruppe"),
      h("div", { class: "field" }, h("label", {}, "Name"), name),
      h("div", { class: "field" }, h("label", {}, "Produkte"), list,
        h("form", { class: "inline-add", onsubmit: (e) => { e.preventDefault(); addEntry(); } },
          entry, h("button", { class: "btn soft", type: "submit", "aria-label": "Produkt hinzufügen" }, Icons.get("plus", 20)))),
      h("button", { class: "btn primary block", onclick: save }, "Speichern"),
      group && h("button", { class: "btn danger block", onclick: () => {
        if (confirm(`Gruppe „${group.name}“ wirklich löschen?`)) { this.repo.deleteGroup(group.id); Modal.close(); }
      } }, "Löschen"));
  }

  // Vorschläge: beim Tippen passende, sonst die meistgekauften
  renderChips() {
    const q = this.input.value.trim().toLowerCase();
    const openKeys = new Set(this.items.filter((i) => !i.done).map((i) => Repository.suggestionKey(i.name)));
    let list = this.suggestions.filter((s) => !openKeys.has(s.id));
    if (q) {
      list = list.filter((s) => s.name.toLowerCase().includes(q))
        .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || b.count - a.count);
    } else {
      list.sort((a, b) => b.count - a.count);
    }
    list = list.slice(0, 8);
    this.chipTitle.textContent = list.length ? (q ? "Vorschläge" : "Häufig gekauft") : "";
    this.chipBox.replaceChildren(...list.map((s) => h("button", { class: "chip", onclick: () => this.add(s.name) }, s.name)));
  }

  render() {
    const open = this.items.filter((i) => !i.done).sort((a, b) => a.createdAt - b.createdAt);
    const done = this.items.filter((i) => i.done).sort((a, b) => a.createdAt - b.createdAt);
    const rows = [...open, ...done].map((i) => this.row(i));
    this.listBox.replaceChildren(...(rows.length ? rows : [h("div", { class: "empty" }, this.loaded.items ? "Die Liste ist leer" : "Liste wird geladen …")]));
    if (done.length) {
      this.listBox.append(h("button", { class: "btn soft block", style: "margin-top:10px",
        onclick: () => this.repo.clearDone(done.map((d) => d.id)) }, `Erledigte entfernen (${done.length})`));
    }
    this.renderChips();
  }

  row(item) {
    return h("div", { class: "item" + (item.done ? " done" : "") },
      h("button", { class: "check", onclick: () => this.repo.setItemDone(item.id, !item.done) }, item.done ? Icons.get("check", 15) : null),
      h("button", { class: "label", onclick: () => this.repo.setItemDone(item.id, !item.done) }, item.name),
      h("button", { class: "del", "aria-label": "Bearbeiten", onclick: () => this.openEditor(item) }, Icons.get("edit", 18)),
      h("button", { class: "del", "aria-label": "Löschen", onclick: () => this.repo.deleteItem(item.id) }, Icons.get("close", 18)));
  }

  // Dialog zum Umbenennen eines Eintrags (leere Eingabe ändert nichts)
  openEditor(item) {
    const input = h("input", { type: "text", value: item.name, autocomplete: "off", autocapitalize: "sentences", enterkeyhint: "done" });
    const save = () => {
      let name = input.value.trim();
      if (name) {
        name = name.charAt(0).toUpperCase() + name.slice(1);
        if (name !== item.name) this.repo.renameItem(item.id, name);
      }
      Modal.close();
    };
    Modal.open(
      h("h3", {}, "Eintrag bearbeiten"),
      h("form", { class: "field", onsubmit: (e) => { e.preventDefault(); save(); } }, input),
      h("button", { class: "btn primary block", onclick: save }, "Speichern"),
      h("button", { class: "btn block", onclick: () => Modal.close() }, "Abbrechen"));
    setTimeout(() => input.focus(), 50);
  }
}

// =====================================================================
//  TasksView: Aufgaben mit Intervall, Ampel und Gesamtscore
// =====================================================================
class TasksView {
  static EXAMPLES = [
    ["Fenster putzen", 3, "monate"], ["Bad putzen", 1, "wochen"], ["Staubsaugen", 1, "wochen"],
    ["Bettwäsche wechseln", 2, "wochen"], ["Kühlschrank reinigen", 1, "monate"]
  ];

  constructor(repo) {
    this.repo = repo;
    this.tasks = [];
    this.scoreBox = h("div", { class: "card score" });
    this.listBox = h("div", { class: "content", style: "padding:0" });
    this.el = h("section", { class: "content hidden" },
      this.scoreBox, this.listBox,
      h("button", { class: "btn primary block", onclick: () => this.openEditor() }, Icons.get("plus", 20), "Aufgabe hinzufügen"));
    this.render(); // sofort Score-Bereich zeigen, bis Daten eintreffen
    repo.listen("tasks", (list) => { this.tasks = list; this.render(); });
  }

  render() {
    const now = Date.now();
    this.renderScore(now);
    const sorted = [...this.tasks].sort((a, b) => ScoreCalculator.ratio(b, now) - ScoreCalculator.ratio(a, now));
    if (!sorted.length) {
      this.listBox.replaceChildren(h("div", { class: "card empty" },
        h("p", {}, "Noch keine Aufgaben angelegt."),
        h("button", { class: "btn soft", onclick: () => this.addExamples() }, "Beispiele hinzufügen")));
      return;
    }
    this.listBox.replaceChildren(...sorted.map((t) => this.card(t, now)));
  }

  renderScore(now) {
    const score = ScoreCalculator.overall(this.tasks, now);
    const R = 52, C = 2 * Math.PI * R;
    const value = score ?? 0;
    const ring = h("div", { class: "ring" });
    ring.innerHTML = `<svg width="120" height="120" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--line)" stroke-width="12"/>
      <circle cx="60" cy="60" r="${R}" fill="none" stroke="${ScoreCalculator.scoreColor(value)}" stroke-width="12"
        stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - value / 100)}"
        style="transition: stroke-dashoffset .6s ease"/></svg>
      <div class="num">${score ?? "–"}</div>`;
    const late = this.tasks.filter((t) => ScoreCalculator.ratio(t, now) >= 1).length;
    this.scoreBox.replaceChildren(ring, h("div", {},
      h("h2", {}, score === null ? "Ordnungs-Score" : ScoreCalculator.label(score)),
      h("p", {}, score === null ? "Lege Aufgaben an, dann wird dein Score berechnet."
        : late ? `${late} ${late === 1 ? "Aufgabe ist" : "Aufgaben sind"} überfällig.` : "Alles im grünen Bereich.")));
  }

  card(task, now) {
    const ratio = ScoreCalculator.ratio(task, now);
    const state = ScoreCalculator.state(ratio);
    const width = Math.min(100, Math.round(ratio * 100));
    return h("div", { class: "card task" },
      h("div", { class: "task-top" },
        h("span", { class: "dot " + state }),
        h("button", { class: "task-name", onclick: () => this.openEditor(task) }, task.name)),
      h("div", { class: "bar" }, h("i", { class: state, style: `width:${width}%` })),
      h("div", { class: "task-info" }, `${ScoreCalculator.describe(task, now)} · ${ScoreCalculator.intervalText(task)}`),
      h("button", { class: "btn soft block", onclick: () => this.repo.completeTask(task.id) }, Icons.get("check", 18), "Erledigt"));
  }

  addExamples() {
    TasksView.EXAMPLES.forEach(([name, v, u]) =>
      this.repo.addTask({ name, intervalValue: v, intervalUnit: u, lastDone: Date.now() }));
  }

  // Dialog zum Anlegen (task = undefined) oder Bearbeiten
  openEditor(task) {
    const toInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    const today = toInput(Date.now());
    const name = h("input", { type: "text", placeholder: "z. B. Fenster putzen", value: task?.name ?? "" });
    const num = h("input", { type: "number", min: "1", max: "999", inputmode: "numeric", value: String(task?.intervalValue ?? 1) });
    const unit = h("select", {}, ...Object.entries(ScoreCalculator.UNITS).map(([k, u]) =>
      h("option", { value: k }, u.many)));
    unit.value = task?.intervalUnit ?? "wochen";
    const last = h("input", { type: "date", max: today, value: toInput(task?.lastDone ?? Date.now()) });

    const save = () => {
      const n = name.value.trim();
      const v = parseInt(num.value, 10);
      if (!n || !(v >= 1) || !last.value) return;
      const data = { name: n, intervalValue: v, intervalUnit: unit.value, lastDone: new Date(last.value + "T12:00:00").getTime() };
      task ? this.repo.updateTask(task.id, data) : this.repo.addTask(data);
      Modal.close();
    };

    Modal.open(
      h("h3", {}, task ? "Aufgabe bearbeiten" : "Neue Aufgabe"),
      h("div", { class: "field" }, h("label", {}, "Name"), name),
      h("div", { class: "field" }, h("label", {}, "Intervall: alle …"),
        h("div", { class: "row" }, num, unit)),
      h("div", { class: "field" }, h("label", {}, "Zuletzt erledigt am"), last),
      h("button", { class: "btn primary block", onclick: save }, "Speichern"),
      task && h("button", { class: "btn danger block", onclick: () => {
        if (confirm(`„${task.name}“ wirklich löschen?`)) { this.repo.deleteTask(task.id); Modal.close(); }
      } }, "Löschen"));
  }
}

// =====================================================================
//  App: Start, Haushaltscode, Tabs, Einstellungen
// =====================================================================
class App {
  constructor(root) { this.root = root; }

  async start() {
    this.registerServiceWorker();
    this.disableZoom();
    if (firebaseConfig.apiKey.startsWith("DEIN")) {
      return this.showMessage("Firebase noch nicht eingerichtet", "Trage deine Firebase-Daten in firebase-config.js ein (siehe README.md, Schritt 1).");
    }
    const app = initializeApp(firebaseConfig);
    // Offline-Speicher: Daten bleiben auf dem Gerät erhalten und werden später synchronisiert
    this.db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
    try {
      await signInAnonymously(getAuth(app));
    } catch (e) {
      console.error(e);
      return this.showMessage("Anmeldung fehlgeschlagen", "Beim ersten Start wird Internet benötigt. Prüfe außerdem, ob „Anonym“ in Firebase Authentication aktiviert ist.");
    }
    // Schnellzugriff per Link, z. B. für einen Kurzbefehl: ?code=XXXXXXXXXXXX&add=Milch
    const params = new URLSearchParams(location.search);
    const linkCode = Session.normalize(params.get("code") || "");
    if (linkCode.length === 12 && !Session.get()) Session.set(linkCode);

    const code = Session.get();
    code ? this.showMain(code) : this.showWelcome();
    if (code) this.handleQuickAdd(params);
  }

  // Verarbeitet ?add=Produkt: Eintrag hinzufügen. Ohne Wert wird nur das Eingabefeld geöffnet.
  handleQuickAdd(params) {
    if (!params.has("add")) return;
    const text = (params.get("add") || "").trim();
    this.select("shopping");
    if (text) this.shopping.whenLoaded(() => this.shopping.add(text));
    else this.shopping.input.focus();
    history.replaceState(null, "", location.pathname); // Parameter aus der Adresse entfernen
  }

  // Verhindert versehentliches Zoomen per Pinch-Geste (Doppeltipp-Zoom blockiert das CSS)
  disableZoom() {
    ["gesturestart", "gesturechange", "gestureend"].forEach((t) =>
      document.addEventListener(t, (e) => e.preventDefault()));
  }

  registerServiceWorker() {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  showMessage(title, text) {
    this.root.replaceChildren(h("div", { class: "welcome" }, h("div", { class: "logo" }, Icons.get("settings", 40)), h("h1", {}, title), h("p", { class: "hint" }, text)));
  }

  // --- Startbildschirm: neuen Haushalt anlegen oder beitreten ---
  showWelcome() {
    const codeInput = h("input", { type: "text", placeholder: "Code eingeben (XXXX-XXXX-XXXX)", autocapitalize: "characters", autocomplete: "off" });
    const join = () => {
      const code = Session.normalize(codeInput.value);
      if (code.length !== 12) return alert("Der Code besteht aus 12 Zeichen.");
      Session.set(code); this.showMain(code);
    };
    this.root.replaceChildren(h("div", { class: "welcome" },
      h("div", { class: "logo" }, Icons.get("home", 44)),
      h("h1", {}, "Willkommen"),
      h("p", { class: "hint" }, "Lege einen neuen Haushalt an oder tritt mit dem Code einer anderen Person bei."),
      h("button", { class: "btn primary block", onclick: () => { const c = Session.generate(); Session.set(c); this.showMain(c); } }, "Neuen Haushalt erstellen"),
      h("div", { class: "hint" }, "oder"),
      h("div", { class: "field" }, codeInput),
      h("button", { class: "btn soft block", onclick: join }, "Mit Code beitreten")));
  }

  // --- Hauptansicht ---
  showMain(code) {
    this.repo = new Repository(this.db, code);
    this.shopping = new ShoppingView(this.repo);
    this.tasks = new TasksView(this.repo);

    this.title = h("h1", {}, "Haushalt");
    this.sub = h("div", { class: "sub" });
    const header = h("div", { class: "header" }, h("div", {}, this.title, this.sub),
      h("button", { class: "icon-btn", onclick: () => this.openSettings(code) }, Icons.get("settings", 22)));

    this.tabButtons = {
      tasks: h("button", { class: "tab", onclick: () => this.select("tasks") }, Icons.get("tasks", 24), "Haushalt"),
      shopping: h("button", { class: "tab", onclick: () => this.select("shopping") }, Icons.get("cart", 24), "Einkauf")
    };
    const tabbar = h("nav", { class: "tabbar" }, this.tabButtons.shopping, this.tabButtons.tasks);
    this.offline = h("div", { class: "status hidden" }, "Offline");

    // Rotes Fehlerbanner (zeigt z. B. "permission-denied", wenn die Firestore-Regeln fehlen)
    this.errorBox = h("div", { class: "error-banner hidden", onclick: () => this.errorBox.classList.add("hidden") });
    Repository.onError = (text) => { this.errorBox.textContent = text; this.errorBox.classList.remove("hidden"); };

    this.root.replaceChildren(this.offline, this.errorBox, header, this.tasks.el, this.shopping.el, tabbar);
    this.select("shopping"); // App startet immer mit der Einkaufsliste

    // Ampel regelmäßig aktualisieren (Zeit vergeht auch ohne Änderungen)
    setInterval(() => this.tasks.render(), 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.tasks.render(); });
    const updateOnline = () => this.offline.classList.toggle("hidden", navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    updateOnline();
  }

  select(tab) {
    this.tasks.el.classList.toggle("hidden", tab !== "tasks");
    this.shopping.el.classList.toggle("hidden", tab !== "shopping");
    Object.entries(this.tabButtons).forEach(([k, b]) => b.classList.toggle("active", k === tab));
    this.title.textContent = tab === "tasks" ? "Haushalt" : "Einkaufsliste";
    this.sub.textContent = ""; // kein Untertitel
  }

  openSettings(code) {
    Modal.open(
      h("h3", {}, "Einstellungen"),
      h("div", { class: "field" }, h("label", {}, "Haushaltscode"), h("div", { class: "code" }, Session.format(code))),
      h("p", { class: "hint" }, "Gib diesen Code an Mitbewohner weiter. Wer ihn auf seinem iPhone eingibt, arbeitet an denselben Listen. Gib ihn nur an Personen weiter, denen du vertraust."),
      h("button", { class: "btn soft block", onclick: async () => {
        try { await navigator.clipboard.writeText(Session.format(code)); alert("Code kopiert."); } catch { alert(Session.format(code)); }
      } }, "Code kopieren"),
      h("button", { class: "btn danger block", onclick: () => {
        if (confirm("Haushalt auf diesem Gerät verlassen? Die Daten bleiben erhalten, du brauchst den Code zum erneuten Beitritt.")) {
          this.repo.stop(); Session.clear(); location.reload();
        }
      } }, "Haushalt verlassen"),
      h("button", { class: "btn block", onclick: () => Modal.close() }, "Schließen"));
  }
}

new App(document.getElementById("app")).start();
