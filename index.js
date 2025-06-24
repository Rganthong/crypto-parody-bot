// index.js
const { TwitterApi } = require('twitter-api-v2');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const logFile = 'log.txt';
const cacheFile = 'cache.json';
const INTERVAL_MINUTES = 15;
const DELAY_BETWEEN_ACCOUNTS_MS = INTERVAL_MINUTES * 60 * 1000;

const targetAccounts = [
  "whale_alert",
  "CoinDesk",
  "lookonchain",
  "BitcoinMagazine"
];

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

let tweetCache = {};
try {
  tweetCache = JSON.parse(fs.readFileSync(cacheFile));
} catch {
  tweetCache = {};
}

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

async function generateParody(text) {
  try {
    const response = await axios.post(
      'https://api-inference.huggingface.co/models/HuggingFaceH4/zephyr-7b-beta',
      {
        inputs: `Turn this crypto tweet into an unhinged, extremely delusional shitpost full of sarcasm, absurdity, and CT (Crypto Twitter) energy. Keep it short and under 280 characters:\n\n"${text}"`,
        parameters: {
          max_new_tokens: 60,
          return_full_text: false
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HF_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const result = response.data[0]?.generated_text?.trim();
    return result || null;
  } catch {
    return null;
  }
}

async function processAccount(username) {
  log(`[${username}] Checking for latest tweet...`);

  try {
    const user = await client.v2.userByUsername(username);
    if (!user?.data?.id) {
      log(`[${username}] ❌ Failed to get user ID.`);
      return;
    }

    const tweets = await client.v2.userTimeline(user.data.id, {
      max_results: 1,
      exclude: ['retweets', 'replies'],
      tweet: {
        fields: ['created_at']
      }
    });

    const latest = tweets.data?.data?.[0];
    if (!latest) {
      log(`[${username}] No recent tweet found.`);
      return;
    }

    if (tweetCache[username] === latest.id) {
      log(`[${username}] ✅ Sudah diproses sebelumnya. Skip.`);
      return;
    }

    const tweetText = latest.text;
    const tweetUrl = `https://twitter.com/${username}/status/${latest.id}`;

    const parody = await generateParody(tweetText);
    if (!parody) {
      log(`[${username}] ⚠️ Parody generation failed, skipping.`);
      return;
    }

    const post = `${parody}\n\n${tweetUrl}`;
    await client.v2.tweet(post);
    log(`[${username}] ✅ Parody posted.`);

    tweetCache[username] = latest.id;
    fs.writeFileSync(cacheFile, JSON.stringify(tweetCache, null, 2));

  } catch (err) {
    if (err.code === 429) {
      log(`[${username}] ⚠️ Rate limit hit. Skipping.`);
    } else {
      log(`[${username}] ❌ Error: ${err.message}`);
    }
  }
}

async function runCycle() {
  log(`🚀 Bot started: 1 account every ${INTERVAL_MINUTES} minutes...`);

  for (const username of targetAccounts) {
    await processAccount(username);
    log(`⏳ Waiting ${INTERVAL_MINUTES} minutes before next account...`);
    await new Promise((res) => setTimeout(res, DELAY_BETWEEN_ACCOUNTS_MS));
  }

  log(`🔁 Full cycle complete. Restarting in ${INTERVAL_MINUTES} minutes...`);
  setTimeout(runCycle, DELAY_BETWEEN_ACCOUNTS_MS);
}

runCycle();
