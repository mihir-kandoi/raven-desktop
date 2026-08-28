const { mkdtempSync, readFileSync, rmSync } = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

class ElectronSmokeLauncher {
  constructor() {
    this.temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "raven-electron-launcher-"))
    this.resultPath = path.join(this.temporaryDirectory, "result.json")
  }

  run() {
    const result = spawnSync(require("electron"), [path.resolve(__dirname, ".."), "--raven-electron-smoke"], {
      env: {
        ...process.env,
        RAVEN_ELECTRON_PROFILE_PATH: path.join(this.temporaryDirectory, "profile"),
        RAVEN_ELECTRON_RESULT_PATH: this.resultPath,
      },
      stdio: "inherit",
    })
    const exitCode = this.readExitCode(result)
    rmSync(this.temporaryDirectory, { recursive: true, force: true })
    return exitCode
  }

  readExitCode(result) {
    if (result.error) throw result.error
    try {
      return JSON.parse(readFileSync(this.resultPath, "utf8")).exitCode
    } catch {
      return result.status || 1
    }
  }
}

process.exitCode = new ElectronSmokeLauncher().run()
