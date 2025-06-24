const fs = require("fs");
const axios = require("axios");
const dayjs = require("dayjs");
require("dotenv").config();
const { TwitterApi } = require("twitter-api-v2");

const HF_API_KEY = process.env.HF_API_KEY;
const BEARER_TOKEN = process.env.TWITTER_BEARER;
const TWITTER_TARGETS = process.env.TWITTER_TARGETS.split(",");
const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const USED_TWEETS_FILE = "used_tweets.txt";
const DELAY_BETWEEN_ACCOUNTS = 15 * 60 * 1000;

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function log(msg) {
  const timestamp = `[${dayjs().toISOString()}]`;
  const line = `${timestamp} ${msg}`;
  console.log(line);
  fs.appendFileSync("log.txt", line + "\n");
}

function loadUsedTweets() {
  if (!fs.existsSync(USED_TWEETS_FILE)) return new Set();
  return new Set(fs.readFileSync(USED_TWEETS_FILE, "utf-8").split("\n"));
}

function saveUsedTweet(id) {
  fs.appendFileSync(USED_TWEETS_FILE, id + "\n");
}

async function getLatestTweet(username, attempt = 1) {
  try {
    const res = await axios.get(`https://api.twitter.com/2/users/by/username/${username}`, {
      headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
    });
    const userId = res.data.data.id;

    const tweets = await axios.get(`https://api.twitter.com/2/users/${userId}/tweets`, {
      headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
      params: {
        max_results: 5,
        "tweet.fields": "created_at",
        exclude: "replies,retweets",
      },
    });

    return tweets.data.data?.[0];
  } catch (err) {
    const status = err.response?.status || "UNKNOWN";
    log(`[${username}] ⚠️ Failed to fetch tweet: ${status}`);
    console.error(err);

    if (status === 500 && attempt < 3) {
      log(`[${username}] 🔁 Retrying fetch in 30s... (Attempt ${attempt + 1})`);
      await delay(30000);
      return await getLatestTweet(username, attempt + 1);
    }

    return null;
  }
}

async function generateParodyTweet(originalText) {
  const prompt = `Rewrite this crypto tweet as a delusional, toxic parody for CT. Be halu, sarcastic, absurd:\n"${originalText}"`;

  let retries = 5;
  while (retries--) {
    try {
      const res = await axios.post(
        "https://api-inference.huggingface.co/models/HuggingFaceH4/zephyr-7b-beta",
        {
          inputs: prompt,
          parameters: { max_new_tokens: 120, temperature: 1.2 },
        },
        {
          headers: {
            Authorization: `Bearer ${HF_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const raw = res.data[0]?.generated_text || "";
      const tweet = raw.replace(prompt, "").trim().replace(/\s+/g, " ");

      if (tweet.length <= 280 && tweet.length >= 10) return tweet;
      log(`[AI] ✂️ Output too long or empty, regenerating...`);
    } catch (err) {
      const code = err.response?.status || "UNKNOWN";
      if (code === 429) {
        log(`[AI] 🔁 Rate limited. Waiting 30s...`);
        await delay(30000);
      } else {
        log(`[AI] ❌ Generation failed: ${code}`);
        console.error(err);
        return null;
      }
    }
  }

  return null;
}

async function runForAccount(username) {
  log(`[${username}] Checking for latest tweet...`);
  const latest = await getLatestTweet(username);
  if (!latest) return;

  const used = loadUsedTweets();
  if (used.has(latest.id)) {
    log(`[${username}] No new tweet.`);
    return;
  }

  const parody = await generateParodyTweet(latest.text);
  if (!parody) {
    log(`[${username}] ⚠️ Parody generation failed.`);
    return;
  }

  try {
    const tweetUrl = `https://twitter.com/${username}/status/${latest.id}`;
    const result = await client.v2.tweet({
      text: `${parody}\n\n${tweetUrl}`,
    });

    log(`[${username}] ✅ Quote posted: ${result.data.id}`);
    saveUsedTweet(latest.id);
  } catch (err) {
    log(`[${username}] ❌ Post failed: ${err.message}`);
    console.error(err);
  }
}

async function main() {
  log("🚀 Bot started...");
  for (const username of TWITTER_TARGETS) {
    await runForAccount(username.trim());
    log(`⏳ Waiting 15 minutes before next account...`);
    await delay(DELAY_BETWEEN_ACCOUNTS);
  }
  log("✅ All done.");
}

main();
