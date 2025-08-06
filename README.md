# Trinidad Express Article Scraper

A Playwright-based web scraper for extracting article data from Trinidad Express website.

## Features

- **URL Collection**: Automatically collect thousands of article URLs using infinite scroll
- **Bulk Scraping**: Process large batches of articles with progress tracking
- **Parallel Processing**: Scrape multiple articles simultaneously for faster performance
- **Data Extraction**: Extract title, content, category, publication date, and metadata
- **Multiple Export Formats**: JSON and/or CSV export with metadata
- **Failed URL Tracking**: Automatically track and retry failed scraping attempts
- **Resume Functionality**: Continue from where you left off if interrupted
- **Error Handling**: Built-in retry logic and comprehensive error handling
- **Rate Limiting**: Respectful delays between requests with parallel support
- **TypeScript Support**: Full type definitions included

## Installation

```bash
npm install
```

This will install Playwright and other dependencies. Browser binaries are downloaded automatically.

## Usage

### Basic Usage

```typescript
import { scrapeArticles, scrapeArticle } from './src';

// Scrape a single article
const results = await scrapeArticle('https://trinidadexpress.com/path/to/article');

// Scrape multiple articles
const urls = [
  'https://trinidadexpress.com/article1',
  'https://trinidadexpress.com/article2'
];
const results = await scrapeArticles(urls);
```

### Advanced Usage with Options

```typescript
import { scrapeArticles } from './src';

const results = await scrapeArticles(urls, {
  timeout: 30000,        // 30 second timeout per page
  retries: 3,            // Retry failed requests 3 times
  delay: 2000,           // 2 second delay between requests
  concurrency: 5,        // Scrape 5 articles in parallel
  headless: true,        // Run browser in headless mode
  exportFormat: 'both',  // Export to both JSON and CSV
  outputFilename: 'my_articles' // Custom filename
});
```

### URL Collection Only

```typescript
import { collectUrls } from './src';

// Collect 10,000 article URLs
const result = await collectUrls(10000, {
  scrollDelay: 2000,     // Wait 2 seconds between scrolls
  headless: true,        // Run in headless mode
  resumeFromFile: true   // Resume from existing progress
});

console.log(`Collected ${result.totalCollected} URLs`);
```

### Bulk Scraping (Full Pipeline)

```typescript
import { bulkScrape } from './src';

// Collect URLs and scrape articles in one go
const result = await bulkScrape({
  targetUrlCount: 5000,  // Collect up to 5000 URLs
  batchSize: 50,         // Process 50 articles at a time
  concurrency: 5,        // Scrape 5 articles in parallel within each batch
  exportFormat: 'both',  // Export to both JSON and CSV
  headless: true
});

console.log(`Scraped ${result.scrapingResults.filter(r => r.success).length} articles`);
```

### Using the Classes Directly

```typescript
import { URLCollector, TrinidadExpressScraper, DataExporter } from './src';

// First, collect URLs
const collector = new URLCollector({ targetCount: 1000 });
const urlResult = await collector.collectArticleUrls();
await collector.close();

// Then scrape the collected articles
const scraper = new TrinidadExpressScraper({
  timeout: 30000,
  retries: 2,
  delay: 1000,
  headless: true
});

const results = await scraper.scrapeMultipleArticles(urlResult.urls, 3); // 3 parallel scrapers
await scraper.close();

// Finally, export results
const exporter = new DataExporter('./my-output');
await exporter.exportToJSON(results);
await exporter.exportToCSV(results);
```

## Scripts

- `npm run start` - Run the test scraper with the example article
- `npm run dev` - Run in development mode with file watching
- `npm run build` - Compile TypeScript to JavaScript
- `npm run collect-urls [count]` - Collect article URLs (default: 10000)
- `npm run bulk-scrape [count]` - Run full pipeline: collect URLs and scrape articles (default: 1000)
- `npm run retry-failed <file>` - Retry scraping failed URLs from a failed URLs file

## Output Format

### JSON Structure
```json
{
  "metadata": {
    "totalArticles": 1,
    "successfulScrapes": 1,
    "failedScrapes": 0,
    "exportedAt": "2025-08-06T10:11:05.382Z"
  },
  "articles": [
    {
      "url": "https://trinidadexpress.com/...",
      "title": "Article Title",
      "publishedDate": "2025-08-04",
      "category": ["Opinion", "Columnists"],
      "content": "Full article text...",
      "readingTime": "2 min to read",
      "source": "Source information if available",
      "scrapedAt": "2025-08-06T10:11:05.357Z"
    }
  ],
  "failedUrls": [
    {
      "url": "https://trinidadexpress.com/failed-article/...",
      "error": "Timeout after 30000ms",
      "timestamp": "2025-08-06T10:15:30.123Z"
    }
  ]
}
```

### CSV Format
Contains columns: URL, Title, Published Date, Category, Content, Reading Time, Source, Scraped At

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| timeout | number | 30000 | Page load timeout in milliseconds |
| retries | number | 3 | Number of retry attempts for failed requests |
| delay | number | 1000 | Delay between requests in milliseconds |
| concurrency | number | 1 | Number of articles to scrape in parallel |
| batchSize | number | 50 | Number of URLs to process in each batch |
| headless | boolean | true | Run browser in headless mode |
| exportFormat | 'json' \| 'csv' \| 'both' | 'json' | Export format |
| outputFilename | string | auto-generated | Custom output filename |

## Error Handling

The scraper includes comprehensive error handling:
- Automatic retries for failed requests
- Graceful handling of missing page elements
- Detailed error reporting in results
- Browser cleanup on completion or failure

## Rate Limiting

The scraper includes built-in delays between requests to be respectful to the Trinidad Express website. The default delay is 1 second, but this can be configured.

## Requirements

- Node.js 14 or higher
- NPM or Yarn package manager