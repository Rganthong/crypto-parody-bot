// index.js - versi final dengan HuggingFaceH4/zephyr-7b-beta, tanpa OpenAI
const axios = require("axios");
const fs = require("fs");
const { TwitterApi } = require("twitter-api-v2");
const BEARER_TOKENS = process.env.BEARER_TOKENS.split(",").map((k) => k.trim());
const HF_TOKEN = process.env.HUGGINGFACE_TOKEN;

const TARGET_ACCOUNTS = [
  "whale_alert",
  "BitcoinMagazine",
  "lookonchain",
  "CoinDesk"
];

const CHECK_INTERVAL_MINUTES = 15;
const HUGGINGFACE_MODEL = "HuggingFaceH4/zephyr-7b-beta";
const MAX_TWEET_LENGTH = 280;

let currentTokenIndex = 0;
const usedTweets = new Set();

async function getLatestTweet(username, client) {
  try {
    const user = await client.v2.userByUsername(username);
    const tweets = await client.v2.userTimeline(user.data.id, { max_results: 5 });
    for (const tweet of tweets.data?.data || []) {
      if (!usedTweets.has(tweet.id)) {
        usedTweets.add(tweet.id);
        return tweet;
      }
    }
    return null;
  } catch (e) {
    console.error(`[${username}] Failed to fetch tweet:`, e.message);
    return null;
  }
}

async function generateParodyTweet(text) {
  const prompt = `Rewrite this crypto tweet as a delusional, toxic, and absurd parody (Crypto Twitter style). Be wild but short. Tweet: ${text}`;

  while (true) {
    try {
      const res = await axios.post(
        `https://api-inference.huggingface.co/models/${HUGGINGFACE_MODEL}`,
        { inputs: prompt, parameters: { max_new_tokens: 100, temperature: 1.3 } },
        { headers: { Authorization: `Bearer ${HF_TOKEN}` } }
      );

      const output = res.data?.[0]?.generated_text || "";
      const cleaned = output.replace(/^.*Tweet:/i, "").trim();
      if (cleaned.length <= MAX_TWEET_LENGTH) return cleaned;
      console.log(`[AI] Retry: Result > 280 chars (${cleaned.length})`);
    } catch (err) {
      console.error(`[AI] Error:`, err.response?.status, err.response?.data?.error || err.message);
      if (err.response?.status === 429) {
        console.log(`[AI] Rate limited. Waiting 30s before retry...`);
        await new Promise((r) => setTimeout(r, 30000));
      } else {
        return null;
      }
    }
  }
}

async function postQuoteTweet(client, originalTweet, parodyText) {
  try {
    await client.v2.tweet({
      text: `${parodyText}\n\nhttps://twitter.com/${originalTweet.author_id}/status/${originalTweet.id}`
    });
    console.log(`[Tweeted] ${parodyText}`);
  } catch (e) {
    console.error(`[Post] Failed:`, e.message);
  }
}

async function runBot() {
  console.log(`[${new Date().toISOString()}] 🚀 Bot started...`);
  for (const account of TARGET_ACCOUNTS) {
    const token = BEARER_TOKENS[currentTokenIndex % BEARER_TOKENS.length];
    currentTokenIndex++;
    const client = new TwitterApi(token);
    console.log(`[${account}] Checking for latest tweet...`);
    const tweet = await getLatestTweet(account, client);
    if (!tweet) {
      console.log(`[${account}] No new tweet found.`);
      continue;
    }
    const parody = await generateParodyTweet(tweet.text);
    if (!parody) {
      console.log(`[${account}] Skipped due to AI failure.`);
      continue;
    }
    await postQuoteTweet(client, tweet, parody);
    console.log(`[${account}] Done. Waiting ${CHECK_INTERVAL_MINUTES} minutes...`);
    await new Promise((r) => setTimeout(r, CHECK_INTERVAL_MINUTES * 60 * 1000));
  }
  console.log(`[Cycle] All done. Restarting full loop in 1 minute...`);
  setTimeout(runBot, 60000);
}

runBot();


