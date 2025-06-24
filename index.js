// crypto-parody-bot/index.js
require("dotenv").config();
const axios = require("axios");
const { TwitterApi } = require("twitter-api-v2");
const fs = require("fs");

const INTERVAL_MINUTES = 15;
const DELAY_PER_ACCOUNT = INTERVAL_MINUTES * 60 * 1000;
const targetAccounts = [
  "BitcoinMagazine",
  "CoinDesk",
  "lookonchain",
  "whale_alert"
];

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const rwClient = twitterClient.readWrite;

const log = (msg) => {
  const timestamp = new Date().toISOString();
  const out = `[${timestamp}] ${msg}`;
  console.log(out);
  fs.appendFileSync("log.txt", out + "\n");
};

const getLatestTweet = async (username) => {
  const user = await rwClient.v2.userByUsername(username);
  const tweets = await rwClient.v2.userTimeline(user.data.id, {
    exclude: "replies",
    max_results: 5,
  });
  return tweets.data?.data?.[0];
};

const hybridPrompt = (text) => {
  return `Rewrite this crypto tweet as a hybrid of toxic realism and absurd hallucination. Be sarcastic like a bitter CT veteran, but also throw in wild degen-level delusion. Keep it short, chaotic, and clever:\n\n"${text}"`;
};

const generateParody = async (text) => {
  try {
    const res = await axios.post(
      "https://api-inference.huggingface.co/models/HuggingFaceH4/zephyr-7b-beta",
      {
        inputs: hybridPrompt(text),
        parameters: {
          max_new_tokens: 80,
          return_full_text: false,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );
    const out = res.data?.[0]?.generated_text;
    return out?.replace(/\n/g, " ").slice(0, 240);
  } catch (e) {
    log(`[AI] Error: ${e.message}`);
    return null;
  }
};

const quoteTweet = async (tweet, parody, username) => {
  try {
    const url = `https://twitter.com/${username}/status/${tweet.id}`;
    const content = `${parody}\n\n${url}`;
    await rwClient.v2.tweet(content);
    log(`[${username}] ✅ Parody posted.`);
  } catch (e) {
    log(`[${username}] ❌ Failed to post tweet: ${e.message}`);
  }
};

const runBot = async (username) => {
  try {
    log(`[${username}] Checking for latest tweet...`);
    const tweet = await getLatestTweet(username);
    if (!tweet) return log(`[${username}] ⚠️ No tweet found.`);

    const parody = await generateParody(tweet.text);
    if (!parody) return log(`[${username}] ⚠️ Parody generation failed.`);

    await quoteTweet(tweet, parody, username);
  } catch (e) {
    if (e.code === 429) {
      log(`[${username}] ⚠️ Rate limit hit. Skipping.`);
    } else {
      log(`[${username}] ❌ Error: ${e.message}`);
    }
  }
};

const start = async () => {
  log(`🚀 Bot started: 1 account every ${INTERVAL_MINUTES} minutes...`);
  for (let i = 0; ; i = (i + 1) % targetAccounts.length) {
    const username = targetAccounts[i];
    await runBot(username);
    log(`⏳ Waiting ${INTERVAL_MINUTES} minutes before next account...`);
    await new Promise((r) => setTimeout(r, DELAY_PER_ACCOUNT));
  }
};

start();

start();


