require("dotenv").config();
const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "log.txt");
const INTERVAL_MINUTES = 15;

const targetAccounts = [
  "BitcoinMagazine",
  "CoinDesk",
  "lookonchain",
  "whale_alert"
];

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET
});

const rwClient = client.readWrite;

const log = (msg) => {
  const timestamp = new Date().toISOString();
  const full = `[${timestamp}] ${msg}`;
  console.log(full);
  fs.appendFileSync(LOG_FILE, full + "\n");
};

const generateParody = async (text) => {
  try {
    const res = await axios.post(
      "https://api-inference.huggingface.co/models/HuggingFaceH4/zephyr-7b-beta",
      {
        inputs: `Rewrite this crypto tweet as a short, toxic or absurd parody:\n"${text}"`
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );
    const out = res.data?.[0]?.generated_text;
    return out?.replace(/\n/g, " ").slice(0, 240);
  } catch (e) {
    log(`[AI] Error: ${e.message}`);
    return null;
  }
};

let index = 0;
const posted = new Set();

const processNextAccount = async () => {
  const username = targetAccounts[index % targetAccounts.length];
  index++;

  try {
    log(`[${username}] Checking for latest tweet...`);
    const user = await client.v2.userByUsername(username);
    const tweets = await client.v2.userTimeline(user.data.id, {
      max_results: 5,
      exclude: "replies",
      "tweet.fields": "created_at"
    });

    const latest = tweets.data?.data?.[0];
    if (!latest) {
      log(`[${username}] No tweets found.`);
      return;
    }

    if (posted.has(latest.id)) {
      log(`[${username}] Already posted this one.`);
      return;
    }

    const parody = await generateParody(latest.text);
    if (!parody) {
      log(`[${username}] Parody generation failed.`);
      return;
    }

    const tweetUrl = `https://twitter.com/${username}/status/${latest.id}`;
    const post = `${parody}\n\n${tweetUrl}`;
    await rwClient.v2.tweet(post);

    posted.add(latest.id);
    log(`[${username}] ✅ Parody posted.`);
  } catch (err) {
    if (err.code === 429) {
      log(`[${username}] ⚠️ Rate limit hit. Skipping.`);
    } else {
      log(`[${username}] ❌ Error: ${err.message}`);
    }
  }
};

log("🚀 Bot started: checking 1 account every 15 minutes...");
processNextAccount();
setInterval(processNextAccount, INTERVAL_MINUTES * 60 * 1000);
