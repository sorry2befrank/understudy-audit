(function attachMeetingUI(global) {
  "use strict";
  const M = global.UnderstudyMeetings;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const routeFor = (view, id) => `#/${view}/${encodeURIComponent(id)}`;
  const icon = name => global.UnderstudyMeetingIcons?.[name] || "";
  const tool = (action, label, name, disabled = false) => `<button type="button" class="m-tool" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${disabled ? "disabled" : ""}>${icon(name)}<span class="m-tooltip">${esc(label)}</span></button>`;
  let active = null, tab = "conversation", lastError = "";
  const root = () => document.getElementById("app");
  function field(label, name, value, type = "text") {
    const input = type === "textarea" ? `<textarea rows="3" aria-label="${esc(label)}" data-field="${name}" maxlength="12000">${esc(value)}</textarea>`
      : `<input type="${type}" aria-label="${esc(label)}" data-field="${name}" value="${esc(value)}" ${type === "text" ? 'maxlength="300"' : ""}>`;
    return `<label class="m-field"><span>${esc(label)}</span>${input}</label>`;
  }
  function choice(label, name, value, options) {
    return `<label class="m-field"><span>${esc(label)}</span><select aria-label="${esc(label)}" data-field="${name}">${Object.entries(options).map(([key, text]) => `<option value="${key}" ${key === value ? "selected" : ""}>${esc(text)}</option>`).join("")}</select></label>`;
  }
  function bar(name, back = "#/") {
    return `<header class="appbar m-bar"><a class="m-tool" href="${esc(back)}" aria-label="Back" title="Back">${icon("arrow-left")}</a><div><div class="brand">Understudy</div><h1>${esc(name)}</h1></div></header>`;
  }
  function status() {
    const el = document.getElementById("meeting-save-status");
    if (!el) return;
    el.textContent = lastError || "Saved on this device";
    el.className = lastError ? "m-save error" : "m-save";
    document.getElementById("meeting-retry").hidden = !lastError;
  }
  function persist() {
    if (!active) return true;
    try { active.record = M.save(active.record); active.dirty = false; lastError = ""; }
    catch (error) { active.dirty = true; lastError = error.message; }
    status();
    return !active.dirty;
  }
  function leave() {
    if (active?.dirty) {
      location.hash = active.hash;
      status();
      return false;
    }
    active = null;
    lastError = "";
    return true;
  }
  function actions() {
    root().onclick = onClick;
    root().oninput = onInput;
    root().onchange = onInput;
    root().onsubmit = onSubmit;
    root().onkeydown = event => {
      const current = event.target.closest('[role="tab"]');
      if (!current || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const tabs = ["conversation", "findings", "plan"], index = tabs.indexOf(tab);
      tab = tabs[event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3];
      renderMeeting(); document.getElementById(`tab-${tab}`).focus();
    };
  }
  function renderList() {
    const { records, errors } = M.list();
    root().innerHTML = `${bar("Diagnostics")}<main class="m-shell">
      <section class="m-section"><h2>Your conversations</h2><div class="m-grid">${field("Search businesses", "search", "")}${choice("Stage", "filter", "all", { all: "All stages", ...M.STAGES })}</div>
      ${errors.length ? `<p class="m-error" role="alert">${errors.length} saved record(s) could not be read. They have not been changed.</p>` : ""}
      <div id="meeting-list">${records.map(record => `<article class="m-record" data-name="${esc(record.businessName.toLowerCase())}" data-stage="${record.stage}"><div><h3>${esc(record.businessName)}</h3><p>${esc(record.category)} <span class="m-stage">${M.STAGES[record.stage]}</span></p></div><a class="btn" href="${routeFor("meeting", record.id)}">Continue</a></article>`).join("")}</div>
      <p id="meeting-empty" class="m-muted" ${records.length ? "hidden" : ""}>No diagnostics yet.</p></section>
      <section class="m-section"><h2>New business</h2><form id="new-diagnostic"><div class="m-grid"><label class="m-field"><span>Business name</span><input name="businessName" maxlength="200" required></label><label class="m-field"><span>Business type / location</span><input name="category" maxlength="300"></label></div><button class="btn primary" type="submit">Start diagnostic</button><p id="meeting-create-error" class="m-error" role="alert"></p></form></section>
      <p class="m-muted">Private records stay on this device. Clearing browser data removes them.</p>
    </main>`;
  }
  function renderMeeting() {
    const b = active.record;
    root().innerHTML = `${bar(b.businessName || "New diagnostic", "#/diagnostics")}<main class="m-shell">
      <div class="m-heading"><span class="m-stage">${M.STAGES[b.stage]}</span><div class="m-actions">${tool("backup", "Download private backup", "download")}${tool("delete", "Delete diagnostic", "trash-2")}</div></div>
      <div class="m-statusbar"><p id="meeting-save-status" class="m-save" role="status" aria-live="polite"></p><button id="meeting-retry" type="button" class="btn" data-action="retry" hidden>Retry saving</button></div>
      <nav class="m-tabs" role="tablist" aria-label="Diagnostic views">${["conversation", "findings", "plan"].map(value => `<button id="tab-${value}" type="button" role="tab" aria-selected="${tab === value}" tabindex="${tab === value ? 0 : -1}" aria-controls="meeting-panel" data-tab="${value}">${{ conversation: "Conversation", findings: "Findings", plan: "Client wording" }[value]}</button>`).join("")}<a class="btn" href="${routeFor("summary", b.id)}">Preview summary</a></nav>
      <div id="meeting-panel" role="tabpanel" aria-labelledby="tab-${tab}">${tab === "conversation" ? conversation(b) : tab === "findings" ? findings(b) : plan(b)}</div>
    </main>`;
    status();
    refreshFindings();
  }
  function conversation(b) {
    return `<section class="m-section"><h2>Meeting details</h2><div class="m-grid">${field("Business name", "businessName", b.businessName)}${field("Business type / location", "category", b.category)}${field("Meeting date", "meetingDate", b.meetingDate, "date")}${choice("Progress", "stage", b.stage, M.STAGES)}${field("Owner / contact (private)", "ownerName", b.ownerName)}</div></section>
      <section class="m-section"><h2>Questions for the owner</h2><span class="m-private">Private answers</span>${b.questions.map((q, i) => `<div class="m-question">${field(q.question, `question:${i}`, q.answer, "textarea")}</div>`).join("")}</section>
      <section class="m-section"><h2>How work moves today</h2><span class="m-private">Private working notes</span>${b.workflow.map((step, i) => `<div class="m-workflow"><h3>${esc(step.step)}</h3><div class="m-grid">${field("Current tool / person", `workflow:${i}:tool`, step.tool)}${field("Waiting, repeat work, or exceptions", `workflow:${i}:friction`, step.friction, "textarea")}</div></div>`).join("")}</section>
      <section class="m-section"><h2>Private notes</h2>${field("Notes not included in the client summary", "privateNotes", b.privateNotes, "textarea")}</section>`;
  }
  function findings(b) {
    return `<section class="m-section"><div class="m-heading"><h2>Findings to check</h2><button class="btn" type="button" data-action="add-finding">Add finding</button></div>
      ${b.findings.length ? b.findings.map((item, i) => `<article class="m-finding" data-finding="${i}"><div class="m-heading"><h3>Finding ${i + 1}</h3><button type="button" class="m-tool" data-action="remove-finding" data-index="${i}" aria-label="Remove finding ${i + 1}" title="Remove finding">${icon("trash-2")}</button></div>
      ${field("Finding (client wording)", `finding:${i}:statement`, item.statement, "textarea")}
      <div class="m-grid">${choice("Evidence status", `finding:${i}:status`, item.status, M.STATUSES)}${field("Evidence date", `finding:${i}:checkedAt`, item.checkedAt, "date")}</div>
      ${field("Public source URL", `finding:${i}:source`, item.source, "url")}${field("Private evidence / owner's confirmation", `finding:${i}:evidence`, item.evidence, "textarea")}
      <p class="m-evidence-state" id="finding-issue-${i}"></p><label class="m-check"><input type="checkbox" data-field="finding:${i}:included" ${item.included ? "checked" : ""}><span>Include this finding in the client summary</span></label></article>`).join("") : '<p class="m-muted">No findings recorded.</p>'}</section>`;
  }
  function plan(b) {
    return `<section class="m-section"><h2>Client-ready wording</h2><p class="m-muted">Included in the summary preview. Private answers and evidence notes are excluded.</p>
      ${Object.entries(M.PLAN_FIELDS).map(([key, label]) => field(label, `plan:${key}`, b.plan[key], "textarea")).join("")}
      <label class="m-check"><input type="checkbox" data-field="includeOffer" ${b.includeOffer ? "checked" : ""}><span>Include diagnostic and implementation terms</span></label><p class="m-muted">${esc(M.OFFER)}</p></section>`;
  }
  function summaryMarkup(result) {
    return `<article class="m-summary"><header><p class="m-eyebrow">Understudy / Diagnostic review</p><h1>${esc(result.businessName)}</h1><p>${esc(result.date)} / Draft for owner review</p></header>
      <section><h2>Findings</h2>${result.findings.map(item => `<div class="m-summary-finding"><p class="m-prose">${esc(item.statement)}</p><p class="m-muted">${esc(item.status)} / ${esc(item.checkedAt)}</p>${item.source ? `<a href="${esc(item.source)}" target="_blank" rel="noopener noreferrer">${esc(item.source)}</a>` : ""}</div>`).join("")}</section>
      ${Object.entries(M.PLAN_FIELDS).filter(([key]) => result.plan[key]).map(([key, label]) => `<section><h2>${esc(label)}</h2><p class="m-prose">${esc(result.plan[key])}</p></section>`).join("")}
      ${result.offer ? `<section><h2>Terms to discuss</h2><p>${esc(result.offer)}</p></section>` : ""}
      <footer>No guaranteed savings or results. Implementation requires an agreed scope.</footer></article>`;
  }
  function renderSummary() {
    const result = M.summary(active.record), blocked = result.problems.length > 0;
    root().innerHTML = `${bar("Client summary", routeFor("meeting", active.record.id))}<main class="m-shell m-preview">
      <div class="m-summary-tools"><span>Preview before sharing</span><div class="m-actions">${tool("copy", "Copy client summary", "clipboard-copy", blocked)}${tool("download", "Download client summary", "download", blocked)}${tool("print", "Print client summary", "printer", blocked)}</div></div>
      <p id="meeting-export-status" role="status" aria-live="polite"></p>
      ${blocked ? `<section class="m-blocked" role="status"><h2>Not ready to share</h2><ul>${result.problems.map(item => `<li>${esc(item)}</li>`).join("")}</ul><a class="btn" href="${routeFor("meeting", active.record.id)}">Continue review</a></section>` : ""}
      ${summaryMarkup(result)}</main>`;
  }
  function refreshFindings() {
    if (!active) return;
    active.record.findings.forEach((item, i) => {
      const issue = M.evidenceIssue(item), label = document.getElementById(`finding-issue-${i}`);
      if (label) label.textContent = issue || "Evidence recorded";
      const checkbox = root().querySelector(`[data-field="finding:${i}:included"]`);
      if (checkbox) { checkbox.disabled = Boolean(issue) && !item.included; checkbox.checked = item.included; }
    });
  }
  function onInput(event) {
    const el = event.target, field = el.dataset.field;
    if (!field) return;
    if (["search", "filter"].includes(field)) {
      const query = root().querySelector('[data-field="search"]').value.toLowerCase();
      const stage = root().querySelector('[data-field="filter"]').value;
      const rows = [...root().querySelectorAll(".m-record")];
      rows.forEach(row => { row.hidden = !row.dataset.name.includes(query) || (stage !== "all" && row.dataset.stage !== stage); });
      const empty = document.getElementById("meeting-empty");
      empty.hidden = rows.some(row => !row.hidden); empty.textContent = rows.length ? "No matching diagnostics." : "No diagnostics yet.";
      return;
    }
    if (!active || active.view !== "meeting") return;
    const [group, index, key] = field.split(":"), value = el.type === "checkbox" ? el.checked : el.value;
    const b = active.record;
    if (group === "finding") {
      if (!b.findings[index] || !["statement", "status", "source", "checkedAt", "evidence", "included"].includes(key)) return;
      b.findings[index][key] = value;
    } else if (group === "question" && b.questions[index]) b.questions[index].answer = value;
    else if (group === "workflow" && b.workflow[index] && ["tool", "friction"].includes(key)) b.workflow[index][key] = value;
    else if (group === "plan" && Object.hasOwn(M.PLAN_FIELDS, index)) b.plan[index] = value;
    else if (["businessName", "category", "meetingDate", "stage", "ownerName", "privateNotes", "includeOffer"].includes(group)) b[group] = value;
    else return;
    persist();
    refreshFindings();
    if (group === "businessName") root().querySelector(".m-bar h1").textContent = b.businessName || "New diagnostic";
    if (group === "stage") root().querySelector(".m-stage").textContent = M.STAGES[b.stage];
  }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function filename(businessName) { return businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "business"; }
  function exportHtml(result) {
    M.summaryText(result);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(result.businessName)} - Diagnostic review</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#1b2a2e;margin:0 auto;padding:28px;max-width:800px}h1{font:700 30px/1.2 Georgia,serif;overflow-wrap:anywhere}h2{font:700 22px/1.3 Georgia,serif}section{border-top:1px solid #ccd6d2;margin-top:24px;padding-top:12px}.m-prose{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#0f6e5a;overflow-wrap:anywhere}.m-muted,footer{color:#556361;font-size:14px}.m-summary-finding{margin-bottom:24px}footer{margin-top:32px}@media print{body{padding:0}section{break-inside:avoid}a{color:inherit}}</style></head><body>${summaryMarkup(result)}</body></html>`;
  }
  async function onClick(event) {
    const button = event.target.closest("[data-action],[data-tab]");
    if (!button || !root().contains(button)) return;
    if (button.dataset.tab && active?.view === "meeting") { tab = button.dataset.tab; renderMeeting(); return; }
    if (!active) return;
    const action = button.dataset.action;
    if (action === "retry") { persist(); return; }
    if (action === "backup") {
      if (confirm("This file includes private notes and owner answers. Keep it private.")) download(`${filename(active.record.businessName)}-PRIVATE-notes.json`, JSON.stringify(active.record, null, 2), "application/json");
      return;
    }
    if (action === "delete") {
      if (!confirm("Delete this diagnostic and its private notes from this device? The original audit or public brief will remain.")) return;
      try { M.remove(active.record); active = null; location.hash = "#/diagnostics"; } catch (error) { lastError = error.message; status(); }
      return;
    }
    if (action === "add-finding") { active.record.findings.push(M.finding()); persist(); renderMeeting(); root().querySelector('.m-finding:last-child textarea')?.focus(); return; }
    if (action === "remove-finding") {
      if (!confirm("Remove this finding and its private evidence notes?")) return;
      active.record.findings.splice(Number(button.dataset.index), 1); persist(); renderMeeting(); return;
    }
    if (!["copy", "download", "print"].includes(action)) return;
    const output = document.getElementById("meeting-export-status");
    try {
      const latest = M.load(active.record.id);
      if (!latest) throw new Error("This diagnostic was removed in another tab. Return to Diagnostics before continuing.");
      if (latest?.revision !== active.record.revision) { active.record = latest; renderSummary(); throw new Error("The diagnostic changed in another tab. Review the refreshed summary before exporting."); }
      const result = M.summary(active.record), content = M.summaryText(result);
      if (action === "copy") {
        await navigator.clipboard.writeText(content);
        output.textContent = "Client summary copied.";
      } else if (action === "download") {
        download(`${filename(result.businessName)}-diagnostic-review.html`, exportHtml(result), "text/html");
        output.textContent = "Client summary downloaded. Private notes are excluded.";
      } else global.print();
    } catch (error) {
      const current = document.getElementById("meeting-export-status");
      if (current) current.textContent = error.message || "Could not export. Try downloading the summary instead.";
    }
  }
  function onSubmit(event) {
    if (event.target.id !== "new-diagnostic") return;
    event.preventDefault();
    try {
      const form = new FormData(event.target), name = String(form.get("businessName") || "").trim();
      if (!name) throw new Error("Enter a business name.");
      const record = M.save(M.create({ name, category: String(form.get("category") || "") }));
      location.hash = routeFor("meeting", record.id);
    } catch (error) { document.getElementById("meeting-create-error").textContent = error.message; }
  }
  function route(view, id, resolveBusiness) {
    if (active?.dirty && location.hash !== active.hash) { location.hash = active.hash; status(); return; }
    if (active?.dirty) return;
    document.getElementById("present").classList.remove("on");
    try {
      if (view === "diagnostics") { active = null; renderList(); }
      else {
        id = decodeURIComponent(id || "");
        let record = M.load(id);
        if (!record) {
          const business = resolveBusiness(id);
          if (!business) throw new Error("This business was not found. Start a diagnostic from the business list.");
          record = M.save(M.create(business));
        }
        if (active?.record.id !== id) tab = "conversation";
        active = { record, dirty: false, view, hash: location.hash };
        lastError = "";
        if (view === "summary") renderSummary(); else renderMeeting();
      }
    } catch (error) {
      root().innerHTML = `${bar("Diagnostics", "#/diagnostics")}<main class="m-shell"><p class="m-error" role="alert">${esc(error.message)}</p></main>`;
    }
    actions();
    global.scrollTo(0, 0);
  }
  global.addEventListener("beforeunload", event => { if (active?.dirty) { event.preventDefault(); event.returnValue = ""; } });
  global.UnderstudyMeetingUI = Object.freeze({ route, leave, exportHtml });
})(globalThis);
