const ClosurePlugin = require('@ngageoint/closure-webpack-plugin');
const path = require('path');

const buildDir = path.resolve(__dirname, '.build');
const gccOptions = require(path.join(buildDir, 'gcc-webpack'));

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production' || !argv.mode;
  const depsFile = path.join(buildDir, 'deps.js');

  return {
    entry: [
      path.join(buildDir, 'index.js')
    ],
    output: {
      path: buildDir,
      filename: isProduction ? 'opensphere.min.js' : 'opensphere.js'
    },
    devtool: isProduction ? 'source-map' : 'eval',
    module: {
      rules: [
        {
          test: /\.(html|svelte)$/,
          exclude: /node_modules/,
          use: {
            loader: 'svelte-loader',
            options: {
              hotReload: true
            }
          }
        }
      ]
    },
    optimization: {
      minimize: isProduction,
      minimizer: [
        new ClosurePlugin({
          mode: 'AGGRESSIVE_BUNDLE',
          platform: 'java'
        }, gccOptions)
      ],
      concatenateModules: false,
      splitChunks: {
        minSize: 0
      }
    },
    performance: {
      // In production, warn if the asset size exceeds 5MB
      hints: isProduction ? 'warning' : false,
      maxAssetSize: 5000000,
      maxEntrypointSize: 5000000
    },
    plugins: [
      new ClosurePlugin.LibraryPlugin({
        closureLibraryBase: require.resolve('google-closure-library/closure/goog/base'),
        deps: [
          require.resolve('google-closure-library/closure/goog/deps'),
          depsFile
        ]
      })
    ],
    resolve: {
      alias: {
        svelte: path.resolve('../../node_modules', 'svelte')
      },
      extensions: ['.mjs', '.js', '.svelte'],
      mainFields: ['svelte', 'browser', 'module', 'main']
    },
    watch: !isProduction
  };
};
