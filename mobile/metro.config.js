// The app shares the API contract and the play-order logic with the desktop app
// (../src/shared), so Metro has to watch that folder too.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.watchFolders = [path.resolve(__dirname, '../src/shared')]
// Packages for that shared code (e.g. Babel helpers) come from this app's node_modules.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]
module.exports = config
