module.exports = {
  appId: 'com.qrlabel.app',
  productName: 'QRLabel',
  directories: {
    output: 'dist',
    buildResources: 'resources'
  },
  files: [
    'out/**/*'
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'resources/icon.ico'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true
  }
}
