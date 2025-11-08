# Lucid Analytics Dashboard

A mobile-responsive web dashboard for querying your Studio API usage analytics using natural language. Built for on-the-go access from iPad and iPhone.

## Features

- **AI-Powered Chat Interface**: Ask questions in natural language about your API usage
- **Mobile-Optimized**: Touch-friendly UI designed for iPad and iPhone
- **Real-time Analytics**: Query your usage logs with instant results
- **SQL Transparency**: See the generated SQL queries and explanations
- **Export Functionality**: Download results as CSV for further analysis
- **Dark Mode**: Easy on the eyes for all-day use
- **Secure**: API key stored in browser localStorage, never sent to third parties

## Quick Start

### Option 1: Deploy to Vercel (Recommended)

1. **Install Vercel CLI** (if you haven't already):
   ```bash
   npm install -g vercel
   ```

2. **Deploy from this directory**:
   ```bash
   cd dashboard
   vercel
   ```

3. **Follow the prompts**:
   - Set up and deploy? `Y`
   - Which scope? (Select your account)
   - Link to existing project? `N`
   - Project name? `lucid-analytics` (or your choice)
   - In which directory is your code located? `./`
   - Want to modify settings? `N`

4. **Access your dashboard**:
   - Vercel will provide a URL like: `https://lucid-analytics.vercel.app`
   - Open it on your iPad or iPhone

### Option 2: Deploy via Vercel Dashboard

1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Import your repository
4. Set the **Root Directory** to `dashboard`
5. Click "Deploy"

### Option 3: Run Locally

```bash
cd dashboard
python3 -m http.server 8080
# Or use any static file server
```

Then open `http://localhost:8080` in your browser.

## Configuration

When you first open the dashboard, you'll need to configure:

1. **API URL**: Your Studio API URL (e.g., `https://your-api.railway.app`)
   - This is your Railway deployment URL
   - Don't include trailing slash

2. **APP_KEY**: Your authentication key
   - This is the `APP_KEY` from your Studio API environment variables
   - Used for authentication with analytics endpoints

Both values are stored securely in your browser's localStorage and never sent to third parties.

## Usage

### Example Questions

Try asking questions like:

- "How much did arno-ios spend last week?"
- "Which app used the most OpenAI requests yesterday?"
- "Show me total costs by provider"
- "What are the top 5 most expensive models?"
- "Show me all failed requests in the last 24 hours"
- "Which endpoint has the highest average cost?"
- "Show me Claude usage for studio-mobile this month"

### Features

- **Natural Language**: Ask questions in plain English
- **SQL Display**: See exactly what query was generated
- **Results Table**: Clean, scrollable table with all results
- **CSV Export**: Download results for Excel or Google Sheets
- **Mobile-Friendly**: Optimized for touch and small screens
- **Quick Examples**: Tap example questions to get started fast

## Technical Details

### Architecture

- **Frontend**: Single-page static HTML (vanilla JavaScript)
- **Backend**: Studio API on Railway (Node.js + Express + SQLite)
- **Database**: SQLite with usage logs
- **AI**: OpenAI GPT-4o-mini for SQL generation

### API Endpoints Used

- `POST /v1/analytics/chat`: Natural language query endpoint
  - Requires `x-app-key` header
  - Accepts `{ question: string }`
  - Returns `{ sql, explanation, results, resultCount }`

### Browser Support

- iOS Safari 12+
- Chrome/Edge (mobile and desktop)
- Firefox (mobile and desktop)

### Security

- API key stored in browser localStorage (client-side only)
- HTTPS enforced by Vercel
- CORS handled by Studio API
- No third-party analytics or tracking

## Development

### File Structure

```
dashboard/
├── index.html       # Main dashboard (HTML + CSS + JS)
├── vercel.json      # Vercel configuration
└── README.md        # This file
```

### Customization

To customize the dashboard, edit `index.html`:

- **Colors**: Modify CSS variables in `:root`
- **Example Questions**: Edit the example buttons section
- **Styling**: Update the `<style>` section
- **Behavior**: Modify the `<script>` section

## Troubleshooting

### "Unauthorized" Error

- Check that your APP_KEY is correct
- Verify your Studio API is running and accessible
- Make sure the API URL doesn't have a trailing slash

### CORS Errors

- Ensure your Studio API has CORS enabled
- Check that `cors()` middleware is applied in your Express app

### No Results

- Try a simpler question first
- Check the generated SQL query for syntax errors
- Verify your database has usage logs

### Mobile Issues

- Clear browser cache and reload
- Check that you're using HTTPS (required for localStorage)
- Try in Safari if using another iOS browser

## Support

For issues or questions:

1. Check the Studio API logs on Railway
2. Inspect browser console for JavaScript errors
3. Verify network requests in browser DevTools

## License

MIT
