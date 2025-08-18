const createExpoWebpackConfigAsync = require('@expo/webpack-config');

module.exports = async function (env, argv) {
  const config = await createExpoWebpackConfigAsync(env, argv);
  
  // Customize the config before returning it.
  config.resolve.alias = {
    ...config.resolve.alias,
    'react-native$': 'react-native-web',
  };

  // Ensure environment variables are properly injected for all browsers
  if (config.plugins) {
    const webpack = require('webpack');
    config.plugins.push(
      new webpack.DefinePlugin({
        'process.env.EXPO_PUBLIC_OPENAI_API_KEY': JSON.stringify(process.env.EXPO_PUBLIC_OPENAI_API_KEY),
        // Also inject it into the global scope for browser compatibility
        'globalThis.EXPO_PUBLIC_OPENAI_API_KEY': JSON.stringify(process.env.EXPO_PUBLIC_OPENAI_API_KEY),
        'window.EXPO_PUBLIC_OPENAI_API_KEY': JSON.stringify(process.env.EXPO_PUBLIC_OPENAI_API_KEY),
      })
    );
  }

  return config;
};
