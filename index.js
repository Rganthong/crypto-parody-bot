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
  const prompt = `Rewrite this tweet as an extremely absurd and delusional parody in the style of BearBoy: filled with crypto conspiracies, hallucinated hopium, elite market manipulation, and a god-complex tone like the speaker moves the market by breathing. Make it sound like they're channeling Satoshi himself.`;

  for (let i = 1; i <= 5; i++) {
    try {
      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: "llama3-70b-8192",
          messages: [
            {
              role: "user",
              content: `${prompt}\n\n\"${originalText}\"`,
            },
          ],
          max_tokens: 150,
          temperature: 1.3,
        },
        {
          headers: {
            Authorization: `Bearer ${GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const raw = response.data.choices?.[0]?.message?.content || "";
      const cleaned = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/\s+/g, " ").trim();
      const truncated = smartTruncate(cleaned, 200);

      if (truncated.length >= 30) {
        log(`✅ Try ${i}: Passed - ${truncated.length} chars`);
        return truncated;
      } else {
        log(`⚠️ Try ${i}: Skipped - too short (${truncated.length} chars)`);
      }
    } catch (err) {
      log(`[AI] Try ${i} failed: ${err.message}`);
      if (err.response?.status === 429) await delay(30000);
    }
  }

  return null;
}

async function runForAccount(username) {
  log(`[${username}] 🔍 Checking for latest tweet...`);
  const latestTweet = await getLatestTweet(username);
  if (!latestTweet) {
    log(`[${username}] ⚠️ No tweet data found.`);
    return;
  }

  const usedTweets = loadUsedTweets();
  if (usedTweets.has(latestTweet.id)) {
    log(`[${username}] ✅ No new tweet.`);
    return;
  }

  const parody = await generateParodyTweet(latestTweet.text);
  if (!parody) {
    log(`[${username}] ⚠️ Parody generation failed.`);
    return;
  }

  const tweetText = `${parody}\n\nhttps://twitter.com/${username}/status/${latestTweet.id}`;

  try {
    const result = await client.v2.tweet({ text: tweetText });
    log(`[${username}] ✅ Parody posted: ${result.data.id}`);
    saveUsedTweet(latestTweet.id);
  } catch (err) {
    log(`[${username}] ❌ Failed to post: ${err.message}`);
  }
}

async function mainLoop() {
  log("🚀 Bot started (loop mode)...");
  while (true) {
    for (const username of TWITTER_TARGETS) {
      await runForAccount(username.trim());
      log(`⏳ Waiting 900s before next account...`);
      await delay(DEFAULT_DELAY);
    }
  }
}

mainLoop();

