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

async function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

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

async function getLatestTweet(username) {
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
    log(`[${username}] ⚠️ Failed to fetch tweet: ${err.response?.status || err.message}`);
    return null;
  }
}

async function generateParodyTweet(originalText) {
  const prompt = `Rewrite this crypto tweet as a toxic, delusional CT parody with halu and absurd energy. Make it sarcastic and hilarious:\n"${originalText}"`;
  let retries = 3;
  while (retries--) {
    try {
      const response = await axios.post(
        "https://api-inference.huggingface.co/models/HuggingFaceH4/zephyr-7b-beta",
        {
          inputs: prompt,
          parameters: {
            max_new_tokens: 120,
            temperature: 1.2,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${HF_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const output = response.data[0]?.generated_text;
      const tweet = output
        .replace(prompt, "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 280);

      if (tweet.length <= 280 && tweet.length > 10) return tweet;
    } catch (err) {
      if (err.response?.status === 429) {
        log(`[AI] Rate limit hit. Waiting 30s...`);
        await delay(30000);
      } else {
        log(`[AI] Generation failed: ${err.message}`);
        return null;
      }
    }
  }
  return null;
}

async function runForAccount(username) {
  log(`[${username}] Checking for latest tweet...`);
  const latestTweet = await getLatestTweet(username);
  if (!latestTweet) return;

  const usedTweets = loadUsedTweets();
  if (usedTweets.has(latestTweet.id)) {
    log(`[${username}] No new tweet.`);
    return;
  }

  const parody = await generateParodyTweet(latestTweet.text);
  if (!parody) {
    log(`[${username}] ⚠️ Parody generation failed.`);
    return;
  }

  try {
    const tweetUrl = `https://twitter.com/${username}/status/${latestTweet.id}`;
    const result = await client.v2.tweet({
      text: `${parody}\n\n${tweetUrl}`,
    });

    log(`[${username}] ✅ Parody posted: ${result.data.id}`);
    saveUsedTweet(latestTweet.id);
  } catch (err) {
    log(`[${username}] ❌ Failed to post: ${err.message}`);
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

