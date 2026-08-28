import { describe, expect, it } from "vitest"
import { canNotify, notificationBody, realtimeOrigin } from "../src/DesktopNotificationService.js"

describe("desktop notification service", () => {
  it("subscribes to direct messages and opted-in member channels", () => {
    expect(canNotify({ name: "dm", is_direct_message: 1 })).toBe(true)
    expect(canNotify({ name: "general", member_id: "member", allow_notifications: 1 })).toBe(true)
    expect(canNotify({ name: "muted", member_id: "member", allow_notifications: 0 })).toBe(false)
    expect(canNotify({ name: "open", allow_notifications: 1 })).toBe(false)
  })

  it("turns Raven message content into native notification text", () => {
    expect(notificationBody({ content: "<p>Hello &amp; welcome</p>" })).toBe("Hello & welcome")
    expect(notificationBody({ message_type: "Image" })).toBe("Sent a photo")
  })

  it("uses the bench socket port only for local origins", () => {
    expect(realtimeOrigin("http://raven.localhost:8002", 9002)).toBe("http://raven.localhost:9002")
    expect(realtimeOrigin("https://raven.example.com", 9002)).toBe("https://raven.example.com")
  })
})
