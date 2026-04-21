import fs from "fs/promises";
import path from "path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const LOCAL_CHROME_PATHS = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
].filter(Boolean);

export const PDF_FONT_PATH = path.join(process.cwd(), "assets/fonts/NotoSansHebrew-Regular.ttf");

export async function getPdfFontDataUrl() {
  const bytes = await fs.readFile(PDF_FONT_PATH);
  return `data:font/ttf;base64,${bytes.toString("base64")}`;
}

async function resolveExecutablePath() {
  if (process.env.VERCEL) {
    return chromium.executablePath();
  }

  for (const candidate of LOCAL_CHROME_PATHS) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }

  return chromium.executablePath();
}

export async function launchPdfBrowser() {
  const executablePath = await resolveExecutablePath();
  const isLocalChrome = LOCAL_CHROME_PATHS.includes(executablePath);

  return puppeteer.launch({
    executablePath,
    headless: true,
    args: isLocalChrome ? ["--no-sandbox"] : chromium.args,
    defaultViewport: {
      width: 1400,
      height: 900,
      deviceScaleFactor: 2
    }
  });
}
