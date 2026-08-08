import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { chromium } from "playwright";

function bundledHeadlessShellPath() {
  const chromiumExecutablePath = chromium.executablePath();
  const chromiumInstallationDirectory = dirname(dirname(chromiumExecutablePath));
  const revision = basename(chromiumInstallationDirectory).replace(/^chromium-/, "");
  const browserCacheDirectory = dirname(chromiumInstallationDirectory);
  const exactDirectory = `chromium_headless_shell-${revision}`;
  const installedDirectories = existsSync(browserCacheDirectory)
    ? readdirSync(browserCacheDirectory).filter((name) => /^chromium_headless_shell-\d+$/.test(name)).sort().reverse()
    : [];
  const shellDirectories = [exactDirectory, ...installedDirectories.filter((name) => name !== exactDirectory)];
  const candidates = shellDirectories.flatMap((directory) => [
    join(browserCacheDirectory, directory, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
    join(browserCacheDirectory, directory, "chrome-headless-shell-linux64", "chrome-headless-shell"),
    join(browserCacheDirectory, directory, "chrome-headless-shell-mac-x64", "chrome-headless-shell"),
    join(browserCacheDirectory, directory, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
  ]);
  return candidates.find((candidate) => existsSync(candidate));
}

export function playwrightLaunchOptions() {
  const explicitExecutablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (explicitExecutablePath && existsSync(explicitExecutablePath)) {
    return { headless: true, executablePath: explicitExecutablePath };
  }
  const headlessShellPath = bundledHeadlessShellPath();
  // 中文注解：优先使用精确修订号，缺失时选择缓存中最新的 Playwright headless shell，避免系统浏览器升级导致分页几何漂移。
  if (headlessShellPath) return { headless: true, executablePath: headlessShellPath };
  if (existsSync(chromium.executablePath())) return { headless: true };
  const systemCandidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ];
  const executablePath = systemCandidates.find((candidate) => existsSync(candidate));
  // 中文注解：配套浏览器未安装时才复用系统 Chrome/Edge，CI 仍可通过环境变量显式指定受控浏览器。
  return { headless: true, ...(executablePath ? { executablePath } : {}) };
}
