/* @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { fragmentFromHtml, render } from "../src/index.js";

describe("HTML fragment import", () => {
    it("preserves whitespace, entities and UTF-16 formatting ranges", () => {
        const result = fragmentFromHtml(" \nA &amp; <b>😀é</b> <i>x</i> ");
        expect(result.text).toBe(" \nA & 😀é x ");
        expect(result.annotations).toEqual([
            { range: [6, 9], tag: "<strong>", order: 1 },
            { range: [10, 11], tag: "<em>", order: 2 }
        ]);
    });

    it("represents blocks and line breaks without adding container blank lines", () => {
        expect(fragmentFromHtml("<div><p>one<br>two</p><p></p><p>three</p></div>").text)
            .toBe("one\ntwo\n\nthree\n");
        expect(fragmentFromHtml("<p></p><p></p>").text).toBe("\n\n");
    });

    it("round trips renderer output including its terminal sentinel", () => {
        const original = {
            text: "hello 😀\n",
            annotations: [
                { range: [0, 8] as [number, number], tag: "<strong>", order: 1 },
                { range: [6, 8] as [number, number], tag: "<u>", order: 2 }
            ]
        };
        const html = render(original);
        expect(render(fragmentFromHtml(html))).toBe(html);
        expect(fragmentFromHtml(html).text).toBe(original.text);
    });

    it("preserves link boundaries and escapes their attributes", () => {
        const result = fragmentFromHtml('<a href="https://example.org/?a=1&amp;b=2">a<strong>b</strong>c</a>');
        expect(render(result)).toBe('<a href="https://example.org/?a=1&amp;b=2">a<strong>b</strong>c</a>');
        expect(render(fragmentFromHtml('<a>text</a>'))).toBe('<a>text</a>');
        expect(render(fragmentFromHtml('<a href="../page">text</a>', { baseUrl: 'https://example.org/dir/note' })))
            .toBe('<a href="https://example.org/page">text</a>');
    });

    it.each([
        '<img src="https://example.org/a.png">', '<script>alert(1)</script>',
        '<table><tr><td>data</td></tr></table>', '<strong class="extra">x</strong>',
        '<p style="color:red">x</p>', '<a href="javascript:alert(1)">x</a>',
        '<a href="relative">x</a>', '<!-- metadata -->text',
        '<!doctype html><html><body>x</body></html>', '<body lang="en">x</body>',
        '<span data-cobalt-sentinel="true">\u200b</span>',
        '\n<span data-cobalt-sentinel="true" title="keep">\u200b</span>',
        '\n<span data-cobalt-sentinel="true">\u200b</span>more'
    ])("refuses unsupported content instead of discarding it: %s", (html) => {
        expect(() => fragmentFromHtml(html)).toThrow('cobalt-rich-text-note/html:');
    });
});
