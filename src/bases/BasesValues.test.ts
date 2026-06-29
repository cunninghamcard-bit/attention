import { describe, expect, it } from "vitest";
import { App } from "../app/App";
import { RenderContext } from "../markdown/RenderContext";
import {
  BooleanValue,
  DateValue,
  DurationValue,
  FileValue,
  HTMLValue,
  IconValue,
  ImageValue,
  LinkValue,
  ListValue,
  NullValue,
  NumberValue,
  ObjectValue,
  RegExpValue,
  RelativeDateValue,
  StringValue,
  TagValue,
  UrlValue,
  Value,
  valueFromUnknown,
} from "./BasesValues";

describe("Bases Value model", () => {
  it("matches core equality, truthiness, and primitive conversion semantics", () => {
    expect(NullValue.value.toString()).toBe("");
    expect(NullValue.value.isTruthy()).toBe(false);
    expect(Value.equals(NullValue.value, NullValue.value)).toBe(true);
    expect(Value.equals(new StringValue("1"), new StringValue("1"))).toBe(true);
    expect(Value.equals(new StringValue("1"), new NumberValue(1))).toBe(false);
    expect(Value.looseEquals(new StringValue("1"), new NumberValue(1))).toBe(true);
    expect(new BooleanValue(false).isTruthy()).toBe(false);
    expect(new UrlValue("https://example.com").toString()).toBe("https://example.com");
    expect(valueFromUnknown(null)).toBe(NullValue.value);
    expect(valueFromUnknown(true)).toBeInstanceOf(BooleanValue);
  });

  it("parses and renders link values as internal links", () => {
    const app = new App(document.createElement("div"));
    const link = LinkValue.parseFromString(app, "[[Target#Heading|Shown]]", "Source.md");
    const host = document.createElement("div");

    expect(link).toBeInstanceOf(LinkValue);
    expect(link?.toString()).toBe("Target#Heading");

    link?.renderTo(host, new RenderContext(app, "Source.md", host));

    const linkEl = host.querySelector<HTMLElement>(".internal-link");
    expect(linkEl?.dataset.href).toBe("Target#Heading");
    expect(linkEl?.dataset.sourcePath).toBe("Source.md");
    expect(linkEl?.textContent).toBe("Shown");
    expect(LinkValue.parseFromString(app, "Target", "Source.md")).toBeNull();
  });

  it("supports date parsing, date-only conversion, list laziness, and object access", () => {
    const date = DateValue.parseFromString("2026-06-25T12:30:00Z");
    const list = new ListValue(["alpha", 2, null]);
    const object = new ObjectValue({ name: "Bases", count: 2 });

    expect(date?.toString()).toBe("2026-06-25T12:30:00Z");
    expect(date?.dateOnly().toString()).toBe("2026-06-25");
    expect(date?.isTruthy()).toBe(true);
    expect(DateValue.parseFromString("not a date")).toBeNull();

    expect(list.length()).toBe(3);
    expect(list.get(0)).toBeInstanceOf(StringValue);
    expect(list.get(99)).toBe(NullValue.value);
    expect(list.includes(new NumberValue(2))).toBe(true);
    expect(list.concat(new ListValue(["omega"])).toString()).toBe("alpha, 2, , omega");

    expect(object.isEmpty()).toBe(false);
    expect(object.get("name")).toBeInstanceOf(StringValue);
    expect(object.get("missing")).toBe(NullValue.value);
  });

  it("covers Obsidian 1.10 Bases value subclasses", () => {
    const date = new DateValue(new Date("2026-06-25T00:00:00Z"));
    const duration = DurationValue.parseFromString("P1DT2H3M4S");

    expect(new HTMLValue("<strong>Hi</strong>").toString()).toBe("<strong>Hi</strong>");
    expect(new IconValue("lucide-star").toString()).toBe("lucide-star");
    expect(new ImageValue("Assets/image.png").toString()).toBe("Assets/image.png");
    expect(new TagValue("#project").toString()).toBe("#project");
    expect(new FileValue("Notes/Today.md").isTruthy()).toBe(true);
    expect(new RegExpValue(/hello/i).toString()).toBe("/hello/i");
    expect(valueFromUnknown(/hello/i)).toBeInstanceOf(RegExpValue);
    expect(duration?.getMilliseconds()).toBe(93784000);
    expect(duration?.toString()).toBe("P1DT2H3M4S");
    expect(DurationValue.fromMilliseconds(0).isTruthy()).toBe(false);
    expect(duration?.addToDate(date).toString()).toBe("2026-06-26T02:03:04Z");
    expect(new RelativeDateValue(new Date()).toString()).toBe("today");
  });
});
