import express, { Request, Response } from "express";
import cors from "cors";
import execa from "yt-dlp-exec";
import fs from "fs";
import path from "path";
import os from "os";

const app = express();
app.use(cors());
app.use(express.json());

interface SubtitleTrack {
  ext: string;
  url: string;
  name?: string;
}

interface YtDlpMetadata {
  id: string;
  title: string;
  duration: number;
  thumbnail: string;
  subtitles?: Record<string, SubtitleTrack[]>;
  automatic_captions?: Record<string, SubtitleTrack[]>;
}

// Path to temporary cookies file in execution environment
const COOKIES_PATH = path.join(os.tmpdir(), "youtube_cookies.txt");

// Helper to write YOUTUBE_COOKIES env var to a file and return the path
function ensureCookiesFile(): string | undefined {
  const cookiesEnv = process.env.YOUTUBE_COOKIES;
  if (!cookiesEnv) {
    return undefined;
  }

  try {
    // Keep cookie file fresh on each deployment/boot
    fs.writeFileSync(COOKIES_PATH, cookiesEnv, "utf-8");
    return COOKIES_PATH;
  } catch (err) {
    console.error("Failed to write YouTube cookies file:", err);
    return undefined;
  }
}

// ------------------------------------------------------------------
// 1. Fetch metadata & list available subtitles
// ------------------------------------------------------------------
app.post("/api/subtitles/info", async (req: Request, res: Response) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "YouTube URL is required" });
  }

  try {
    const cookieFile = ensureCookiesFile();

    const options: Record<string, any> = {
      dumpSingleJson: true,
      noWarnings: true,
      skipDownload: true, // Focus purely on metadata/subtitles
      extractorArgs: "youtube:player_client=android,web", // Bypass web client format restrictions
    };

    if (cookieFile) {
      options.cookies = cookieFile;
    }

    const info = (await execa(url, options)) as unknown as YtDlpMetadata;

    const manualSubs = info.subtitles || {};
    const autoSubs = info.automatic_captions || {};

    const formatSubList = (subsDict: Record<string, SubtitleTrack[]>) => {
      return Object.keys(subsDict).map((langCode) => {
        const tracks = subsDict[langCode];
        const name = tracks.find((t) => t.name)?.name || langCode;
        return {
          langCode,
          name,
          formats: tracks.map((t) => t.ext),
        };
      });
    };

    return res.json({
      id: info.id,
      title: info.title,
      duration: info.duration,
      thumbnail: info.thumbnail,
      subtitles: {
        manual: formatSubList(manualSubs),
        automatic: formatSubList(autoSubs),
      },
    });
  } catch (error: any) {
    console.error("Error extracting subtitle info:", error);
    return res.status(500).json({
      error: "Failed to fetch subtitle details from YouTube",
      details: error.message,
    });
  }
});

// ------------------------------------------------------------------
// 2. Download and convert a specific subtitle track
// ------------------------------------------------------------------
app.post("/api/subtitles/download", async (req: Request, res: Response) => {
  const { url, langCode, isAuto = false, format = "srt" } = req.body;

  if (!url || !langCode) {
    return res.status(400).json({ error: "URL and langCode are required" });
  }

  // Create temporary directory for subtitle file extraction
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytsubs-"));

  try {
    const outputTemplate = path.join(tmpDir, "%(id)s");
    const cookieFile = ensureCookiesFile();

    const options: Record<string, any> = {
      skipDownload: true,
      subLangs: langCode,
      convertSubtitles: format,
      output: outputTemplate,
    };

    if (cookieFile) {
      options.cookies = cookieFile;
    }

    if (isAuto) {
      options.writeAutoSubs = true;
    } else {
      options.writeSub = true;
    }

    await execa(url, options);

    // Locate the generated subtitle file inside tmpDir
    const files = fs.readdirSync(tmpDir);
    const subFile = files.find((f) => f.endsWith(`.${format}`));

    if (!subFile) {
      throw new Error(`Subtitle file in format '${format}' was not generated.`);
    }

    const filePath = path.join(tmpDir, subFile);

    // Stream file back to client as attachment
    res.download(filePath, subFile, (err) => {
      // Safe cleanup of temporary directory after response finishes
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      if (err && !res.headersSent) {
        console.error("Error streaming subtitle file:", err);
      }
    });
  } catch (error: any) {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    console.error("Error downloading subtitle:", error);
    return res.status(500).json({
      error: "Failed to process subtitle download",
      details: error.message,
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Subtitle API running on http://localhost:${PORT}`);
});
