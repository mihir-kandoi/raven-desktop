import { webFrame } from "electron"
import { DESKTOP_NOTIFICATION_ADAPTER_SCRIPT } from "./DesktopNotificationAdapter.js"

void webFrame.executeJavaScript(DESKTOP_NOTIFICATION_ADAPTER_SCRIPT).catch((error) => {
  console.error("Unable to preload desktop notification adapter", error)
})
