import { describe, expect, it } from "vitest";
import { localToUtc, utcToLocal, addDays } from "@/lib/time";
import { htmlToText, textToHtml } from "@/lib/notes";
import { activityToRemote, patchToActivity } from "@/lib/sync/pipedrive";
import { detectColumns, itemToRemote, patchToCells } from "@/lib/sync/slack";

describe("time", () => {
  it("converts UTC to Melbourne (AEDT, +11)", () => {
    expect(utcToLocal("2026-11-04", "23:30")).toEqual({ date: "2026-11-05", time: "10:30" });
  });
  it("converts Melbourne to UTC (AEST, +10)", () => {
    expect(localToUtc("2026-07-01", "09:00")).toEqual({ date: "2026-06-30", time: "23:00" });
  });
  it("round-trips", () => {
    const u = localToUtc("2026-11-05", "08:15");
    expect(utcToLocal(u.date, u.time)).toEqual({ date: "2026-11-05", time: "08:15" });
  });
  it("adds days", () => expect(addDays("2026-12-31", 1)).toBe("2027-01-01"));
});

describe("notes", () => {
  it("strips Pipedrive HTML but keeps link URLs", () => {
    const html =
      '*From:* Paul\n\n<a href="https://x.com/a?b=1&amp;c=2" rel="noopener">https://x.com/a?b=1&amp;c=2</a>';
    expect(htmlToText(html)).toBe("*From:* Paul\n\nhttps://x.com/a?b=1&c=2");
  });
  it("keeps link text when it differs from URL", () => {
    expect(htmlToText('<a href="https://x.com">Site</a>')).toBe("Site (https://x.com)");
  });
  it("encodes text as HTML with links", () => {
    expect(textToHtml("a < b\nhttps://x.com")).toBe(
      'a &lt; b<br><a href="https://x.com" rel="noopener noreferrer" target="_blank">https://x.com</a>',
    );
  });
});

describe("pipedrive mapping", () => {
  const ctx = {
    deals: new Map([[7, { id: 7, title: "Big deal" }]]),
    persons: new Map([[9, { id: 9, name: "Sam", emails: [{ value: "s@x.com", primary: true }], phones: [{ value: "123\u202c" }, { value: "" }] }]]),
    orgs: new Map([[3, { id: 3, name: "Acme" }]]),
  };
  it("maps activity with context and converts time", () => {
    const r = activityToRemote(
      {
        id: 1, subject: "Call Sam", type: "call", owner_id: 1, update_time: "2026-11-01T00:00:00Z",
        deal_id: 7, person_id: 9, org_id: 3, due_date: "2026-11-04", due_time: "22:00", done: false, note: null,
      },
      ctx,
      "acme",
    );
    expect(r).toMatchObject({
      externalId: "1", dueDate: "2026-11-05", dueTime: "09:00", externalUrl: "https://acme.pipedrive.com/deal/7",
      context: { type: "call", deal: { title: "Big deal" }, person: { name: "Sam", emails: ["s@x.com"], phones: ["123"] }, org: { name: "Acme" } },
    });
  });
  it("builds a patch with UTC time", () => {
    expect(patchToActivity({ dueDate: "2026-11-05", dueTime: "09:00", done: true })).toEqual({
      due_date: "2026-11-04", due_time: "22:00", done: true,
    });
  });
  it("clears time when only a date is set", () => {
    expect(patchToActivity({ dueDate: "2026-11-05", dueTime: null })).toEqual({ due_date: "2026-11-05", due_time: null });
  });
});

describe("slack mapping", () => {
  const schema = [
    { id: "Col1", key: "name", name: "Name", type: "text", is_primary_column: true },
    { id: "Col2", key: "todo_completed", name: "Completed", type: "todo_completed" },
    { id: "Col3", key: "todo_due_date", name: "Due date", type: "todo_due_date" },
    { id: "Col4", key: "notes", name: "Notes", type: "rich_text" },
  ];
  it("detects columns", () => {
    expect(detectColumns(schema)).toEqual({ title: "Col1", done: "Col2", due: "Col3", notes: "Col4" });
  });
  it("honours overrides", () => {
    expect(detectColumns(schema, { notes: "ColX" }).notes).toBe("ColX");
  });
  it("maps an item", () => {
    const cols = detectColumns(schema);
    const r = itemToRemote(
      {
        id: "Rec1", updated_timestamp: "1793750400",
        fields: [
          { column_id: "Col1", text: "Write spec" },
          { column_id: "Col2", checkbox: true },
          { column_id: "Col3", date: ["2026-11-06"] },
        ],
      },
      cols,
    );
    expect(r).toMatchObject({ externalId: "Rec1", title: "Write spec", done: true, dueDate: "2026-11-06", notes: "" });
  });
  it("builds update cells", () => {
    const cells = patchToCells("Rec1", { done: true, dueDate: null }, detectColumns(schema));
    expect(cells).toEqual([
      { row_id: "Rec1", column_id: "Col2", checkbox: true },
      { row_id: "Rec1", column_id: "Col3", date: [] },
    ]);
  });
});
