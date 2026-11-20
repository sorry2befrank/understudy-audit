(function attachMeetings(global) {
  "use strict";
  const PREFIX = "understudy_diagnostic_v1:";
  const STAGES = Object.freeze({ research: "Research", conversation: "Conversation", diagnostic: "Diagnostic", proposal: "Proposal", build: "Build", support: "Support", closed: "Closed" });
  const STATUSES = Object.freeze({ unverified: "Still unverified", observed: "Publicly observed", confirmed: "Owner confirmed", disproved: "Disproved / no longer applies" });
  const PLAN_FIELDS = Object.freeze({ problem: "Problem to solve", fix: "Smallest useful fix", unchanged: "What stays unchanged", success: "How we will measure success", questions: "Open questions", nextStep: "Agreed next step" });
  const OFFER = "The diagnostic is $150, credited toward agreed implementation. Build work is quoted after scope: 50% to begin and 50% when complete. Software costs and optional support require separate approval.";
  const text = value => typeof value === "string" ? value : "";
  const plain = value => text(value).replace(/<\/?(?:b|em|strong)>/gi, "");
  const uid = () => global.crypto?.randomUUID?.() || `d${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const clone = value => JSON.parse(JSON.stringify(value));
  function safeUrl(value) {
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; }
    catch { return ""; }
  }
  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  }
  function today() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
  function finding(value = {}) {
    return { id: uid(), statement: text(value.statement), status: value.status || "unverified", source: safeUrl(value.source), checkedAt: text(value.checkedAt), evidence: "", included: false };
  }
  function create(business = {}) {
    const brief = business.ownerBrief || {};
    const researched = text(business.research?.researchedAt || brief.researchedAt).slice(0, 10);
    const checkedAt = validDate(researched) ? researched : "";
    let facts = Array.isArray(business.observed) ? business.observed : [];
    if (brief.kind === "systems") facts = (brief.sections?.[0]?.rows || []).map(row => ({
      text: row.text, sources: brief.sources?.filter(source => source.id === row.source) || []
    }));
    const findings = facts.map(fact => {
      const source = safeUrl(fact.sources?.[0]?.url || fact.sourceUrl);
      return finding({ statement: plain(fact.text), source, checkedAt, status: source && checkedAt ? "observed" : "unverified" });
    });
    let questions = brief.kind === "systems" ? brief.sections?.find(section => section.label === "Questions")?.items
      : brief.questions?.map(question => typeof question === "string" ? question : question.ask) || business.research?.questions;
    if (!questions?.length) questions = [
      "What problem would you most like to solve?",
      "How does a customer move from the first inquiry to completed work and payment?",
      "Which tools already work well, and who controls the accounts?",
      "Where do requests wait, details get re-entered, or follow-ups get missed?",
      "What do your records show about volume, time spent, and operating costs?",
      "What would a useful result look like, and what should remain unchanged?"
    ];
    return { schema: 1, id: text(business.id) || uid(), revision: 0, businessName: text(business.name), category: text(business.category),
      meetingDate: today(), ownerName: "", stage: "research", privateNotes: "", updatedAt: "", findings,
      questions: questions.map(question => ({ id: uid(), question: text(question), answer: "" })),
      workflow: ["Inquiry", "Quote / booking", "Work / payment", "Follow-up"].map(step => ({ step, tool: "", friction: "" })),
      plan: Object.fromEntries(Object.keys(PLAN_FIELDS).map(key => [key, ""])), includeOffer: false };
  }
  function validate(record, id) {
    if (!record || record.schema !== 1 || typeof record.id !== "string" || record.id !== id || !record.id || record.id.length > 160
      || !Number.isSafeInteger(record.revision) || record.revision < 0 || !Object.hasOwn(STAGES, record.stage)) throw new Error("This diagnostic cannot be read safely. Its stored data has not been changed.");
    for (const key of ["businessName", "category", "meetingDate", "ownerName", "privateNotes", "updatedAt"]) {
      if (typeof record[key] !== "string") throw new Error("This diagnostic has an unreadable field. Its stored data has not been changed.");
    }
    if (!Array.isArray(record.findings) || !Array.isArray(record.questions) || !Array.isArray(record.workflow)
      || !record.plan || typeof record.includeOffer !== "boolean") throw new Error("This diagnostic has an unreadable section. Its stored data has not been changed.");
    for (const item of record.findings) {
      if (!item || !["id", "statement", "source", "checkedAt", "evidence"].every(key => typeof item[key] === "string")
        || !Object.hasOwn(STATUSES, item.status) || typeof item.included !== "boolean") throw new Error("A finding cannot be read safely. Its stored data has not been changed.");
    }
    for (const item of record.questions) if (!item || !["id", "question", "answer"].every(key => typeof item[key] === "string")) throw new Error("An owner answer cannot be read safely.");
    for (const item of record.workflow) if (!item || !["step", "tool", "friction"].every(key => typeof item[key] === "string")) throw new Error("A workflow step cannot be read safely.");
    for (const key of Object.keys(PLAN_FIELDS)) if (typeof record.plan[key] !== "string") throw new Error("A summary field cannot be read safely.");
    return record;
  }
  function load(id, storage = global.localStorage) {
    const raw = storage.getItem(PREFIX + id);
    if (raw === null) return null;
    let record;
    try { record = JSON.parse(raw); } catch { throw new Error("This diagnostic contains unreadable data. It has not been overwritten."); }
    return validate(record, id);
  }
  function list(storage = global.localStorage) {
    const records = [], errors = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try { records.push(load(key.slice(PREFIX.length), storage)); } catch (error) { errors.push(error.message); }
    }
    records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { records, errors };
  }
  function save(record, storage = global.localStorage) {
    validate(record, record.id);
    const previous = load(record.id, storage);
    if ((previous?.revision || 0) !== record.revision) throw new Error("This diagnostic changed in another tab. Your unsaved text remains here. Keep a private backup before reloading.");
    const saved = { ...clone(record), revision: record.revision + 1, updatedAt: new Date().toISOString() };
    try { storage.setItem(PREFIX + record.id, JSON.stringify(saved)); }
    catch { throw new Error("Not saved. Device storage is unavailable or full. Your text remains here; retry saving or keep a private backup."); }
    return saved;
  }
  function remove(record, storage = global.localStorage) {
    const latest = load(record.id, storage);
    if (latest?.revision !== record.revision) throw new Error("This diagnostic changed in another tab. Reload before deleting it.");
    storage.removeItem(PREFIX + record.id);
  }
  function evidenceIssue(item) {
    if (!item.statement.trim()) return "Add the finding in client-ready wording.";
    if (!["observed", "confirmed"].includes(item.status)) return "Confirm this finding before including it.";
    if (!validDate(item.checkedAt) || item.checkedAt > today()) return "Add a valid, non-future evidence date.";
    if (item.status === "observed" && !safeUrl(item.source)) return "A public observation needs a source link.";
    if (item.status === "confirmed" && !item.evidence.trim()) return "Record the owner's confirmation in private evidence notes.";
    return "";
  }
  // Explicit projection: private answers, evidence, workflow notes and owner identity cannot enter an export.
  function summary(record) {
    validate(record, record.id);
    const included = record.findings.filter(item => item.included);
    const problems = [];
    if (!record.businessName.trim()) problems.push("Add the business name.");
    if (!included.length) problems.push("Select at least one evidence-backed finding in Findings.");
    included.forEach((item, index) => { const issue = evidenceIssue(item); if (issue) problems.push(`Finding ${index + 1}: ${issue}`); });
    for (const key of ["problem", "fix", "success", "nextStep"]) if (!record.plan[key].trim()) problems.push(`Complete ${PLAN_FIELDS[key].toLowerCase()}.`);
    return {
      problems,
      businessName: record.businessName.trim(),
      date: validDate(record.meetingDate) ? record.meetingDate : "",
      findings: included.filter(item => !evidenceIssue(item)).map(item => ({ statement: item.statement.trim(), status: STATUSES[item.status], checkedAt: item.checkedAt, source: item.status === "observed" ? safeUrl(item.source) : "" })),
      plan: Object.fromEntries(Object.keys(PLAN_FIELDS).map(key => [key, record.plan[key].trim()])),
      offer: record.includeOffer ? OFFER : ""
    };
  }
  function summaryText(result) {
    if (result.problems.length) throw new Error("Complete the summary review before exporting.");
    return ["UNDERSTUDY / DIAGNOSTIC REVIEW", result.businessName, result.date, "Draft for owner review", "", "FINDINGS",
      ...result.findings.map(item => `${item.statement}\n${item.status} / ${item.checkedAt}${item.source ? `\n${item.source}` : ""}`), "",
      ...Object.entries(PLAN_FIELDS).filter(([key]) => result.plan[key]).map(([key, label]) => `${label.toUpperCase()}\n${result.plan[key]}\n`),
      result.offer ? `TERMS TO DISCUSS\n${result.offer}\n` : "", "No guaranteed savings or results. Implementation requires an agreed scope."
    ].filter(value => value !== "").join("\n\n");
  }
  global.UnderstudyMeetings = Object.freeze({ PREFIX, STAGES, STATUSES, PLAN_FIELDS, OFFER, uid, safeUrl, today, create, finding, load, list, save, remove, evidenceIssue, summary, summaryText });
  // Lets Node tests require this file; browsers ignore it.
  if (typeof module === "object" && module.exports) module.exports = global.UnderstudyMeetings;
})(globalThis);
