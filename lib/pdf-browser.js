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

let executablePathPromise;

export async function getPdfFontDataUrl() {
  const bytes = await fs.readFile(PDF_FONT_PATH);
  return `data:font/ttf;base64,${bytes.toString("base64")}`;
}

async function resolveExecutablePath() {
  if (process.env.VERCEL) {
    executablePathPromise ||= chromium.executablePath();
    return executablePathPromise;
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
  const options = {
    executablePath,
    headless: true,
    args: isLocalChrome ? ["--no-sandbox"] : chromium.args,
    defaultViewport: {
      width: 1400,
      height: 900,
      deviceScaleFactor: 2
    }
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await puppeteer.launch(options);
    } catch (error) {
      const message = String(error?.message || error || "");
      const isBusyChromium = error?.code === "ETXTBSY" || /spawn ETXTBSY/.test(message);
      if (!isBusyChromium || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }

  throw new Error("לא ניתן להפעיל את מנוע ה־PDF");
}
