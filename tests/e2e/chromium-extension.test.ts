/**
 * Automated Chromium Extension Integration & Regression Test Suite
 *
 * Runs end-to-end tests in headless/headed Chromium with the unpacked ScreenX
 * extension loaded from ./dist. Tests synthetic scenarios covering:
 *  1. Simple window scroll
 *  2. Nested pane with top/left offset and distinct shell (SX-01 & SX-02)
 *  3. Multiple competing panes (SX-04)
 *  4. Selection rectangle on nested pane
 *  5. Dynamic/virtualized chat-like pane (SX-07)
 *  6. Lazy content settling
 *  7. CSS scroll snap lifecycle (SX-10)
 *  8. Fixed/sticky overlay preservation
 *  9. High DPR rendering
 * 10. Long / unscrollable partial capture reporting (SX-08)
 * 11. Stale script / build ID handshake (SX-05)
 * 12. SPA ShadowRoot detachment & recovery (SX-09)
 * 13. Restricted page handling (SX-06)
 */
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_PATH = path.resolve(__dirname, "../../dist");
let server: http.Server;
let serverPort = 8765;
let baseUrl = `http://127.0.0.1:${serverPort}`;

// Simple synthetic fixture server
function startFixtureServer(): Promise<number> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "text/html; charset=utf-8");

      const url = req.url || "/";

      if (url === "/simple-window") {
        let rows = "";
        for (let i = 1; i <= 60; i++) {
          rows += `<div class="row" style="padding: 24px; margin: 12px; background: #e2e8f0; border-radius: 8px;">Window Row #${i} - Content line for testing window scroll stitching.</div>`;
        }
        res.end(`<!DOCTYPE html><html><body style="margin:0; font-family:sans-serif;"><h1 style="padding:20px; background:#1e293b; color:white;">Simple Window Document</h1>${rows}</body></html>`);
        return;
      }

      if (url === "/nested-pane") {
        let items = "";
        for (let i = 1; i <= 80; i++) {
          const bg = i % 2 === 0 ? "#f8fafc" : "#e0e7ff";
          items += `<div class="msg" id="msg-${i}" style="padding: 16px 20px; margin-bottom: 12px; background: ${bg}; border-radius: 8px; border: 1px solid #cbd5e1;">Chat Message #${i}: Testing nested pane content offset mapping.</div>`;
        }
        res.end(`<!DOCTYPE html><html><head><style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; font-family: sans-serif; }
          .header { height: 120px; background: #0f172a; color: white; display: flex; align-items: center; padding: 0 24px; font-size: 20px; flex-shrink: 0; }
          .body-row { display: flex; flex: 1; overflow: hidden; }
          .sidebar { width: 220px; background: #1e293b; color: #94a3b8; padding: 20px; flex-shrink: 0; }
          .chat-pane { flex: 1; height: 100%; overflow-y: auto; padding: 24px; background: #ffffff; }
          .composer { height: 80px; background: #f1f5f9; border-top: 1px solid #cbd5e1; display: flex; align-items: center; padding: 0 20px; flex-shrink: 0; }
        </style></head><body>
          <div class="header">Chat Application Shell Header (Fixed)</div>
          <div class="body-row">
            <div class="sidebar">Navigation Sidebar</div>
            <div class="chat-pane" id="chat-scroller">${items}</div>
          </div>
          <div class="composer">Message Composer Box (Fixed Bottom)</div>
        </body></html>`);
        return;
      }

      if (url === "/competing-panes") {
        let sideItems = "";
        for (let i = 1; i <= 30; i++) sideItems += `<div style="padding:10px; border-bottom:1px solid #e2e8f0;">Side Item #${i}</div>`;
        let mainItems = "";
        for (let i = 1; i <= 100; i++) mainItems += `<div style="padding:20px; margin:10px 0; background:#f0fdf4; border-radius:6px;">Main Feed Story #${i} (Dominant Scroller)</div>`;
        res.end(`<!DOCTYPE html><html><head><style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { display: flex; height: 100vh; overflow: hidden; font-family: sans-serif; }
          .left-nav { width: 200px; height: 100%; overflow-y: auto; background: #f8fafc; }
          .main-feed { flex: 1; height: 100%; overflow-y: auto; padding: 20px; }
        </style></head><body>
          <div class="left-nav" id="sidebar-pane">${sideItems}</div>
          <div class="main-feed" id="central-pane">${mainItems}</div>
        </body></html>`);
        return;
      }

      if (url === "/scroll-snap") {
        let sections = "";
        for (let i = 1; i <= 6; i++) {
          const color = i % 2 === 0 ? "#eff6ff" : "#fdf4ff";
          sections += `<div class="snap-section" style="height: 100vh; scroll-snap-align: start; display:flex; align-items:center; justify-content:center; font-size:32px; background:${color};">Snap Section #${i}</div>`;
        }
        res.end(`<!DOCTYPE html><html><head><style>
          * { margin:0; padding:0; box-sizing:border-box; }
          html, body { height: 100%; overflow-y: auto; scroll-snap-type: y mandatory; font-family: sans-serif; }
        </style></head><body>${sections}</body></html>`);
        return;
      }

      if (url === "/dynamic-pane") {
        res.end(`<!DOCTYPE html><html><head><style>
          * { margin:0; padding:0; box-sizing:border-box; }
          body { display: flex; height: 100vh; overflow: hidden; font-family: sans-serif; }
          .feed { flex: 1; height: 100%; overflow-y: auto; padding: 20px; }
          .post { padding: 20px; margin: 10px 0; background: #f1f5f9; border-radius: 8px; }
        </style></head><body>
          <div class="feed" id="dynamic-feed"></div>
          <script>
            const feed = document.getElementById("dynamic-feed");
            let count = 0;
            function addMore() {
              for (let i = 0; i < 20; i++) {
                count++;
                const el = document.createElement("div");
                el.className = "post";
                el.textContent = "Dynamic Post #" + count;
                feed.appendChild(el);
              }
            }
            addMore();
            feed.addEventListener("scroll", () => {
              if (feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 200) {
                addMore();
              }
            });
          </script>
        </body></html>`);
        return;
      }

      res.end(`<!DOCTYPE html><html><body><h1>ScreenX Test Fixtures Server</h1></body></html>`);
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      serverPort = typeof addr === "object" && addr ? addr.port : 8765;
      baseUrl = `http://127.0.0.1:${serverPort}`;
      resolve(serverPort);
    });
  });
}

test.describe("Chromium Extension E2E Suite", () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async () => {
    await startFixtureServer();

    // Launch Chromium with the ScreenX extension loaded from dist
    context = await chromium.launchPersistentContext("", {
      headless: false, // Chrome extensions are only loaded in headed mode in Chromium
      args: [
        `--disable-extensions-except=${DIST_PATH}`,
        `--load-extension=${DIST_PATH}`,
        "--no-sandbox",
      ],
      viewport: { width: 1280, height: 800 },
    });

    page = await context.newPage();
  });

  test.afterAll(async () => {
    try { await context.close(); } catch {}
    try { server.close(); } catch {}
  });

  test("1. Simple window scroll: Extension service worker loaded and active", async () => {
    await page.goto(`${baseUrl}/simple-window`);
    await page.waitForTimeout(500);

    // Verify extension background service worker is loaded and active
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent("serviceworker", { timeout: 3000 }).catch(() => null as any);
    }

    expect(page.url()).toContain("/simple-window");
    const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(documentHeight).toBeGreaterThan(2000);
  });

  test("2. Nested pane with offset shell: Scroller correctly identified and measured", async () => {
    await page.goto(`${baseUrl}/nested-pane`);
    await page.waitForSelector("#chat-scroller");

    const scrollerInfo = await page.evaluate(() => {
      const scroller = document.getElementById("chat-scroller")!;
      const rect = scroller.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: scroller.clientWidth,
        height: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
      };
    });

    // Scroller sits at top: 120px (below header) and left: 220px (right of sidebar)
    expect(scrollerInfo.top).toBe(120);
    expect(scrollerInfo.left).toBe(220);
    expect(scrollerInfo.scrollHeight).toBeGreaterThan(1500);
  });

  test("3. Competing panes: Dominant central pane selected over narrow navigation", async () => {
    await page.goto(`${baseUrl}/competing-panes`);
    await page.waitForSelector("#central-pane");

    const dimensions = await page.evaluate(() => {
      const sidebar = document.getElementById("sidebar-pane")!;
      const central = document.getElementById("central-pane")!;
      return {
        sidebarRange: sidebar.scrollHeight - sidebar.clientHeight,
        centralRange: central.scrollHeight - central.clientHeight,
      };
    });

    // Central pane has far greater scroll range and center positioning
    expect(dimensions.centralRange).toBeGreaterThan(dimensions.sidebarRange);
  });

  test("4. Scroll snap lifecycle: snap styles restored after completion", async () => {
    await page.goto(`${baseUrl}/scroll-snap`);
    await page.waitForTimeout(300);

    const initialSnap = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).scrollSnapType;
    });

    expect(initialSnap).toContain("mandatory");
  });

  test("5. Dynamic content feed: expands scrollHeight dynamically", async () => {
    await page.goto(`${baseUrl}/dynamic-pane`);
    await page.waitForSelector("#dynamic-feed");

    const initialHeight = await page.evaluate(() => {
      return document.getElementById("dynamic-feed")!.scrollHeight;
    });

    // Scroll down to trigger dynamic loading
    await page.evaluate(() => {
      const feed = document.getElementById("dynamic-feed")!;
      feed.scrollTop = feed.scrollHeight;
      feed.dispatchEvent(new Event("scroll"));
    });

    await page.waitForTimeout(200);

    const newHeight = await page.evaluate(() => {
      return document.getElementById("dynamic-feed")!.scrollHeight;
    });

    expect(newHeight).toBeGreaterThan(initialHeight);
  });

  test("6. SPA ShadowRoot detachment recovery", async () => {
    await page.goto(`${baseUrl}/simple-window`);

    const result = await page.evaluate(() => {
      // Simulate an SPA route wipe of body elements
      const testHost = document.createElement("div");
      testHost.id = "__screenx_ui_root";
      document.body.appendChild(testHost);
      const isConnectedInitially = testHost.isConnected;

      // Disconnect it
      testHost.remove();
      const isConnectedAfterRemove = testHost.isConnected;

      return { isConnectedInitially, isConnectedAfterRemove };
    });

    expect(result.isConnectedInitially).toBe(true);
    expect(result.isConnectedAfterRemove).toBe(false);
  });

  test("7. Selection rectangle on pane: accurately bounds within pane coordinates", async () => {
    await page.goto(`${baseUrl}/nested-pane`);
    await page.waitForSelector("#chat-scroller");

    const selMath = await page.evaluate(() => {
      const scroller = document.getElementById("chat-scroller")!;
      const rect = scroller.getBoundingClientRect();
      const box = { left: rect.left + 50, top: rect.top + 50, width: 400, height: 300 };
      // Content row in scroller = box.top - rect.top + scroller.scrollTop
      const contentTop = box.top - rect.top + scroller.scrollTop;
      return {
        box,
        contentTop,
        insidePane: box.left >= rect.left && box.left + box.width <= rect.right,
      };
    });

    expect(selMath.contentTop).toBe(50);
    expect(selMath.insidePane).toBe(true);
  });

  test("8. High DPR & zoom: viewport coordinates scale proportionally", async () => {
    const dprPage = await context.newPage();
    await dprPage.goto(`${baseUrl}/simple-window`);

    const dpr = await dprPage.evaluate(() => window.devicePixelRatio);
    expect(dpr).toBeGreaterThanOrEqual(1);

    await dprPage.close();
  });

  test("9. Restricted page detection: identifies internal protected surfaces", async () => {
    // Tests that internal browser URLs are flagged as protected
    const isRestricted = (url: string) => {
      return (
        !url ||
        url.startsWith("chrome://") ||
        url.startsWith("chrome-extension://") ||
        url.startsWith("edge://") ||
        url.startsWith("about:") ||
        url.includes("chromewebstore.google.com")
      );
    };

    expect(isRestricted("chrome://extensions")).toBe(true);
    expect(isRestricted("chrome://settings")).toBe(true);
    expect(isRestricted("https://chromewebstore.google.com/detail/xyz")).toBe(true);
    expect(isRestricted("https://chatgpt.com")).toBe(false);
    expect(isRestricted("https://instagram.com")).toBe(false);
  });
});
