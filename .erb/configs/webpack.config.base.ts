/**
 * Base webpack config used across other specific configs
 */

import webpack from 'webpack';
import TsconfigPathsPlugins from 'tsconfig-paths-webpack-plugin';
import webpackPaths from './webpack.paths';
import { dependencies as externals } from '../../release/app/package.json';

const configuration: webpack.Configuration = {
  externals: [...Object.keys(externals || {})],

  stats: 'errors-only',

  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            // Remove this line to enable type checking in webpack builds
            transpileOnly: true,
            compilerOptions: {
              module: 'esnext',
            },
          },
        },
      },
      // `import x from './file.svg?raw'` is the file's text (the logo, which preload.ts puts in the page).
      {
        resourceQuery: /raw/,
        type: 'asset/source',
      },
    ],
  },

  output: {
    path: webpackPaths.srcPath,
    // https://github.com/webpack/webpack/issues/1114
    library: {
      type: 'commonjs2',
    },
    // COVERAGE=1 (midst-editor#29): name each source by its path on disk, so V8 coverage of the
    // bundle maps back to src/... files that c8 can read. Normal builds keep webpack:// names.
    ...(process.env.COVERAGE === '1'
      ? { devtoolModuleFilenameTemplate: '[absolute-resource-path]' }
      : {}),
  },

  /**
   * Determine the array of extensions that should be used to resolve modules.
   */
  resolve: {
    extensions: ['.js', '.jsx', '.json', '.ts', '.tsx'],
    modules: [webpackPaths.srcPath, 'node_modules'],
    // There is no need to add aliases here, the paths in tsconfig get mirrored
    plugins: [new TsconfigPathsPlugins()],
  },

  plugins: [
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'production',
      // View > Colours… (GitHub #119): in every build, releases included, while Midst is pre-release (Stuart's
      // decision of 12 Nov 2026). The one switch: set MIDST_COLOUR_AUDITION=false to build without it, or follow
      // src/renderer/colourAudition/README.md to remove it.
      MIDST_COLOUR_AUDITION: 'true',
    }),
  ],
};

export default configuration;
