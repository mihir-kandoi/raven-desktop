const path = require("node:path")
const { FusesPlugin } = require("@electron-forge/plugin-fuses")
const { FuseVersion, FuseV1Options } = require("@electron/fuses")

const assets = path.resolve(__dirname, "assets")
const platformIcon = {
  darwin: path.join(assets, "Raven.icns"),
  win32: path.join(assets, "Raven.ico"),
  linux: path.join(assets, "Raven.png"),
}[process.platform]

module.exports = {
  packagerConfig: {
    asar: true,
    // The main process bundle includes all runtime dependencies.
    prune: false,
    ignore: [
      /^\/node_modules(?:\/|$)/,
      /^\/src(?:\/|$)/,
      /^\/scripts(?:\/|$)/,
      /^\/tests(?:\/|$)/,
      /^\/README\.md$/,
      /^\/tsconfig\.json$/,
      /^\/forge\.config\.cjs$/,
      /^\/\.desktop-build\/ElectronSmokeApplication\.js$/,
    ],
    icon: platformIcon,
    executableName: "Raven",
    appBundleId: "com.thecommitcompany.raven",
    appCategoryType: "public.app-category.social-networking",
    osxSign: {
      identity: process.env.RAVEN_MACOS_SIGNING_IDENTITY || "-",
      identityValidation: false,
      optionsForFile: () => ({
        hardenedRuntime: false,
        timestamp: "none",
      }),
    },
    protocols: [{ name: "Raven", schemes: ["raven"] }],
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "Raven",
        authors: "The Commit Company",
        setupIcon: path.join(assets, "Raven.ico"),
      },
    },
    { name: "@electron-forge/maker-zip", platforms: ["darwin"] },
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: { icon: path.join(assets, "Raven.icns") },
    },
    {
      name: "@electron-forge/maker-deb",
      platforms: ["linux"],
      config: { options: { bin: "Raven", categories: ["Network", "Chat"] } },
    },
    {
      name: "@electron-forge/maker-rpm",
      platforms: ["linux"],
      config: { options: { bin: "Raven", categories: ["Network", "Chat"] } },
    },
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    }),
  ],
}
