// crypto-parody-bot/index.js
const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");
const dayjs = require("dayjs");
require("dotenv").config();
const { TwitterApi } = require("twitter-api-v2");

const HF_API_KEY = process.env.HF_API_KEY;
const TWITTER_TARGETS = process.env.TWITTER_TARGETS.split(",");
const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const USED_TWEETS_FILE = "used_tweets.txt";
const DELAY_BETWEEN_ACCOUNTS = 15 * 60 * 1000;

function log(msg) {
  const timestamp = `[${dayjs().toISOString()}]`;
  const logLine = `${timestamp} ${msg}`;
  console.log(logLine);
  fs.appendFileSync("log.txt", logLine + "\n");
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function loadUsedTweets() {
  if (!fs.existsSync(USED_TWEETS_FILE)) return new Set();
  return new Set(fs.readFileSync(USED_TWEETS_FILE, "utf-8").split("\n"));
}

function saveUsedTweet(id) {
  fs.appendFileSync(USED_TWEETS_FILE, id + "\n");
}

async function scrapeLatestTweet(username) {
  try {
    const res = await axios.get(`https://x.com/${username}`);
    const $ = cheerio.load(res.data);
    const scripts = $("script").toArray();
    const raw = scripts.find((s) => $(s).html().includes("__REACT_QUERY_INITIAL_QUERIES__"));
    const jsonMatch = $(raw).html().match(/\{"props":.*\}\}\);/);
    if (!jsonMatch) throw new Error("Tweet data not found");
    const json = JSON.parse(jsonMatch[0]);
    const tweets = json.props.pageProps.tweets;
    const tweet = tweets.find((t) => t.user.username === username);
    return tweet;
  } catch (err) {
    log(`[${username}] ❌ Failed to scrape tweet: ${err.message}`);
    console.error(err);
    return null;
  }
}

async function generateParodyTweet(originalText) {
  const prompt = `Rewrite this crypto tweet as a toxic, delusional CT parody with halu and absurd energy. Make it sarcastic and hilarious:\n\"${originalText}\"`;
  let retries = 3;
  while (retries--) {
    try {
      const response = await axios.post(
        "https://api-inference.huggingface.co/models/HuggingFaceH4/zephyr-7b-beta",
        {
          inputs: prompt,
          parameters: { max_new_tokens: 120, temperature: 1.3 },
        },
        {
          headers: {
            Authorization: `Bearer ${HF_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
      const output = response.data[0]?.generated_text;
      const tweet = output.replace(prompt, "").trim().replace(/\s+/g, " ");
      if (tweet.length <= 280 && tweet.length > 10) return tweet;
    } catch (err) {
      if (err.response?.status === 429) {
        log(`[AI] Rate limit hit. Waiting 30s...`);
        await delay(30000);
      } else {
        log(`[AI] Generation failed: ${err.message}`);
        console.error(err);
        return null;
      }
    }
  }
  return null;
}

async function runForAccount(username) {
  log(`[${username}] Checking for latest tweet...`);
  const tweet = await scrapeLatestTweet(username);
  if (!tweet || !tweet.id_str || !tweet.full_text) return;

  const usedTweets = loadUsedTweets();
  if (usedTweets.has(tweet.id_str)) {
    log(`[${username}] No new tweet.`);
    return;
  }

  const parody = await generateParodyTweet(tweet.full_text);
  if (!parody) {
    log(`[${username}] ⚠️ Parody generation failed.`);
    return;
  }

  try {
    const tweetUrl = `https://x.com/${username}/status/${tweet.id_str}`;
    const result = await client.v2.tweet({ text: `${parody}\n\n${tweetUrl}` });
    log(`[${username}] ✅ Parody posted: ${result.data.id}`);
    saveUsedTweet(tweet.id_str);
  } catch (err) {
    log(`[${username}] ❌ Failed to post: ${err.message}`);
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
