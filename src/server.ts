import express, { Request, Response } from "express";
import cors from "cors";
import execa from "yt-dlp-exec";
import fs from "fs";
import path from "path";
import os from "os";
import { generate } from "youtube-po-token-generator";

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

// ------------------------------------------------------------------
// PO Token Cache Manager
// ------------------------------------------------------------------
interface PoTokenCache {
  poToken: string;
  visitorData: string;
  generatedAt: number;
}

let cachedPoTokenData: PoTokenCache | null = null;
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours TTL

async function getOrFetchPoToken(): Promise<{
  poToken: string;
  visitorData: string;
} | null> {
  const now = Date.now();

  // Return cached token if valid
  if (cachedPoTokenData && now - cachedPoTokenData.generatedAt < TOKEN_TTL_MS) {
    return {
      poToken: cachedPoTokenData.poToken,
      visitorData: cachedPoTokenData.visitorData,
    };
  }

  try {
    console.log("[PO-Token] Generating fresh YouTube PO Token...");
    const { poToken, visitorData } = await generate();

    cachedPoTokenData = {
      poToken,
      visitorData,
      generatedAt: now,
    };

    console.log("[PO-Token] Fresh PO Token successfully generated.");
    return { poToken, visitorData };
  } catch (error: any) {
    console.error("[PO-Token] Error generating PO Token:", error.message);
    // Return stale token if generation fails as fallback
    if (cachedPoTokenData) return cachedPoTokenData;
    return null;
  }
}

// ------------------------------------------------------------------
// Helper to build yt-dlp arguments dynamically
// ------------------------------------------------------------------
async function getBaseYtDlpOptions(): Promise<Record<string, any>> {
  const options: Record<string, any> = {
    dumpSingleJson: true,
    noWarnings: true,
    skipDownload: true,
  };

  const poData = await getOrFetchPoToken();

  if (poData) {
    // Attach PO Token and Visitor Data to the YouTube Extractor
    options.extractorArgs = `youtube:po_token=web+${poData.poToken};visitor_data=${poData.visitorData};player_client=web,mweb`;
  } else {
    // Fallback if token generator fails
    options.extractorArgs = "youtube:player_client=mweb,android";
  }

  return options;
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
    const options = await getBaseYtDlpOptions();
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
