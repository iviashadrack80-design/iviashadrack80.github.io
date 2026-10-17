# ShadrackTrades.com — Cloud Sync Setup

This version keeps the existing journal UI/features and adds Supabase email/password authentication plus cloud synchronization.

## 1. Create a Supabase project
Create a Supabase project in the region closest to your users. In the SQL Editor, run `supabase-schema.sql`.

## 2. Configure the browser app
Open `supabase-config.js` and replace the two placeholders with your Supabase project URL and publishable/anon key.

## 3. Deploy the folder to Vercel
Deploy the folder containing:
- `CRT_PRO_Trade_Journal_VOICE_REVIEWS_SETTINGS.html`
- `supabase-config.js`

If the HTML is the root page, rename it to `index.html` before deploying.

## 4. Use on PC and phone
Open the same Vercel/custom-domain link on both devices. Sign in with the same journal account. Trades, reviews and account settings will sync through Supabase instead of being limited to one browser's local storage.

## Existing local data
On the computer that already contains your trades, sign in and click **Sync / Migrate local data**. That uploads the existing local journal to your cloud account.

## Security
Row Level Security is enabled by the SQL script. Each authenticated user can access only rows belonging to their own `user_id`.
