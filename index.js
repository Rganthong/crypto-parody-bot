require("dotenv").config();
const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "log.txt");
const DELAY_PER_ACCOUNT_MINUTES = 12;

const targetAccounts = [
  "BitcoinMagazine",
  "CoinDesk",
  "lookonchain",
  "whale_alert"
];

// Twitter client
const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET
});

const rwClient = client.readWrite;

// Parody style prompt
const generateParody = async (originalText) => {
  try {
    const res = await axios.post(
      "https://api-inference.huggingface.co/models/HuggingFaceH4/zephyr-7b-beta",
      {
        inputs: `Rewrite this crypto tweet as a short, unfiltered parody with absurd humor or sarcasm:\n"${originalText}"`
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );
    const result = res.data[0]?.generated_text;
    return result?.replace(/\n/g, " ").slice(0, 250); // short parody max ~250 chars
  } catch (err) {
    log(`[AI] Error generating parody: ${err.message}`);
    return null;
  }
};

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

const log = (message) => {
  const time = new Date().toISOString();
  const entry = `[${time}] ${message}`;
  console.log(entry);
  fs.appendFileSync(LOG_FILE, entry + "\n");
};

const postedTweetIds = new Set();

const processAccount = async (username) => {
  try {
    log(`[${username}] Checking latest tweet...`);
    const user = await client.v2.userByUsername(username);
    const tweets = await client.v2.userTimeline(user.data.id, {
      max_results: 5,
      exclude: "replies",
      "tweet.fields": "created_at"
    });

    const latest = tweets.data?.data?.[0];
    if (!latest) {
      log(`[${username}] No tweet found.`);
      return;
    }

    if (postedTweetIds.has(latest.id)) {
      log(`[${username}] Already posted this tweet.`);
      return;
    }

    const parody = await generateParody(latest.text);
    if (!parody) {
      log(`[${username}] Failed to generate parody, skipped.`);
      return;
    }

    const tweetUrl = `https://twitter.com/${username}/status/${latest.id}`;
    const composed = `${parody}\n\n${tweetUrl}`;

    await rwClient.v2.tweet(composed);
    postedTweetIds.add(latest.id);
    log(`[${username}] ✅ Posted parody quote tweet.`);
  } catch (err) {
    if (err.code === 429) {
      log(`[${username}]⚠️ Rate limit hit. Waiting 15 minutes...`);
      await delay(15 * 60 * 1000);
    } else {
      log(`[${username}] ❌ Error: ${err.message}`);
    }
  }
};

const runBot = async () => {
  log(`🚀 Bot started: will run full cycle every ${DELAY_PER_ACCOUNT_MINUTES * targetAccounts.length} minutes (${DELAY_PER_ACCOUNT_MINUTES}m delay per account)...`);
  for (const account of targetAccounts) {
    await processAccount(account);
    log(`⏳ Waiting ${DELAY_PER_ACCOUNT_MINUTES} minutes before next account...`);
    await delay(DELAY_PER_ACCOUNT_MINUTES * 60 * 1000);
  }
  log("🔁 Finished full cycle. Restarting...");
  runBot();
};

runBot();
