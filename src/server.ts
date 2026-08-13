import express, { Request, Response } from "express";
import cors from "cors";
import { Innertube, UniversalCache } from "youtubei.js";

const app = express();
app.use(cors());
app.use(express.json());

let ytClient: Innertube | null = null;

// Initialize Innertube instance once
async function getYouTubeClient() {
  if (!ytClient) {
    ytClient = await Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
    });
  }
  return ytClient;
}

// Extract Video ID from various YouTube URL formats
function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/,
  );
  return match ? match[1] : null;
}

app.post("/api/subtitles/info", async (req: Request, res: Response) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "YouTube URL is required" });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({ error: "Invalid YouTube URL format" });
  }

  try {
    const yt = await getYouTubeClient();
    const info = await yt.getInfo(videoId);

    const captionTracks = info.captions?.caption_tracks || [];

    const manual: Array<{ langCode: string; name: string; formats: string[] }> =
      [];
    const automatic: Array<{
      langCode: string;
      name: string;
      formats: string[];
    }> = [];

    captionTracks.forEach((track) => {
      const item = {
        langCode: track.language_code,
        name: track.name?.text || track.language_code,
        formats: ["xml", "json3", "vtt"], // YouTube supports these formats out of the box
        url: track.base_url,
      };

      if (track.vss_id?.startsWith("a.")) {
        automatic.push(item);
      } else {
        manual.push(item);
      }
    });

    return res.json({
      id: videoId,
      title: info.basic_info.title,
      duration: info.basic_info.duration,
      thumbnail: info.basic_info.thumbnail?.[0]?.url,
      subtitles: {
        manual,
        automatic,
      },
    });
  } catch (error: any) {
    console.error("Error fetching subtitles via YouTubei.js:", error);
    return res.status(500).json({
      error: "Failed to fetch subtitle details from YouTube",
      details: error.message,
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Subtitle API running on http://localhost:${PORT}`);
});
