"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Meetings = require("../meetings.js");
const { memoryStorage } = require("./storage.js");

const PAST = "2026-01-15";
const SITE = "https://juniper-street-bakery.example/";

function demoBusiness() {
  return {
    id: "juniper-demo",
    name: "Juniper Street Bakery (demo)",
    category: "Fictional bakery",
    observed: [
      { text: "Pickup goes to <b>Clover</b>", sourceUrl: SITE },
      { text: "Has a Bread Club", sourceUrl: SITE + "bread-club" }
    ],
    research: { researchedAt: `${PAST}T12:00:00-04:00` }
  };
}

// A record that passes every export check, with secrets planted in every private field.
function readyRecord() {
  const record = Meetings.create(demoBusiness());
  record.ownerName = "OWNER-NAME-SECRET";
  record.privateNotes = "PRIVATE-NOTES-SECRET";
  record.questions[0].answer = "OWNER-ANSWER-SECRET";
  record.workflow[0].tool = "WORKFLOW-TOOL-SECRET";
  record.workflow[0].friction = "WORKFLOW-FRICTION-SECRET";
  record.findings[0].included = true;
  record.findings[0].evidence = "EVIDENCE-NOTE-SECRET";
  record.findings[1].statement = "EXCLUDED-FINDING-SECRET";
  record.findings[1].included = false;
  Object.assign(record.plan, {
    problem: "Hours differ across listings.",
    fix: "Correct the hours and redirect the old page.",
    success: "One set of hours everywhere.",
    nextStep: "Owner confirms the official hours."
  });
  return record;
}

const SECRETS = [
  "OWNER-NAME-SECRET", "PRIVATE-NOTES-SECRET", "OWNER-ANSWER-SECRET",
  "WORKFLOW-TOOL-SECRET", "WORKFLOW-FRICTION-SECRET", "EVIDENCE-NOTE-SECRET", "EXCLUDED-FINDING-SECRET"
];

test("create() turns dated, sourced public facts into observed findings", () => {
  const record = Meetings.create(demoBusiness());
  assert.equal(record.revision, 0);
  assert.equal(record.findings.length, 2);
  assert.equal(record.findings[0].statement, "Pickup goes to Clover", "markup is stripped");
  assert.equal(record.findings[0].status, "observed");
  assert.equal(record.findings[0].checkedAt, PAST);
  assert.equal(record.findings[0].included, false, "nothing is selected for export by default");
});

test("create() leaves a fact unverified when it has no source", () => {
  const record = Meetings.create({ id: "x", name: "X", observed: [{ text: "No link" }], research: { researchedAt: PAST } });
  assert.equal(record.findings[0].status, "unverified");
});

test("safeUrl() accepts only plain http(s) links without credentials", () => {
  assert.equal(Meetings.safeUrl(SITE), SITE);
  assert.equal(Meetings.safeUrl("javascript:alert(1)"), "");
  assert.equal(Meetings.safeUrl("data:text/html,hi"), "");
  assert.equal(Meetings.safeUrl("https://user:pass@example.com/"), "");
  assert.equal(Meetings.safeUrl("not a url"), "");
});

test("save() stores a new record and increments its revision", () => {
  const storage = memoryStorage();
  const saved = Meetings.save(Meetings.create(demoBusiness()), storage);
  assert.equal(saved.revision, 1);
  assert.ok(saved.updatedAt);
  assert.deepEqual(Meetings.load("juniper-demo", storage), saved);
});

test("save() refuses a write from a stale tab and keeps the newer data", () => {
  const storage = memoryStorage();
  Meetings.save(Meetings.create(demoBusiness()), storage);

  const tabA = Meetings.load("juniper-demo", storage);
  const tabB = Meetings.load("juniper-demo", storage);
  tabA.privateNotes = "written in tab A";
  Meetings.save(tabA, storage);

  tabB.privateNotes = "written in tab B";
  assert.throws(() => Meetings.save(tabB, storage), /changed in another tab/);
  assert.equal(Meetings.load("juniper-demo", storage).privateNotes, "written in tab A");
  assert.equal(Meetings.load("juniper-demo", storage).revision, 2);
});

test("save() refuses a second 'new' record that would overwrite an existing one", () => {
  const storage = memoryStorage();
  Meetings.save(Meetings.create(demoBusiness()), storage);
  assert.throws(() => Meetings.save(Meetings.create(demoBusiness()), storage), /changed in another tab/);
});

test("remove() refuses a stale copy and accepts the current one", () => {
  const storage = memoryStorage();
  const first = Meetings.save(Meetings.create(demoBusiness()), storage);
  const latest = Meetings.save(first, storage);
  assert.throws(() => Meetings.remove(first, storage), /changed in another tab/);
  Meetings.remove(latest, storage);
  assert.equal(Meetings.load("juniper-demo", storage), null);
});

test("save() reports full storage without changing what was stored", () => {
  const storage = memoryStorage();
  const saved = Meetings.save(Meetings.create(demoBusiness()), storage);
  const before = storage.getItem(Meetings.PREFIX + "juniper-demo");
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.throws(() => Meetings.save(saved, storage), /Not saved/);
  assert.equal(storage.getItem(Meetings.PREFIX + "juniper-demo"), before);
});

test("unreadable stored data is reported and never overwritten", () => {
  const storage = memoryStorage();
  storage.setItem(Meetings.PREFIX + "broken", "{not json");
  storage.setItem(Meetings.PREFIX + "moved", JSON.stringify({ ...Meetings.create(demoBusiness()), id: "other" }));
  assert.throws(() => Meetings.load("broken", storage), /unreadable data/);
  assert.throws(() => Meetings.load("moved", storage), /cannot be read safely/);
  const { records, errors } = Meetings.list(storage);
  assert.equal(records.length, 0);
  assert.equal(errors.length, 2);
  assert.equal(storage.getItem(Meetings.PREFIX + "broken"), "{not json");
});

test("summary() exports only selected findings and client wording, never private fields", () => {
  const record = readyRecord();
  const result = Meetings.summary(record);
  assert.deepEqual(result.problems, []);
  assert.equal(result.findings.length, 1);
  assert.deepEqual(Object.keys(result).sort(), ["businessName", "date", "findings", "offer", "plan", "problems"]);
  assert.deepEqual(Object.keys(result.findings[0]).sort(), ["checkedAt", "source", "statement", "status"]);

  const exported = JSON.stringify(result) + Meetings.summaryText(result);
  for (const secret of SECRETS) assert.ok(!exported.includes(secret), `${secret} leaked into the export`);
});

test("summary() leaves the offer out unless it is explicitly selected", () => {
  const record = readyRecord();
  assert.equal(Meetings.summary(record).offer, "");
  record.includeOffer = true;
  assert.equal(Meetings.summary(record).offer, Meetings.OFFER);
});

test("summary() blocks findings that lack evidence", async t => {
  const cases = [
    ["unverified status", f => { f.status = "unverified"; }, /Confirm this finding/],
    ["disproved status", f => { f.status = "disproved"; }, /Confirm this finding/],
    ["observed without a source", f => { f.source = ""; }, /needs a source link/],
    ["observed with an unsafe source", f => { f.source = "javascript:alert(1)"; }, /needs a source link/],
    ["owner-confirmed without a private note", f => { f.status = "confirmed"; f.evidence = ""; }, /Record the owner's confirmation/],
    ["a future evidence date", f => { f.checkedAt = "2999-01-01"; }, /non-future evidence date/],
    ["an impossible date", f => { f.checkedAt = "2026-02-30"; }, /non-future evidence date/],
    ["an empty statement", f => { f.statement = "  "; }, /client-ready wording/]
  ];
  for (const [name, mutate, message] of cases) {
    await t.test(name, () => {
      const record = readyRecord();
      mutate(record.findings[0]);
      const result = Meetings.summary(record);
      assert.ok(result.problems.some(problem => message.test(problem)), result.problems.join(" | "));
      assert.equal(result.findings.length, 0, "a blocked finding is not exported");
      assert.throws(() => Meetings.summaryText(result), /Complete the summary review/);
    });
  }
});

test("an owner-confirmed finding exports without its private evidence or source link", () => {
  const record = readyRecord();
  Object.assign(record.findings[0], { status: "confirmed", evidence: "EVIDENCE-NOTE-SECRET" });
  const result = Meetings.summary(record);
  assert.deepEqual(result.problems, []);
  assert.equal(result.findings[0].status, "Owner confirmed");
  assert.equal(result.findings[0].source, "");
  assert.ok(!Meetings.summaryText(result).includes("EVIDENCE-NOTE-SECRET"));
});

test("summary() requires at least one selected finding and the core plan fields", () => {
  const record = readyRecord();
  record.findings.forEach(item => { item.included = false; });
  record.plan.problem = "";
  const problems = Meetings.summary(record).problems.join(" | ");
  assert.match(problems, /Select at least one evidence-backed finding/);
  assert.match(problems, /problem to solve/);
});
