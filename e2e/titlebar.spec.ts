import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makePlayableMidst } from './fixtures';
import { launch, openDocument } from './harness';

// The window is frameless (frame: false) and draws its own title bar with
// @jshafto/custom-electron-titlebar-update. Electron 43 changed how frameless windows are drawn on
// Linux, so this checks the title bar on every platform the suite runs on: it spans the top of the
// window, the content starts below it rather than under it, and on Windows and Linux, where the
// library draws the menu, the menu is there and clear of the window controls. Those controls are
// Electron's native overlay where it draws one (titleBarOverlay: true), or else the library's own,
// and either way they must sit inside the title bar. macOS draws its own controls.
//
// This checks layout, not appearance: under Xvfb on CI there is no desktop, so how a real desktop
// rounds the corners or orders the controls is still for a person to look at.

type Box = { x: number; y: number; width: number; height: number };

test('the title bar spans the window top, and the content starts below it', async () => {
  const work = mkdtempSync(join(tmpdir(), 'midst-titlebar-'));
  const { app } = await launch(work);
  try {
    const win = await app.firstWindow();
    const bar = win.locator('.cet-titlebar');
    await expect(bar).toBeVisible();

    const layout = await win.evaluate(() => {
      const box = (sel: string): Box | null => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      const controls = [
        ...document.querySelectorAll('.cet-window-controls .cet-control-icon'),
      ].map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      return {
        inner: { width: window.innerWidth, height: window.innerHeight },
        bar: box('.cet-titlebar'),
        container: box('.cet-container'),
        menubar: box('.cet-menubar'),
        menuButtons: document.querySelectorAll('.cet-menubar-menu-button')
          .length,
        // The menu bar element stretches across the bar; its buttons are what could sit under the
        // window controls, so measure where the last one ends.
        menuButtonsEnd: Math.max(
          0,
          ...[...document.querySelectorAll('.cet-menubar-menu-button')].map(
            (e) => e.getBoundingClientRect().right
          )
        ),
        controls,
        // titleBarOverlay: true asks Electron to draw the window controls natively (Window Controls
        // Overlay). Where it does, the library hides its own and leaves room for them.
        overlay: (() => {
          const wco = (navigator as any).windowControlsOverlay;
          if (!wco || !wco.visible) return null;
          const a = wco.getTitlebarAreaRect();
          return { x: a.x, y: a.y, width: a.width, height: a.height };
        })(),
      };
    });

    const { bar: b, container: c, inner } = layout;
    expect(b, 'no title bar').not.toBeNull();
    expect(c, 'no content container').not.toBeNull();
    expect(b!.y).toBe(0);
    expect(b!.height).toBeGreaterThan(0);
    expect(Math.round(b!.width)).toBe(inner.width);
    expect(Math.round(c!.y), 'the content starts under the title bar').toBe(
      Math.round(b!.height)
    );

    if (process.platform !== 'darwin') {
      const o = layout.overlay;
      if (o) {
        // Native controls: the title bar area Electron leaves for the page is inside the bar and
        // narrower than the window, and the menu ends before the controls begin.
        expect(o.height, 'overlay title bar area height').toBeGreaterThan(0);
        expect(
          o.y + o.height,
          'overlay area within the title bar'
        ).toBeLessThanOrEqual(b!.height + 1);
        expect(o.width, 'room left for the native controls').toBeLessThan(
          inner.width
        );
        expect(
          layout.menuButtonsEnd,
          'the menu does not run under the native window controls'
        ).toBeLessThanOrEqual(o.x + o.width + 1);
      } else {
        // The library's own controls: minimize, maximize and close, inside the window and the bar.
        expect(layout.controls, 'window controls').toHaveLength(3);
        layout.controls.forEach((k, i) => {
          const where = `window control ${i}`;
          expect(k.width, where).toBeGreaterThan(0);
          expect(k.height, where).toBeGreaterThan(0);
          expect(k.x, where).toBeGreaterThanOrEqual(0);
          expect(k.x + k.width, where).toBeLessThanOrEqual(inner.width);
          expect(k.y + k.height, where).toBeLessThanOrEqual(b!.height + 1);
        });
      }
      expect(
        layout.menuButtons,
        'menu buttons in the title bar'
      ).toBeGreaterThan(0);
      expect(layout.menubar!.width, 'menu bar width').toBeGreaterThan(0);
    } else {
      expect(
        layout.controls,
        'macOS draws its own window controls'
      ).toHaveLength(0);
    }
  } finally {
    await app.close();
  }
});

// GitHub #94: the squiggly M is about half its old size and starts clear of the macOS window buttons.
// The buttons are native, so the page cannot measure them; in a native capture on 28 Oct the green
// one ended at about 60px from the window's left edge. The logo is hidden on the opening screen.
test('on macOS the logo is small and starts clear of the window buttons', async () => {
  test.skip(process.platform !== 'darwin', 'the window buttons are macOS’s');
  const doc = makePlayableMidst('zq vex lumb orrin taf quell');
  const work = mkdtempSync(join(tmpdir(), 'midst-titlebar-logo-'));
  const poemPath = join(work, 'synthetic.midst');
  writeFileSync(poemPath, doc.file);
  const { app, userData } = await launch(work);
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.message-container')).toBeVisible();
    await openDocument(app, userData, poemPath, 'the synthetic poem');
    await expect(win.locator('.ProseMirror')).toBeVisible({ timeout: 25_000 });
    const logo = await win.locator('svg.svg').evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, height: r.height };
    });
    expect(logo.height, 'logo height').toBe(40);
    expect(
      logo.x,
      'logo starts past the window buttons'
    ).toBeGreaterThanOrEqual(70);
  } finally {
    await app.close();
  }
});
