// The app shares the API contract and the play-order logic with the desktop app
// (../src/shared), so Metro has to watch that folder too.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.watchFolders = [path.resolve(__dirname, '../src/shared')]
module.exports = config
