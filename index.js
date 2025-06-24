// crypto-parody-bot/index.js
require("dotenv").config();
const axios = require("axios");
const { TwitterApi } = require("twitter-api-v2");
const fs = require("fs");

const INTERVAL_MINUTES = 15;
const DELAY_PER_ACCOUNT = INTERVAL_MINUTES * 60 * 1000;
const targetAccounts = [
  "whale_alert",
  "BitcoinMagazine",
  "lookonchain",
  "CoinDesk"
];

// Multiple OpenAI API keys (comma-separated in .env)
const OPENAI_KEYS = process.env.OPENAI_API_KEYS.split(",").map((key) => key.trim());
let currentKeyIndex = 0;

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

const generateParody = async (text, retries = 5, delay = 30000) => {
  for (let i = 0; i < retries; i++) {
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
            Authorization: `Bearer ${OPENAI_KEYS[currentKeyIndex]}`,
            "Content-Type": "application/json",
          },
          timeout: 20000,
        }
      );
      const parody = res.data.choices[0].message.content.trim();
      if (parody.length > 220) return null;
      return parody;
    } catch (e) {
      if (e.response?.status === 429) {
        log(`[AI] ⚠️ Key ${currentKeyIndex + 1} hit rate limit. Switching key & retrying in ${delay / 1000}s...`);
        currentKeyIndex = (currentKeyIndex + 1) % OPENAI_KEYS.length;
        await new Promise((r) => setTimeout(r, delay));
      } else {
        log(`[AI] ❌ Error: ${e.message}`);
        return null;
      }
    }
  }
  log(`[AI] ❌ All API keys failed after ${retries} retries.`);
  return null;
};

const getTrendingHashtags = async () => {
  try {
    const { data } = await twitterClient.v1.get("trends/place.json", {
      id: 1
    });

    const hashtags = data[0].trends
      .map((trend) => trend.name)
      .filter((name) => name.startsWith("#"))
      .filter((tag) => /crypto|btc|eth|web3|sol|doge|bitcoin|ethereum/i.test(tag))
      .slice(0, 3);

    return hashtags;
  } catch (e) {
    log(`⚠️ Failed to fetch trending hashtags: ${e.message}`);
    return [];
  }
};

const quoteTweet = async (tweet, parody, username) => {
  try {
    const url = `https://twitter.com/${username}/status/${tweet.id}`;
    const hashtags = await getTrendingHashtags();
    const hashtagLine = hashtags.join(" ");

    const fullText = `${parody}\n\n${url}\n\n${hashtagLine}`;
    if (fullText.length > 280) {
      log(`[${username}] ⚠️ Skipped tweet: exceeds 280 characters.`);
      return;
    }

    await rwClient.v2.tweet(fullText);
    log(`[${username}] ✅ Parody with hashtags posted.`);
  } catch (e) {
    log(`[${username}] ❌ Failed to post tweet: ${e.message}`);
  }
};

const runBot = async (username) => {
  try {
    log(`[${username}] Checking for latest tweet...`);
    const tweet = await getLatestTweet(username);
    if (!tweet) {
      log(`[${username}] ⚠️ No tweet found.`);
      return false;
    }

    const parody = await generateParody(tweet.text);
    if (!parody) {
      log(`[${username}] ⚠️ Parody generation failed.`);
      return false;
    }

    await quoteTweet(tweet, parody, username);
    return true;
  } catch (e) {
    if (e.code === 429 || e.response?.status === 429) {
      log(`[${username}] ⚠️ Rate limit hit. Skipping.`);
    } else {
      log(`[${username}] ❌ Error: ${e.message}`);
    }
    return false;
  }
};

const start = async () => {
  log(`🚀 Bot started: 1 full cycle every 60 minutes (1 account / ${INTERVAL_MINUTES}m)...`);
  for (let i = 0; ; i = (i + 1) % targetAccounts.length) {
    const username = targetAccounts[i];
    const result = await runBot(username);
    if (!result) {
      log(`[${username}] ⏭️ Skipping wait — moving to next account.`);
      continue;
    }
    log(`⏳ Waiting ${INTERVAL_MINUTES} minutes before next account...`);
    await new Promise((r) => setTimeout(r, DELAY_PER_ACCOUNT));
  }
};

start();

