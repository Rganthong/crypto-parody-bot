const fs = require("fs");
const axios = require("axios");
const dayjs = require("dayjs");
require("dotenv").config();
const { TwitterApi } = require("twitter-api-v2");

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TWITTER_TARGETS = process.env.TWITTER_TARGETS.split(",");

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const USED_TWEETS_FILE = "used_tweets.txt";
const DEFAULT_DELAY = 15 * 60 * 1000; // 15 menit

function log(msg) {
  const timestamp = `[${dayjs().toISOString()}]`;
  const logLine = `${timestamp} ${msg}`;
  console.log(logLine);
  fs.appendFileSync("log.txt", logLine + "\n");
}

function loadUsedTweets() {
  if (!fs.existsSync(USED_TWEETS_FILE)) return new Set();
  return new Set(fs.readFileSync(USED_TWEETS_FILE, "utf-8").split("\n"));
}

function saveUsedTweet(id) {
  fs.appendFileSync(USED_TWEETS_FILE, id + "\n");
}

async function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function getLatestTweet(username) {
  try {
    const user = await client.v2.userByUsername(username);
    const timeline = await client.v2.userTimeline(user.data.id, {
      exclude: ["replies", "retweets"],
      max_results: 5,
    });
    return timeline.data?.data?.[0] || null;
  } catch (err) {
    log(`[${username}] ❌ Error fetching tweet: ${err.message}`);
    if (err.code === 429 && err.rateLimit?.reset) {
      const waitMs = err.rateLimit.reset * 1000 - Date.now();
      log(`[${username}] 🕒 Rate limited. Waiting ${Math.ceil(waitMs / 1000)}s...`);
      await delay(waitMs);
    }
    return null;
  }
}

function smartTruncate(text, maxLength = 200) {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastStop = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf(", "),
    cut.lastIndexOf(" ")
  );
  return cut.slice(0, lastStop !== -1 ? lastStop : maxLength).trim() + "…";
}

async function generateParodyTweet(originalText) {
  const prompt = `Rewrite this tweet as a satirical and absurd parody in the style of BearBoy x Bogdanoff: full of crypto conspiracies, delusional hopium, market manipulation references, and over-the-top fake confidence. Make it sound like the speaker is controlling the market behind the scenes.\n"${originalText}"`;

  for (let i = 1; i <= 5; i++) {
    try {
      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: "llama3-70b-8192",
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          max_tokens: 120,
        },
        {
          headers: {
            Authorization: `Bearer ${GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const raw = response.data.choices?.[0]?.message?.content || "";
      const cleaned = raw.replace(/[^
