import { spawn } from "node:child_process"
import path from "node:path"
import { app } from "electron"

const INSTALL_EVENTS = new Set(["--squirrel-install", "--squirrel-updated"])
const HANDLED_EVENTS = new Set([...INSTALL_EVENTS, "--squirrel-uninstall", "--squirrel-obsolete"])

export class SquirrelLifecycle {
  public handle(): boolean {
    if (process.platform !== "win32") return false
    const event = process.argv[1]
    if (!event || !HANDLED_EVENTS.has(event)) return false

    if (INSTALL_EVENTS.has(event)) this.runUpdate(["--createShortcut", this.executableName()])
    if (event === "--squirrel-uninstall") this.runUpdate(["--removeShortcut", this.executableName()])
    app.quit()
    return true
  }

  private runUpdate(arguments_: string[]): void {
    const updateExecutable = path.resolve(path.dirname(process.execPath), "..", "Update.exe")
    spawn(updateExecutable, arguments_, { detached: true }).unref()
  }

  private executableName(): string {
    return path.basename(process.execPath)
  }
}
