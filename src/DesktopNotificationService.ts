import { Notification } from "electron"
import type { WebContents } from "electron"
import { io } from "socket.io-client"
import type { Socket } from "socket.io-client"
import { DESKTOP_NOTIFICATION_ADAPTER_SCRIPT } from "./DesktopNotificationAdapter.js"

interface RavenSessionDetails {
  currentUser: string
  siteName: string
  socketPort?: number
}

interface RavenChannel {
  allow_notifications?: number
  is_direct_message?: number
  member_id?: string
  name?: string
}

interface RavenMessage {
  bot?: string
  channel_id?: string
  content?: string
  file?: string
  is_bot_message?: number
  message_type?: string
  name?: string
  owner?: string
  text?: string
}

interface MessageCreatedEvent {
  channel_id?: string
  message_details?: RavenMessage
  sender?: string
}

interface UnreadThreadEvent {
  channel_id?: string
  event_type?: string
  sent_by?: string
}

interface ChannelResponse {
  message?: {
    channels?: RavenChannel[]
    dm_channels?: RavenChannel[]
  }
}

interface MessageResponse {
  message?: { messages?: RavenMessage[] }
}

const CHANNEL_REFRESH_INTERVAL = 60_000

export class DesktopNotificationService {
  private readonly channelSubscriptions = new NotificationChannelSubscriptions()
  private currentUser = ""
  private origin = ""
  private receivedMessageCount = 0
  private refreshTimer?: NodeJS.Timeout
  private socket?: Socket

  public constructor(
    private readonly contents: WebContents,
    private readonly openMessage: (path: string) => void,
  ) {}

  public async start(origin: string): Promise<void> {
    this.stop()
    this.receivedMessageCount = 0
    this.origin = origin
    await this.installAdapter()
    const sessionDetails = await this.readSessionDetails()
    if (!sessionDetails) return
    this.currentUser = sessionDetails.currentUser
    await this.connect(sessionDetails)
  }

  public stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = undefined
    this.socket?.disconnect()
    this.socket = undefined
    this.channelSubscriptions.clear()
  }

  public isConnected(): boolean {
    return this.socket?.connected === true
  }

  public isReady(): boolean {
    return this.isConnected() && this.channelSubscriptions.size > 0
  }

  public hasReceivedMessage(): boolean {
    return this.receivedMessageCount > 0
  }

  public async installAdapter(): Promise<void> {
    await this.contents.executeJavaScript(DESKTOP_NOTIFICATION_ADAPTER_SCRIPT)
  }

  private async readSessionDetails(): Promise<RavenSessionDetails | undefined> {
    const details = await this.contents.executeJavaScript(`({
      currentUser: window.frappe?.session?.user ?? window.frappe?.boot?.user?.name ?? "",
      siteName: window.frappe?.boot?.sitename ?? "",
      socketPort: window.frappe?.boot?.socketio_port,
    })`) as Partial<RavenSessionDetails>
    if (!details.currentUser || !details.siteName || details.currentUser === "Guest") return undefined
    return details as RavenSessionDetails
  }

  private async connect(sessionDetails: RavenSessionDetails): Promise<void> {
    const socket = await this.createSocket(sessionDetails)
    if (!socket || this.contents.isDestroyed()) return
    this.socket = socket
    socket.on("connect", () => {
      this.channelSubscriptions.clear()
      this.refreshChannels()
    })
    socket.on("channel_list_updated", () => this.refreshChannels())
    socket.on("message_created", (event: MessageCreatedEvent) => {
      this.receivedMessageCount += 1
      this.showNotification(event)
    })
    socket.on("raven:unread_thread_count_updated", (event: UnreadThreadEvent) => {
      this.showThreadNotification(event)
    })
    this.refreshTimer = setInterval(() => this.refreshChannels(), CHANNEL_REFRESH_INTERVAL)
  }

  private async createSocket(sessionDetails: RavenSessionDetails): Promise<Socket | undefined> {
    const cookies = await this.contents.session.cookies.get({ url: this.origin })
    if (!cookies.some(({ name }) => name === "sid")) return undefined
    const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join("; ")
    const socketOrigin = realtimeOrigin(this.origin, sessionDetails.socketPort)
    const namespace = `${socketOrigin}/${sessionDetails.siteName}`
    return io(namespace, {
      extraHeaders: { Cookie: cookieHeader, Origin: this.origin },
      reconnection: true,
      withCredentials: true,
    })
  }

  private refreshChannels(): void {
    void this.updateChannels().catch((error) => console.error("Unable to refresh notification channels", error))
  }

  private async updateChannels(): Promise<void> {
    if (!this.socket?.connected) return
    const channels = await this.fetchNotificationChannels()
    this.channelSubscriptions.sync(
      channels,
      (channelID) => this.subscribe(channelID),
      (channelID) => this.unsubscribe(channelID),
    )
  }

  private async fetchNotificationChannels(): Promise<Set<string>> {
    const url = new URL("/api/method/raven.api.raven_channel.get_all_channels", this.origin)
    url.searchParams.set("hide_archived", "false")
    const response = await this.contents.session.fetch(url.href, { credentials: "include" })
    if (!response.ok) throw new Error(`Channel request failed with ${response.status}`)
    const data = await response.json() as ChannelResponse
    const channels = [...(data.message?.channels ?? []), ...(data.message?.dm_channels ?? [])]
    return new Set(channels.filter(canNotify).map(({ name }) => name as string))
  }

  private subscribe(channelID: string): void {
    this.socket?.emit("doc_subscribe", "Raven Channel", channelID)
  }

  private unsubscribe(channelID: string): void {
    this.socket?.emit("doc_unsubscribe", "Raven Channel", channelID)
  }

  private async notify(event: MessageCreatedEvent): Promise<void> {
    const message = event.message_details
    if (!message || message.message_type === "System") return
    if (!message.is_bot_message && message.owner === this.currentUser) return
    if (!message.name || !Notification.isSupported()) return
    if (this.contents.isFocused() || !(await this.isEnabled())) return
    const notification = new Notification({
      body: notificationBody(message),
      title: await this.notificationTitle(message),
    })
    notification.on("click", () => {
      this.openMessage(`/raven/message/${encodeURIComponent(message.name as string)}`)
    })
    notification.show()
  }

  private showNotification(event: MessageCreatedEvent): void {
    void this.notify(event).catch((error) => console.error("Unable to show desktop notification", error))
  }

  private showThreadNotification(event: UnreadThreadEvent): void {
    if (!event.channel_id || event.event_type !== "new_message" || event.sent_by === this.currentUser) return
    void this.fetchLatestMessage(event.channel_id)
      .then((message) => this.showNotification({ message_details: message }))
      .catch((error) => console.error("Unable to load thread notification", error))
  }

  private async fetchLatestMessage(channelID: string): Promise<RavenMessage | undefined> {
    const url = new URL("/api/method/raven.api.chat_stream.get_messages", this.origin)
    url.searchParams.set("channel_id", channelID)
    url.searchParams.set("limit", "1")
    url.searchParams.set("update_last_visit", "false")
    const response = await this.contents.session.fetch(url.href, { credentials: "include" })
    if (!response.ok) throw new Error(`Message request failed with ${response.status}`)
    const data = await response.json() as MessageResponse
    return data.message?.messages?.[0]
  }

  private async isEnabled(): Promise<boolean> {
    return this.contents.executeJavaScript(
      "window.frappePushNotification?.isNotificationEnabled?.() === true",
    ) as Promise<boolean>
  }

  private async notificationTitle(message: RavenMessage): Promise<string> {
    const sender = message.is_bot_message ? message.bot : message.owner
    if (!sender) return "Raven"
    const key = JSON.stringify(sender)
    return this.contents.executeJavaScript(
      `window.frappe?.boot?.user_info?.[${key}]?.fullname ?? ${key}`,
    ) as Promise<string>
  }

}

export class NotificationChannelSubscriptions {
  private readonly channels = new Set<string>()

  public get size(): number {
    return this.channels.size
  }

  public clear(): void {
    this.channels.clear()
  }

  public sync(
    nextChannels: Set<string>,
    subscribe: (channelID: string) => void,
    unsubscribe: (channelID: string) => void,
  ): void {
    for (const channelID of nextChannels) {
      if (this.channels.has(channelID)) continue
      subscribe(channelID)
      this.channels.add(channelID)
    }
    for (const channelID of this.channels) {
      if (nextChannels.has(channelID)) continue
      unsubscribe(channelID)
      this.channels.delete(channelID)
    }
  }
}

export const canNotify = (channel: RavenChannel): boolean =>
  Boolean(channel.name && (channel.is_direct_message || (channel.member_id && channel.allow_notifications)))

export const realtimeOrigin = (origin: string, socketPort?: number): string => {
  const url = new URL(origin)
  if (url.port) url.port = String(socketPort ?? 9000)
  return url.origin
}

export const notificationBody = (message: RavenMessage): string => {
  if (message.message_type === "Image") return "Sent a photo"
  if (message.message_type === "File") return message.file ? `Sent a file — ${message.file}` : "Sent a file"
  if (message.message_type === "Poll") return "Sent a poll"
  return plainText(message.content ?? message.text ?? "") || "New message"
}

const plainText = (value: string): string => value
  .replace(/<[^>]*>/g, " ")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/\s+/g, " ")
  .trim()
