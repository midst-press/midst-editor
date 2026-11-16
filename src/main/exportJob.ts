// Which poem a development build exports as video, and where to (#506).

export interface ExportJob {
  input: string;
  output: string;
}

export const exportJobFromEnv = (
  isPackaged: boolean,
  env: NodeJS.ProcessEnv
): ExportJob | null => {
  if (isPackaged) return null;
  const input = env.MIDST_EXPORT_VIDEO_IN;
  const output = env.MIDST_EXPORT_VIDEO_OUT;
  return input && output ? { input, output } : null;
};
