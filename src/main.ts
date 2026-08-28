import { DesktopApplication } from "./DesktopApplication.js"
import { registerShellScheme } from "./shellProtocol.js"

registerShellScheme()

const startApplication = async (): Promise<void> => {
  if (process.argv.includes("--raven-electron-smoke")) {
    const { ElectronSmokeApplication } = await import("./ElectronSmokeApplication.js")
    return new ElectronSmokeApplication().start()
  }
  new DesktopApplication().start()
}

void startApplication()
