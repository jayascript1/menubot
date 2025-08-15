const createExpoWebpackConfigAsync = require('@expo/webpack-config');
const path = require('path');

module.exports = async function (env, argv) {
  const config = await createExpoWebpackConfigAsync(env, argv);
  
  // Customize the config before returning it.
  config.resolve.alias = {
    ...config.resolve.alias,
    'react-native$': 'react-native-web',
  };

  // Add explicit MIME type handling for assets
  config.module.rules.push({
    test: /\.(png|jpe?g|gif|svg|ico)$/i,
    type: 'asset/resource',
    generator: {
      filename: 'assets/[name].[hash][ext]'
    }
  });

  // Handle null buffers more gracefully
  if (config.optimization) {
    config.optimization = {
      ...config.optimization,
      splitChunks: {
        ...(config.optimization.splitChunks || {}),
        cacheGroups: {
          ...(config.optimization.splitChunks?.cacheGroups || {}),
          default: {
            minChunks: 1,
            priority: -20,
            reuseExistingChunk: true,
          },
        },
      },
    };
  }

  // Ensure environment variables are properly injected
  if (config.plugins) {
    // Add DefinePlugin to inject environment variables
    const webpack = require('webpack');
    config.plugins.push(
      new webpack.DefinePlugin({
        'process.env.EXPO_PUBLIC_OPENAI_API_KEY': JSON.stringify(process.env.EXPO_PUBLIC_OPENAI_API_KEY),
      })
    );
  }

  // Add config.js to the entry point
  if (config.entry && Array.isArray(config.entry)) {
    config.entry.unshift(path.resolve(__dirname, 'config.js'));
  }

  return config;
};
