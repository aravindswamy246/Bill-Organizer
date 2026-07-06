// Only needed by Jest (jest-expo) — Metro bundles the app fine without an
// explicit babel.config.js on this Expo SDK, but Jest's babel-jest
// transformer needs one to find babel-preset-expo.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
