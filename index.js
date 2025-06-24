const { TwitterApi } = require('twitter-api-v2');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// === Load env ===
require('dotenv').config();
const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});
const rwClient = client.readWrite;

// === Settings ===
const TARGET_ACCOUNTS = [
  'whale_alert',
  'BitcoinMagazine',
  'lookonchain',
  'CoinDesk'
];

const INTERVAL_MINUTES = 15;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 30000;
const OPENAI_KEYS = process.env.OPENAI_API_KEYS.split(',').map(k => k.trim());
let currentKeyIndex = 0;

// === Helpers ===
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getLatestTweet(username) {
  const user = await client.v2.userByUsername(username);
  const tweets = await client.v2.userTimeline(user.data.id, { exclude: 'replies', max_results: 5 });
  return tweets.data.data?.[0];
}

async function generateParody(text) {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    const key = OPENAI_KEYS[currentKeyIndex];
    try {
      const res = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: 'You are a crypto shitposter. Rewrite tweets into wild, toxic, and absurd parody form, using CT (crypto Twitter) slang. Keep it short. Add sarcasm.'
            },
            {
              role: 'user',
              content: `Parody this tweet: ${text}`
            }
          ],
          max_tokens: 140
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
          }
        }
      );
      const parody = res.data.choices[0].message.content.trim();
      return parody;
    } catch (err) {
      if (err.response?.status === 429) {
        console.log(`[AI] Error 429: Rate limit hit on key ${currentKeyIndex + 1}. Retrying in 30s...`);
        currentKeyIndex = (currentKeyIndex + 1) % OPENAI_KEYS.length;
        attempt++;
        await delay(RETRY_DELAY_MS);
      } else {
        console.error('[AI] Failed to generate parody:', err.message);
        return null;
      }
    }
  }
  return null;
}

async function getTrendingHashtags() {
  try {
    const res = await axios.get('https://api.tweepsmap.com/v3/twitter/trends?location=global');
    const tags = res.data.trends.slice(0, 3).map(t => t.name).filter(t => t.startsWith('#'));
    return tags.join(' ');
  } catch {
    return '#crypto #degen';
  }
}

async function runBot() {
  console.log(`[${new Date().toISOString()}] 🚀 Bot started...`);

  for (const username of TARGET_ACCOUNTS) {
    console.log(`[${new Date().toISOString()}] [${username}] Checking for latest tweet...`);

    try {
      const tweet = await getLatestTweet(username);
      if (!tweet || !tweet.text || tweet.text.length < 10) {
        console.log(`[${username}] ❌ No valid tweet found.`);
        continue;
      }

      const parody = await generateParody(tweet.text);
      if (!parody) {
        console.log(`[${username}] ⚠️ Parody generation failed.`);
        continue;
      }

      const hashtags = await getTrendingHashtags();
      const fullTweet = `${parody}\n\n${hashtags}\n\nhttps://twitter.com/${username}/status/${tweet.id}`;

      // Ensure tweet under 280 chars
      const finalTweet = fullTweet.length > 280 ? fullTweet.slice(0, 277) + '...' : fullTweet;

      await rwClient.v2.tweet(finalTweet);
      console.log(`[${username}] ✅ Tweet posted:\n${finalTweet}`);
    } catch (err) {
      console.error(`[${username}] ❌ Error:`, err.message);
    }

    console.log(`[${username}] ⏳ Waiting ${INTERVAL_MINUTES} minutes...\n`);
    await delay(INTERVAL_MINUTES * 60 * 1000);
  }

  // Restart loop
  console.log(`♻️ Cycle complete. Restarting...\n`);
  runBot();
}

runBot();


