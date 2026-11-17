import type { Fragment } from "./fragment.js";
import { addAnnotation } from "./fragment.js";
import { createLinkAnnotationTag } from "./registry.js";

export interface HtmlImportOptions {
    /** Resolve relative links against an explicit source document URL. */
    baseUrl?: string;
}

/**
 * Import the default editor's HTML subset without dropping unsupported content.
 * Requires a browser DOM. Keep the original HTML if this function throws.
 */
export function fragmentFromHtml(
    html: string,
    options: HtmlImportOptions = {}
): Fragment {
    if (typeof html !== "string") {
        throw importError("Expected an HTML string.");
    }
    // This is a fragment API, not a document importer. The fragment parser
    // otherwise ignores document wrappers, potentially losing their metadata.
    if (/<(?:!doctype|\/?(?:html|head|body))(?=[\s>])/i.test(html)) {
        throw importError("Document-level HTML is not supported.");
    }
    const inertDocument = document.implementation.createHTMLDocument("");
    const template = inertDocument.createElement("template");
    template.innerHTML = html;
    const fragment: Fragment = { text: "", annotations: [] };
    const inlineTags: Record<string, string> = {
        STRONG: "<strong>", B: "<strong>", EM: "<em>", I: "<em>", U: "<u>"
    };

    const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE) {
            fragment.text += node.textContent;
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            throw importError("Unsupported HTML node; original content retained.");
        }
        const element = node as Element;
        if (isTrailingSentinel(element, template.content, fragment.text)) {
            return;
        }
        const tagName = element.tagName;
        const block = tagName === "P" || tagName === "DIV";
        if (!block && tagName !== "BR" && tagName !== "A" && !inlineTags[tagName]) {
            throw importError(`Unsupported element: ${tagName.toLowerCase()}.`);
        }
        for (const attribute of Array.from(element.attributes)) {
            if (tagName !== "A" || attribute.name !== "href") {
                throw importError(`Unsupported attribute: ${attribute.name}.`);
            }
        }
        if (tagName === "BR") {
            fragment.text += "\n";
            return;
        }
        if (block && fragment.text && !fragment.text.endsWith("\n")) {
            fragment.text += "\n";
        }
        const start = fragment.text.length;
        for (const child of Array.from(element.childNodes)) {
            walk(child);
        }
        const end = fragment.text.length;
        if (block) {
            // A container around paragraphs must not add an extra blank line.
            // An actually empty block still represents an empty line.
            if (end === start || !fragment.text.endsWith("\n")) {
                fragment.text += "\n";
            }
            return;
        }
        const tag = tagName === "A"
            ? linkTag(element.getAttribute("href"), options.baseUrl)
            : inlineTags[tagName];
        addAnnotation(fragment, [start, end], tag);
    };
    for (const child of Array.from(template.content.childNodes)) {
        walk(child);
    }
    return fragment;
}

function linkTag(href: string | null, baseUrl?: string): string {
    if (href === null) {
        return "<a>";
    }
    let url: URL;
    try {
        url = new URL(href, baseUrl);
    }
    catch {
        throw importError("Relative links require a valid baseUrl.");
    }
    if (!["https:", "http:", "mailto:"].includes(url.protocol)) {
        throw importError("Unsupported link protocol.");
    }
    return createLinkAnnotationTag(url.href);
}

function isTrailingSentinel(
    element: Element,
    root: DocumentFragment,
    text: string
): boolean {
    return element.tagName === "SPAN" &&
        element.getAttribute("data-cobalt-sentinel") === "true" &&
        element.attributes.length === 1 &&
        element.childNodes.length === 1 &&
        element.firstChild?.nodeType === Node.TEXT_NODE &&
        element.textContent === "\u200b" &&
        element.parentNode === root && !element.nextSibling &&
        text.endsWith("\n");
}

function importError(message: string): Error {
    return new Error("cobalt-rich-text-note/html: " + message);
}
