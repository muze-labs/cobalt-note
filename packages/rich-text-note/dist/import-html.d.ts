import type { Fragment } from "./fragment.js";
export interface HtmlImportOptions {
    /** Resolve relative links against an explicit source document URL. */
    baseUrl?: string;
}
/**
 * Import the default editor's HTML subset without dropping unsupported content.
 * Requires a browser DOM. Keep the original HTML if this function throws.
 */
export declare function fragmentFromHtml(html: string, options?: HtmlImportOptions): Fragment;
