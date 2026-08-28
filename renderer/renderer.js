class ShellRenderer {
  constructor(bridge) {
    this.bridge = bridge
    this.state = null
    this.shell = document.querySelector("#shell")
    this.siteButtons = document.querySelector("#site-buttons")
    this.savedSiteList = document.querySelector("#saved-site-list")
    this.siteForm = document.querySelector("#site-form")
    this.siteInput = document.querySelector("#site-url")
    this.addSiteButton = document.querySelector("#add-site-button")
    this.formMessage = document.querySelector("#form-message")
  }

  async start() {
    document.addEventListener("click", (event) => this.handleClick(event))
    this.siteForm.addEventListener("submit", (event) => this.addSite(event))
    this.bridge.onStateChanged((state) => this.render(state))
    this.render(await this.bridge.getState())
  }

  render(state) {
    this.state = state
    document.documentElement.dataset.theme = state.preferences.appearance
    document.documentElement.dataset.density = state.preferences.railDensity
    this.shell.classList.toggle("manager-open", state.managerOpen)
    this.shell.classList.toggle("no-sites", state.sites.length === 0)
    this.renderSiteButtons()
    this.renderSavedSites()
    this.renderSettings()
  }

  renderSiteButtons() {
    this.siteButtons.replaceChildren(...this.state.sites.map((site) => {
      const button = this.button("site-button", site.name, "select-site", site.id)
      button.setAttribute("aria-current", String(site.id === this.state.activeSiteID))
      button.setAttribute("aria-label", site.name)
      button.replaceChildren(this.siteIcon(site), this.statusDot(site), ...this.badge(site))
      return button
    }))
  }

  renderSavedSites() {
    document.querySelector("#saved-sites-caption").textContent = this.state.sites.length
      ? "Choose a site to open it."
      : "No sites are saved yet."
    this.savedSiteList.replaceChildren(...this.state.sites.map((site) => this.savedSiteRow(site)))
  }

  renderSettings() {
    document.querySelectorAll("[data-setting]").forEach((control) => {
      const setting = control.dataset.setting === "appearance"
        ? this.state.preferences.appearance
        : this.state.preferences.railDensity
      control.querySelectorAll("button").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.value === setting))
      })
    })
  }

  savedSiteRow(site) {
    const row = document.createElement("div")
    row.className = "saved-site-row"

    const details = document.createElement("div")
    details.className = "saved-site-details"
    const name = document.createElement("strong")
    name.textContent = site.name
    const origin = document.createElement("span")
    origin.textContent = site.origin
    details.append(name, origin)

    const open = this.button("text-button", "Open", "select-site", site.id)
    const remove = this.button("text-button danger", "Remove", "remove-site", site.id)
    row.append(this.savedSiteIcon(site), details, open, remove)
    return row
  }

  savedSiteIcon(site) {
    const icon = document.createElement("div")
    icon.className = "saved-site-icon"
    icon.append(this.siteIcon(site))
    return icon
  }

  siteIcon(site) {
    const fallback = document.createElement("span")
    fallback.textContent = site.name.trim().slice(0, 1).toUpperCase() || "R"
    if (!site.iconUrl) return fallback

    const image = document.createElement("img")
    image.src = siteIconSource(site.iconUrl)
    image.alt = ""
    image.addEventListener("error", () => image.replaceWith(fallback), { once: true })
    return image
  }

  statusDot(site) {
    const dot = document.createElement("span")
    dot.className = "status-dot"
    dot.dataset.status = this.state.runtimeBySite[site.id]?.status ?? "idle"
    return dot
  }

  badge(site) {
    const count = this.state.runtimeBySite[site.id]?.unreadCount ?? 0
    if (!count) return []
    const badge = document.createElement("span")
    badge.className = "site-badge"
    badge.textContent = count > 99 ? "99+" : String(count)
    return [badge]
  }

  button(className, label, action, siteID) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = className
    button.textContent = label
    button.title = label
    button.dataset.action = action
    if (siteID) button.dataset.siteId = siteID
    return button
  }

  async handleClick(event) {
    const button = event.target.closest("button")
    if (!button) return
    const { action, siteId: siteID } = button.dataset
    if (action === "show-manager") return this.bridge.setManagerOpen(true)
    if (action === "close-manager") return this.bridge.setManagerOpen(false)
    if (action === "select-site" && siteID) return this.bridge.selectSite(siteID)
    if (action === "remove-site" && siteID) return this.removeSite(siteID)

    const setting = button.closest("[data-setting]")?.dataset.setting
    if (setting === "appearance") return this.bridge.setAppearance(button.dataset.value)
    if (setting === "rail-density") return this.bridge.setRailDensity(button.dataset.value)
  }

  async addSite(event) {
    event.preventDefault()
    this.setSubmitting(true)
    try {
      await this.bridge.addSite(this.siteInput.value)
      this.siteInput.value = ""
      this.formMessage.textContent = ""
    } catch (error) {
      this.formMessage.textContent = error instanceof Error ? error.message : "Raven could not add this site."
    } finally {
      this.setSubmitting(false)
    }
  }

  async removeSite(siteID) {
    const site = this.state.sites.find(({ id }) => id === siteID)
    if (!site || !window.confirm(`Remove ${site.name} from this device?`)) return
    await this.bridge.removeSite(siteID)
  }

  setSubmitting(submitting) {
    this.addSiteButton.disabled = submitting
    this.addSiteButton.textContent = submitting ? "Checking…" : "Add site"
  }
}

const siteIconSource = (iconUrl) => {
  try {
    const path = new URL(iconUrl).pathname
    return path === "/assets/raven/raven-logo.png" ? "raven.svg" : iconUrl
  } catch {
    return iconUrl
  }
}

new ShellRenderer(window.ravenDesktop).start()
