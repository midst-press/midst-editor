/* eslint-disable no-use-before-define, no-unused-vars -- a copy of a published declaration file */
// @lingui/core 5's types import this subpath, which publishes its types only through `exports`, and
// this project's node10 module resolution cannot follow `exports`. These are its declarations,
// copied from @lingui/message-utils 5.9.5 (dist/compileMessage.d.mts). Remove this file when the
// editor moves to Lingui 6 (midst-infra #110), which needs that resolution changed anyway.
declare module '@lingui/message-utils/compileMessage' {
  type CompiledIcuChoices = Record<string, CompiledMessage> & {
    offset: number | undefined;
  };
  type CompiledMessageToken =
    | string
    | [
        name: string,
        type?: string,
        format?: null | string | unknown | CompiledIcuChoices
      ];
  type CompiledMessage = CompiledMessageToken[];
  type MapTextFn = (value: string) => string;
  function compileMessageOrThrow(
    message: string,
    mapText?: MapTextFn
  ): CompiledMessage;
  function compileMessage(
    message: string,
    mapText?: MapTextFn
  ): CompiledMessage;
  export {
    CompiledIcuChoices,
    CompiledMessage,
    CompiledMessageToken,
    compileMessage,
    compileMessageOrThrow,
  };
}
