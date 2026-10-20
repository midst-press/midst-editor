# Midst Redux

This is a cross-platform reimplementation of the [Midst](https://midst.press) poetry editing software.

It is based on the [Electron React Boilerplate](https://electron-react-boilerplate.js.org/), used under the [MIT license](https://github.com/electron-react-boilerplate/electron-react-boilerplate/blob/main/LICENSE).

To learn how to write in Midst, read the [user guide](docs/user-guide.md).

To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md): the checks, the tests, and the rules about poem content.

## Install

Clone the repo and install dependencies:

```bash
git clone https://github.com/midst-press/midst-editor.git
cd midst-editor
npm ci
```

## Starting Development

Start the app in the `dev` environment:

```bash
npm start
```

## Packaging for Production

To package apps for the local platform:

```bash
npm run package
```

## Licence

From the commit where the licence changed (`1ed9400`) onwards, this project is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later). Earlier versions were released under the MIT licence; the original MIT notice is kept in [LICENSE-MIT](LICENSE-MIT).
