/* eslint-disable no-unused-vars -- a copy of a published declaration file */
// @tiptap/html/server exists only in the package's `exports`, which this project's "node" module resolution does not
// read. These are its declarations (dist/server/index.d.cts, TipTap 3.32.0). A tsconfig `paths` entry would also
// redirect webpack, through tsconfig-paths-webpack-plugin, to the .d.cts.
declare module '@tiptap/html/server' {
  import type { Extensions, JSONContent } from '@tiptap/core';
  import type { ParseOptions } from '@tiptap/pm/model';

  export function generateHTML(
    doc: JSONContent,
    extensions: Extensions
  ): string;
  export function generateJSON(
    html: string,
    extensions: Extensions,
    options?: ParseOptions
  ): Record<string, any>;
}
