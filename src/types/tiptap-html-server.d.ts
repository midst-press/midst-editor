/* eslint-disable no-unused-vars, import/prefer-default-export -- a copy of a published declaration */
// @tiptap/html/server exists only in the package's `exports`, which this project's "node" module resolution does not
// read. This is the one function the editor uses, as dist/server/index.d.cts declares it (TipTap 3.32.0). skipLibCheck
// skips this file and nothing compares it with the package's; rtf.test.ts and findInText.test.ts check the behaviour. A tsconfig `paths` entry would also
// redirect webpack, through tsconfig-paths-webpack-plugin, to the .d.cts.
declare module '@tiptap/html/server' {
  import type { Extensions } from '@tiptap/core';
  import type { ParseOptions } from '@tiptap/pm/model';

  export function generateJSON(
    html: string,
    extensions: Extensions,
    options?: ParseOptions
  ): Record<string, any>;
}
