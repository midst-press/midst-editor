// @messageformat/parser's types import moo's Token, and moo publishes no types. tools/check-catalog.mjs uses
// the parser and tsc reads tools/ (allowJs), so without this tsc fails on a type inside node_modules. The
// shape is moo's documented token.
declare module 'moo' {
  export interface Token {
    type?: string;
    value: string;
    text: string;
    toString(): string;
    offset: number;
    lineBreaks: number;
    line: number;
    col: number;
  }
}
