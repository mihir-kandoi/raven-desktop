import path from "node:path"
import { pathToFileURL } from "node:url"
import { app, net, protocol } from "electron"

const SHELL_SCHEME = "raven-shell"

export const registerShellScheme = (): void => {
  protocol.registerSchemesAsPrivileged([{
    scheme: SHELL_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  }])
}

export const handleShellProtocol = (): void => {
  const rendererDirectory = path.join(app.getAppPath(), "renderer")
  protocol.handle(SHELL_SCHEME, async (request) => {
    const requestedPath = new URL(request.url).pathname.replace(/^\/+/, "") || "index.html"
    const filePath = path.resolve(rendererDirectory, requestedPath)
    if (!filePath.startsWith(`${rendererDirectory}${path.sep}`)) {
      return new Response("Not found", { status: 404 })
    }
    return withoutCache(await net.fetch(pathToFileURL(filePath).href))
  })
}

export const shellUrl = (fileName: string): string => `${SHELL_SCHEME}://app/${fileName}`

const withoutCache = (response: Response): Response => {
  const headers = new Headers(response.headers)
  headers.set("Cache-Control", "no-store")
  return new Response(response.body, { status: response.status, headers })
}
