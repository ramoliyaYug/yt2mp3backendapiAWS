// ================= IMPORTS =================
const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const AWS = require("aws-sdk");

// Local ffmpeg (PROJECT LEVEL)
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;

const app = express();
app.use(express.json());

// ================= AWS S3 =================
const s3 = new AWS.S3();

// ================= CONFIG =================
const BUCKET_NAME = "yt-mp3-storage";

// Local yt-dlp path
const YTDLP_PATH = "yt-dlp";

// yt-dlp needs directory (not binary file)
const ffmpegDir = path.dirname(ffmpegPath);

/**
 * ===============================
 * Extract YouTube Video ID
 * Supports:
 * - youtube.com/watch?v=
 * - youtu.be/
 * - youtube.com/embed/
 * ===============================
 */
function extractVideoId(url) {

    const regex =
        /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

    const match = url.match(regex);

    return match ? match[1] : null;
}

/**
 * ===============================
 * POST /youtube-to-s3
 *
 * BODY:
 * {
 *   "url": "youtube_link"
 * }
 * ===============================
 */
app.post("/youtube-to-s3", async (req, res) => {

    try {

        const { url } = req.body;

        // ===============================
        // 1️⃣ Extract video ID
        // ===============================
        const videoId = extractVideoId(url);

        if (!videoId) {
            return res.status(400).json({ error: "Invalid YouTube URL" });
        }

        // Normalize URL
        const normalizedUrl =
            `https://www.youtube.com/watch?v=${videoId}`;

        // Temp output file
        const fileName = `${videoId}.mp3`;
        const outputPath = path.join(__dirname, fileName);

        // ===============================
        // 2️⃣ Run LOCAL yt-dlp
        // ===============================
        const cmd =
            `"${YTDLP_PATH}" -x --audio-format mp3 ` +
            `--cookies "${path.join(__dirname, 'cookies.txt')}" ` +
            `--ffmpeg-location "${ffmpegDir}" ` +
            `-o "${outputPath}" "${normalizedUrl}"`;

        exec(cmd, async (err) => {

            if (err) {
                console.error(err);
                return res.status(500).json({ error: "yt-dlp failed" });
            }

            try {

                // ===============================
                // 3️⃣ Read file
                // ===============================
                const fileBuffer = fs.readFileSync(outputPath);

                // ===============================
                // 4️⃣ Upload to AWS S3
                // ===============================
                await s3.upload({
                    Bucket: BUCKET_NAME,
                    Key: fileName,
                    Body: fileBuffer,
                    ContentType: "audio/mpeg"
                }).promise();

                // ===============================
                // 5️⃣ Delete temp file
                // ===============================
                fs.unlinkSync(outputPath);

                // ===============================
                // 6️⃣ Response
                // ===============================
                res.json({
                    message: "Uploaded successfully",
                    fileName,
                    videoId,
                    url: `https://${BUCKET_NAME}.s3.amazonaws.com/${fileName}`
                });

            } catch (uploadErr) {

                console.error(uploadErr);

                res.status(500).json({
                    error: "S3 upload failed"
                });
            }
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Server error" });
    }
});

// ================= START SERVER =================
app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});