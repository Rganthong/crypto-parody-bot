// crypto-parody-bot/index.js
require("dotenv").config();
const axios = require("axios");
const { TwitterApi } = require("twitter-api-v2");
const fs = require("fs");

const INTERVAL_MINUTES = 60 / 4; // 4 akun per jam (1 akun tiap 15 menit)
const DELAY_PER_ACCOUNT = INTERVAL_MINUTES * 60 * 1000;
const targetAccounts = [
  "whale_alert",
  "BitcoinMagazine",
  "lookonchain",
  "CoinDesk"
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
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a sarcastic and imaginative crypto Twitter shitposter."
          },
          {
            role: "user",
            content: hybridPrompt(text)
          }
        ],
        temperature: 1.1,
        max_tokens: 100,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );
    const out = res.data.choices[0].message.content.trim();
    return out.slice(0, 240);
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
  log(`🚀 Bot started: 1 full cycle every 60 minutes (1 account / ${INTERVAL_MINUTES}m)...`);
  for (let i = 0; ; i = (i + 1) % targetAccounts.length) {
    const username = targetAccounts[i];
    await runBot(username);
    log(`⏳ Waiting ${INTERVAL_MINUTES} minutes before next account...`);
    await new Promise((r) => setTimeout(r, DELAY_PER_ACCOUNT));
  }
};

start();

