// Which poem a development build exports as video, and where to (#506).

export interface ExportJob {
  input: string;
  output: string;
}

// `built` is the build-time switch MIDST_EXPORT_VIDEO (webpack.config.base.ts): a build without it has no export
// page to answer, and carries no Mediabunny.
export const exportJobFromEnv = (
  isPackaged: boolean,
  built: boolean,
  env: NodeJS.ProcessEnv
): ExportJob | null => {
  if (isPackaged || !built) return null;
  const input = env.MIDST_EXPORT_VIDEO_IN;
  const output = env.MIDST_EXPORT_VIDEO_OUT;
  return input && output ? { input, output } : null;
};
