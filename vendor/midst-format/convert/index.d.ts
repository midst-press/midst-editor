export declare const getFileVersion: (data: string) => string;
export declare const stripVersionInfo: (data: string) => string;
export declare const includeVersionInfo: (data: string) => string;
export declare const fileVersionMatchesCurrent: (data: string) => boolean;
export declare const asBrowserParsed: (html: string) => string;
export declare const dropTrailingBreaks: (html: string) => string;
export declare const ZERO_WIDTH_CHARS = "\\uFEFF\\u200B\\u200C\\u200D\\u2060";
export declare const dropZeroWidthOnlyElements: (html: string) => string;
export declare const dropInvisibleParagraphs: (html: string) => string;
/**
 * Format B's per-poem presentation, as format C's `meta` (midst-format docs/META.md). Each field
 * is copied unchanged; a field B does not have is left out, so the reader's default applies.
 */
export declare const metaFromOldMidst: (old?: Record<string, unknown>) => Record<string, unknown>;
/**
 * The file body the editor saves. `meta` is the stored JSON string ('' when the document has
 * none) and every key is written back unchanged, unknown keys included, so a save never loses one,
 * except `author`, which a save drops (#181).
 */
export declare const serializeDocument: (text: string, history: string, meta: string) => string;
export declare const convertMidstFile: (oldMidst: string) => string;
