import assert from "node:assert/strict";
import crypto from "node:crypto";

const PERIODS = {
  day: { label: "день", yearly: 365 },
  week: { label: "неделя", yearly: 52 },
  month: { label: "месяц", yearly: 12 },
  year: { label: "год", yearly: 1 },
};

function normalizePeriod(period) {
  return PERIODS[period] ? period : "month";
}

function yearlyRub(item, rates = {}) {
  const period = normalizePeriod(item.period);
  const rubAmount = item.amount * (item.currency === "RUB" ? 1 : rates[item.currency]);
  return rubAmount * PERIODS[period].yearly;
}

function monthlyRub(item, rates = {}) {
  return yearlyRub(item, rates) / 12;
}

function cleanSyncToken(value) {
  return String(value || "").trim().replace(/^SYNC_TOKEN\s*=\s*/i, "").trim();
}

function isValidSpaceKey(value) {
  const key = cleanSyncToken(value);
  return key.length > 0;
}

function stateFileForToken(token) {
  return `${crypto.createHash("sha256").update(token).digest("hex")}.json`;
}

function analyticsPayload(event) {
  return { event, meta: { platform: "ios", pwa: false } };
}

const rates = { USD: 100 };
assert.equal(yearlyRub({ amount: 10, currency: "RUB", period: "day" }), 3650);
assert.equal(monthlyRub({ amount: 10, currency: "RUB", period: "day" }), 3650 / 12);
assert.equal(yearlyRub({ amount: 10, currency: "RUB", period: "week" }), 520);
assert.equal(monthlyRub({ amount: 10, currency: "RUB", period: "week" }), 520 / 12);
assert.equal(yearlyRub({ amount: 10, currency: "RUB", period: "month" }), 120);
assert.equal(monthlyRub({ amount: 10, currency: "RUB", period: "month" }), 10);
assert.equal(yearlyRub({ amount: 10, currency: "RUB", period: "year" }), 10);
assert.equal(monthlyRub({ amount: 10, currency: "RUB", period: "year" }), 10 / 12);
assert.equal(monthlyRub({ amount: 2, currency: "USD", period: "week" }, rates), 200 * 52 / 12);

assert.equal(normalizePeriod("month"), "month");
assert.equal(normalizePeriod("year"), "year");
assert.equal(normalizePeriod("legacy-weird"), "month");

assert.equal(cleanSyncToken(" SYNC_TOKEN=abc12345 "), "abc12345");
assert.equal(isValidSpaceKey(""), false);
assert.equal(isValidSpaceKey("short"), true);
assert.equal(isValidSpaceKey("has space inside"), true);
assert.equal(isValidSpaceKey("valid-key-123"), true);

const oldKey = "old-recovery-key";
const newKey = "new-recovery-key";
assert.notEqual(stateFileForToken(oldKey), stateFileForToken(newKey));
assert.match(stateFileForToken(newKey), /^[0-9a-f]{64}\.json$/);

const payload = JSON.stringify(analyticsPayload("app_open"));
assert.equal(payload.includes(newKey), false);
assert.equal(payload.includes(oldKey), false);

console.log("regression checks passed");
