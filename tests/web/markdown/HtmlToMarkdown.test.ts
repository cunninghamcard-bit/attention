import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "@web/markdown/HtmlToMarkdown";

describe("htmlToMarkdown", () => {
  it("converts headings, paragraphs, inline formatting, links, and images", () => {
    expect(
      htmlToMarkdown(`
      <h2>Title</h2>
      <p>Hello <strong>bold</strong> <em>em</em> <mark>marked</mark> <del>gone</del>.</p>
      <p><a href="https://example.com/a b(1)" title="A title">Example</a></p>
      <p><img src="https://example.com/image 1.png" alt="Alt text" title="Image title"></p>
    `),
    ).toBe(
      [
        "## Title",
        "",
        "Hello **bold** _em_ ==marked== ~~gone~~.",
        "",
        '[Example](https://example.com/a%20b\\(1\\) "A title")',
        "",
        '![Alt text](https://example.com/image%201.png "Image title")',
      ].join("\n"),
    );
  });

  it("converts lists, task checkboxes, blockquotes, and fenced code", () => {
    expect(
      htmlToMarkdown(`
      <ul>
        <li><input type="checkbox" checked> Done</li>
        <li><input type="checkbox"> Todo</li>
      </ul>
      <blockquote><p>Quoted</p><p></p><p>Again</p></blockquote>
      <pre><code class="language-ts">const x = 1;</code></pre>
    `),
    ).toBe(
      [
        "- [x]  Done",
        "- [ ]  Todo",
        "",
        "> Quoted",
        "> Again",
        "",
        "```ts",
        "const x = 1;",
        "```",
      ].join("\n"),
    );
  });

  it("uses the original lowercase highlight language matcher", () => {
    expect(
      htmlToMarkdown(`
      <div class="highlight-source-ts"><pre><code>const x = 1;</code></pre></div>
      <div class="highlight-source-TSX"><pre><code>const y = 2;</code></pre></div>
      <div class="highlight-source-js"><p>caption</p><pre><code>const z = 3;</code></pre></div>
    `),
    ).toBe(
      [
        "```ts",
        "const x = 1;",
        "```",
        "",
        "```",
        "const y = 2;",
        "```",
        "",
        "caption",
        "",
        "```",
        "const z = 3;",
        "```",
      ].join("\n"),
    );
  });

  it("converts tables with header alignment and escapes pipes in cells", () => {
    expect(
      htmlToMarkdown(`
      <table>
        <thead>
          <tr><th align="left">A</th><th align="right">B</th></tr>
        </thead>
        <tbody>
          <tr><td>x|y</td><td>z</td></tr>
        </tbody>
      </table>
    `),
    ).toBe(["|A|B|", "|:--|--:|", "|x\\|y|z|"].join("\n"));
  });

  it("does not include nested table rows in the parent table conversion", () => {
    expect(
      htmlToMarkdown(`
      <table>
        <tr>
          <td>outer</td>
          <td>
            <table><tr><td>inner</td></tr></table>
          </td>
        </tr>
      </table>
    `),
    ).toBe(["|   |   |", "|---|---|", "|outer|\\|   \\|<br>\\|---\\|<br>\\|inner\\||"].join("\n"));
  });

  it("does not escape markdown syntax in plain text", () => {
    expect(htmlToMarkdown("<p>*literal* [link]</p>")).toBe("*literal* [link]");
  });
});
