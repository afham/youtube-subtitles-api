import express, { Request, Response } from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

interface SubtitleTrack {
  langCode: string;
  name: string;
  formats: string[];
  url: string;
}

// Helper function to extract 11-character video ID from common YouTube URL formats
function extractVideoId(url: string): string | null {
  if (!url) return null;
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
    // Call YouTube's InnerTube endpoint pretending to be the official Android client
    // Data center IPs (like Render) pass through without triggering BotGuard on mobile clients
    const response = await fetch("https://www.youtube.com/youtubei/v1/player", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "com.google.android.youtube/19.29.37 (Linux; U; Android 11; US) gzip",
      },
      body: JSON.stringify({
        videoId: videoId,
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "19.29.37",
            androidSdkVersion: 30,
            hl: "en",
            gl: "US",
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`YouTube API returned status ${response.status}`);
    }

    const data: any = await response.json();

    // Check if the video is restricted or unavailable
    if (data.playabilityStatus?.status === "UNPLAYABLE") {
      return res.status(422).json({
        error: "Video is unplayable or private",
        reason: data.playabilityStatus?.reason,
      });
    }

    // Extract caption tracks from player response
    const captionTracks =
      data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

    const manual: SubtitleTrack[] = [];
    const automatic: SubtitleTrack[] = [];

    captionTracks.forEach((t: any) => {
      // Extract human-readable language name (ANDROID client returns runs array)
      const name =
        t.name?.runs?.[0]?.text || t.name?.simpleText || t.languageCode;

      const track: SubtitleTrack = {
        langCode: t.languageCode,
        name: name,
        formats: ["vtt", "xml", "srv1"], // YouTube supports appending &fmt=vtt to baseUrl
        url: t.baseUrl,
      };

      // Auto-generated captions start with "a." in vssId (e.g., "a.en")
      if (t.vssId?.startsWith("a.")) {
        automatic.push(track);
      } else {
        manual.push(track);
      }
    });

    const videoDetails = data.videoDetails || {};
    const thumbnails = videoDetails.thumbnail?.thumbnails || [];

    return res.json({
      id: videoId,
      title: videoDetails.title || "Unknown Title",
      duration: parseInt(videoDetails.lengthSeconds || "0", 10),
      thumbnail:
        thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : null,
      subtitles: {
        manual,
        automatic,
      },
    });
  } catch (err: any) {
    console.error("Error fetching subtitles via ANDROID client:", err);
    return res.status(500).json({
      error: "Failed to fetch subtitle details from YouTube",
      details: err.message,
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Subtitle API server running on port ${PORT}`);
});
