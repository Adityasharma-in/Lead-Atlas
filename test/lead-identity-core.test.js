import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assignLeadIndexes,
  dedupeLeads,
  emailIdentity,
  formatLeadIndex,
  groupDuplicateLeads,
  leadIdentityKey,
  leadIdentityKeys,
  normalizeIdentityText,
  phoneIdentity,
  stableLeadId,
} from "../public/lead-identity-core.js";

describe("normalizeIdentityText", () => {
  it("removes accents, punctuation and case for matching", () => {
    assert.equal(normalizeIdentityText("  Café & Co.  "), "cafe and co");
    assert.equal(normalizeIdentityText("MÜLLER & Söhne"), "muller and sohne");
    assert.equal(normalizeIdentityText("A.B.C"), "a b c");
  });

  it("returns an empty key for missing or non-text values", () => {
    assert.equal(normalizeIdentityText(null), "");
    assert.equal(normalizeIdentityText(undefined), "");
    assert.equal(normalizeIdentityText({}), "");
    assert.equal(normalizeIdentityText(true), "");
  });
});

describe("phoneIdentity", () => {
  it("reduces punctuation and a North American country prefix", () => {
    assert.equal(phoneIdentity("+1 (512) 555-0100"), "5125550100");
    assert.equal(phoneIdentity("1-512-555-0100"), "5125550100");
    assert.equal(phoneIdentity("512.555.0100"), "5125550100");
  });

  it("reduces international access and trunk prefixes", () => {
    assert.equal(phoneIdentity("00 44 20 7946 0958"), "442079460958");
    assert.equal(phoneIdentity("020 7946 0958"), "2079460958");
  });

  it("rejects keys too short to identify a business", () => {
    assert.equal(phoneIdentity("12345"), "");
    assert.equal(phoneIdentity(""), "");
    assert.equal(phoneIdentity(null), "");
  });
});

describe("emailIdentity", () => {
  it("accepts mailto values and lowercases the address", () => {
    assert.equal(emailIdentity("mailto:Hello@Acme.Example"), "hello@acme.example");
    assert.equal(emailIdentity("  SALES@ACME.EXAMPLE "), "sales@acme.example");
  });

  it("rejects malformed and overlong addresses", () => {
    assert.equal(emailIdentity("not-an-email"), "");
    assert.equal(emailIdentity("a@b"), "");
    assert.equal(emailIdentity(`${"a".repeat(250)}@acme.example`), "");
  });
});

describe("leadIdentityKeys", () => {
  it("collects every way a contact can be recognised, preferred key first", () => {
    const keys = leadIdentityKeys({
      placeId: "ChIJABC123",
      phone: "(512) 555-0100",
      phones: ["+1 512 555 0100", "512-555-0199"],
      email: "HELLO@acme.example",
      emails: ["sales@acme.example"],
      name: "Acme Plumbing",
      address: "1 Main St",
    });

    assert.deepEqual(keys, [
      "place:chijabc123",
      "phone:5125550100",
      "phone:5125550199",
      "email:sales@acme.example",
      "email:hello@acme.example",
      "name:acme plumbing|1 main st",
    ]);
    assert.equal(leadIdentityKey({ placeId: "ChIJABC123" }), "place:chijabc123");
  });

  it("never merges business names without an address", () => {
    assert.deepEqual(leadIdentityKeys({ name: "Starbucks" }), []);
    assert.deepEqual(leadIdentityKeys({ name: "Starbucks", address: "5 Main St" }), [
      "name:starbucks|5 main st",
    ]);
  });

  it("ignores placeholder names", () => {
    assert.deepEqual(leadIdentityKeys({ name: "Unnamed place", address: "5 Main St" }), []);
    assert.deepEqual(leadIdentityKeys({ name: "Unknown", address: "5 Main St" }), []);
  });

  it("falls back to the stored id only when no contact detail exists", () => {
    assert.deepEqual(leadIdentityKeys({ id: "lead-abc123", name: "Nameless" }), [
      "id:lead abc123",
    ]);
    assert.deepEqual(leadIdentityKeys({ id: "lead-abc123", phone: "5125550100" }), [
      "phone:5125550100",
    ]);
  });

  it("de-duplicates repeated contact keys", () => {
    const keys = leadIdentityKeys({
      phone: "5125550100",
      phones: ["(512) 555-0100", "+1 512 555 0100"],
      emails: ["a@acme.example", "A@ACME.EXAMPLE"],
    });

    assert.deepEqual(keys, ["phone:5125550100", "email:a@acme.example"]);
  });
});

describe("stableLeadId", () => {
  it("prefers a lowercased place id", () => {
    assert.equal(stableLeadId({ placeId: "ChIJabc123", name: "Acme" }), "place-chijabc123");
    assert.equal(stableLeadId({ placeId: "chijabc123", name: "Renamed" }), "place-chijabc123");
  });

  it("derives the same id from the same contact content", () => {
    const lead = {
      name: "Acme Plumbing",
      address: "1 Main St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      phones: ["(512) 555-0100"],
      emails: ["hello@acme.example"],
      website: "https://acme.example/",
      lat: 30.1,
      lng: -97.2,
    };

    assert.equal(stableLeadId(lead), stableLeadId({ ...lead }));
  });

  it("changes the id when contact details change", () => {
    const base = { name: "Acme", address: "1 Main St", postalCode: "78701" };
    assert.notEqual(stableLeadId(base), stableLeadId({ ...base, postalCode: "78702" }));
    assert.notEqual(stableLeadId(base), stableLeadId({ ...base, lat: 30.1 }));
    assert.notEqual(stableLeadId(base), stableLeadId({ ...base, lng: -97.2 }));
    assert.notEqual(stableLeadId(base), stableLeadId({ ...base, id: "legacy-1" }));
  });

  it("is deterministic even for an empty lead", () => {
    assert.match(stableLeadId(), /^lead-[a-z0-9]{13}$/);
    assert.equal(stableLeadId(), stableLeadId({}));
  });
});

describe("groupDuplicateLeads", () => {
  it("bridges duplicates across different identity fields", () => {
    const groups = groupDuplicateLeads([
      { phones: ["5125550100"] },
      { phones: ["+1 512 555 0100"], emails: ["shared@acme.example"] },
      { emails: ["SHARED@acme.example"] },
      { phones: ["5125550199"] },
    ]);

    assert.deepEqual(groups, [
      [0, 1, 2],
      [3],
    ]);
  });

  it("keeps rows without identity keys separate and preserves first-seen order", () => {
    const groups = groupDuplicateLeads([
      { name: "One" },
      { name: "Two" },
      { name: "One" },
    ]);

    assert.deepEqual(groups, [[0], [1], [2]]);
  });

  it("handles an empty array", () => {
    assert.deepEqual(groupDuplicateLeads([]), []);
  });
});

describe("dedupeLeads", () => {
  it("merges every group and reports the duplicate count", () => {
    const merged = dedupeLeads(
      [
        { placeId: "place-1", phones: ["5125550100"] },
        { placeId: "place-1" },
        { phone: "5125550199" },
        { phones: ["5125550100"] },
      ],
      (existing, incoming) => ({
        ...existing,
        phones: [...(existing.phones || []), ...(incoming.phones || [])],
      }),
    );

    assert.equal(merged.leads.length, 2);
    assert.equal(merged.duplicateCount, 2);
    assert.deepEqual(merged.leads[0].phones, ["5125550100", "5125550100"]);
    assert.deepEqual(merged.groups, [[0, 1, 3], [2]]);
  });

  it("never invents a duplicate count for unique rows", () => {
    const unique = [{ id: "a" }, { id: "b" }];
    const merged = dedupeLeads(unique, (existing) => existing);
    assert.equal(merged.leads.length, 2);
    assert.equal(merged.duplicateCount, 0);
  });

  it("catches a duplicate that only appears after a merge combines fields", () => {
    const merged = dedupeLeads(
      [
        { name: "Acme", phones: ["5125550100"] },
        { address: "1 Main St", phones: ["5125550100"] },
        { name: "Acme", address: "1 Main St" },
      ],
      (existing, incoming) => ({
        ...existing,
        name: existing.name || incoming.name,
        address: existing.address || incoming.address,
        phones: [...(existing.phones || []), ...(incoming.phones || [])],
      }),
    );

    assert.equal(merged.leads.length, 1);
    assert.equal(merged.duplicateCount, 2);
    assert.equal(merged.leads[0].name, "Acme");
    assert.equal(merged.leads[0].address, "1 Main St");
  });
});

describe("assignLeadIndexes", () => {
  it("preserves valid numbers and fills the first free slot", () => {
    const numbered = assignLeadIndexes([
      { id: "a", index: 3 },
      { id: "b" },
      { id: "c", index: 1 },
      { id: "d" },
    ]);

    assert.deepEqual(
      numbered.map((lead) => [lead.id, lead.index]),
      [
        ["a", 3],
        ["b", 2],
        ["c", 1],
        ["d", 4],
      ],
    );
  });

  it("repairs duplicate, fractional and negative numbers", () => {
    const numbered = assignLeadIndexes([
      { id: "a", index: 2 },
      { id: "b", index: 2 },
      { id: "c", index: 1.5 },
      { id: "d", index: -3 },
    ]);

    assert.deepEqual(
      numbered.map((lead) => lead.index),
      [2, 1, 3, 4],
    );
  });

  it("accepts legacy leadIndex and no fields", () => {
    const numbered = assignLeadIndexes([{ leadIndex: 7 }, { no: 2 }]);
    assert.deepEqual(
      numbered.map((lead) => lead.index),
      [7, 2],
    );
  });

  it("does not mutate the input array or leads", () => {
    const input = [{ id: "a" }];
    const numbered = assignLeadIndexes(input);

    assert.equal(input[0].index, undefined);
    assert.equal(numbered[0].index, 1);
    assert.notEqual(numbered[0], input[0]);
  });

  it("numbers an empty report without errors", () => {
    assert.deepEqual(assignLeadIndexes([]), []);
    assert.deepEqual(assignLeadIndexes(), []);
  });
});

describe("formatLeadIndex", () => {
  it("pads numbers and hides missing values", () => {
    assert.equal(formatLeadIndex({ index: 1 }), "01");
    assert.equal(formatLeadIndex({ index: 12 }), "12");
    assert.equal(formatLeadIndex({ leadIndex: 3 }), "03");
    assert.equal(formatLeadIndex({ no: 4 }), "04");
    assert.equal(formatLeadIndex({}), "—");
    assert.equal(formatLeadIndex({ index: 0 }), "—");
    assert.equal(formatLeadIndex({ index: 1.2 }), "—");
    assert.equal(formatLeadIndex(null), "—");
  });
});
