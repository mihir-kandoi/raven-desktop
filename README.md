# Raven Desktop

Raven Desktop puts one or more Raven sites in one native window. Each site keeps a separate login session.

## Raven source link

The `raven` directory is a Git submodule. It points to the `develop` branch of [`mihir-kandoi/raven`](https://github.com/mihir-kandoi/raven). That repository is a fork of [`frappe/raven`](https://github.com/frappe/raven).

The submodule pins one Raven commit. This makes each desktop build and integration test reproducible.

Clone both repositories with this command:

```sh
git clone --recurse-submodules https://github.com/mihir-kandoi/raven-desktop.git
```

Update the pinned Raven commit with these commands:

```sh
yarn raven:update
git add raven
git commit -m "chore: update Raven"
```

## Run the app

Use Node.js 24 and Yarn 1.

```sh
yarn install --frozen-lockfile
yarn start
```

Add an HTTPS Raven site in the site manager. Local sites can use `localhost`, `.localhost`, or `.test` hosts.

## Verify changes

```sh
yarn test
yarn typecheck
yarn package
```

The packaged app is written to `out`.

## Test with Frappe and MariaDB

Start a dedicated Raven test site on a MariaDB Bench. Do not use a development or production site.

```sh
RAVEN_TEST_SITE_ORIGIN=http://raven-test.localhost:8000 \
RAVEN_TEST_USER=Administrator \
RAVEN_TEST_PASSWORD=admin \
yarn test:electron
```

The integration test starts the real Electron shell. It checks authentication, session isolation, renderer security, and realtime notification delivery.

The `MariaDB integration` GitHub workflow creates the Bench from `raven`. It runs Raven tests and the Electron integration test.

## Desktop behavior

- Raven stores each site in an isolated Electron session.
- Remote pages run with Node.js disabled and the Chromium sandbox enabled.
- External web, email, and telephone links open in the default system app.
- The tray menu and application badge show unread activity.
- The app saves its window bounds, theme, rail density, sites, and active site.
- A `raven://open` link can open a Raven route.

## Release packages

Electron Forge packages the app for macOS, Windows, and Linux. Public releases require platform signing credentials.

## License

Raven Desktop uses the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).
