import { chromium, Browser, Page } from 'playwright';
import { ArticleData, ScrapeOptions, ScrapeResult } from './types';
import Bluebird = require('bluebird');

export class TrinidadExpressScraper {
  private browser: Browser | null = null;
  private options: Required<ScrapeOptions>;

  constructor(options: ScrapeOptions = {}) {
    this.options = {
      timeout: options.timeout || 30000,
      retries: options.retries || 3,
      delay: options.delay || 1000,
      headless: options.headless !== false
    };
  }

  async init(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({ 
        headless: this.options.headless,
        args: ['--no-sandbox', '--disable-dev-shm-usage']
      });
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async scrapeArticle(url: string): Promise<ScrapeResult> {
    for (let attempt = 1; attempt <= this.options.retries; attempt++) {
      try {
        await this.init();
        const page = await this.browser!.newPage();
        
        // Set a large viewport for consistent rendering
        await page.setViewportSize({ width: 2600, height: 1080 });
        
        await page.setDefaultTimeout(this.options.timeout);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

        await page.waitForLoadState('domcontentloaded');
        await page.waitForSelector('.asset .asset-header h1', { timeout: 10000 });

        const articleData = await this.extractArticleData(page, url);
        await page.close();

        return {
          success: true,
          data: articleData
        };

      } catch (error) {
        console.log(`Attempt ${attempt} failed for ${url}:`, error);
        
        if (attempt === this.options.retries) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            data: {
              url,
              title: '',
              publishedDate: '',
              category: [],
              content: '',
              readingTime: '',
              source: '',
              scrapedAt: new Date()
            }
          };
        }
        
        await this.delay(this.options.delay * attempt);
      }
    }

    return {
      success: false,
      error: 'Max retries exceeded',
      data: {
        url,
        title: '',
        publishedDate: '',
        category: [],
        content: '',
        readingTime: '',
        source: '',
        scrapedAt: new Date()
      }
    };
  }

  private async extractArticleData(page: Page, url: string): Promise<ArticleData> {
    const title = await this.safeTextContent(page, '.asset .asset-header h1');
    
    let publishedDate = '';
    try {
      // Try to get date from .asset-date selector first
      const dateElement = await page.$('.asset-date');
      if (dateElement) {
        const dateText = await dateElement.textContent();
        if (dateText && dateText.trim()) {
          publishedDate = dateText.trim();
        }
      }
      
      // Fallback to datetime attribute if text content failed
      if (!publishedDate && dateElement) {
        const datetimeAttr = await dateElement.getAttribute('datetime');
        if (datetimeAttr) {
          publishedDate = datetimeAttr;
        }
      }
      
    } catch (e) {
      publishedDate = '';
    }

    const categoryElements = await page.$$('.breadcrumb > li');
    const category: string[] = [];
    for (const element of categoryElements) {
      const text = await element.textContent();
      if (text && text.trim() !== 'Home') {
        category.push(text.trim());
      }
    }

    const contentElements = await page.$$('.asset .asset-body p');
    const contentParts: string[] = [];
    for (const element of contentElements) {
      const text = await element.textContent();
      if (text && text.trim()) {
        contentParts.push(text.trim());
      }
    }
    const content = contentParts.join('\n\n');

    let readingTime = '';
    try {
      const readingTimeText = await page.textContent('text=/min to read/');
      if (readingTimeText) {
        readingTime = readingTimeText.trim();
      }
    } catch (e) {
      readingTime = '';
    }

    let source = '';
    try {
      const sourceText = await page.textContent('text=/Reprinted from/');
      if (sourceText) {
        source = sourceText.trim();
      }
    } catch (e) {
      source = '';
    }

    return {
      url,
      title,
      publishedDate,
      category,
      content,
      readingTime,
      source,
      scrapedAt: new Date()
    };
  }

  private async safeTextContent(page: Page, selector: string): Promise<string> {
    try {
      const element = await page.$(selector);
      if (element) {
        const text = await element.textContent();
        return text?.trim() || '';
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  async scrapeMultipleArticles(urls: string[], concurrency: number = 1): Promise<ScrapeResult[]> {
    console.log(`Starting to scrape ${urls.length} articles with concurrency: ${concurrency}`);
    
    if (concurrency === 1) {
      return await this.scrapeSequentially(urls);
    } else {
      return await this.scrapeInParallel(urls, concurrency);
    }
  }

  private async scrapeSequentially(urls: string[]): Promise<ScrapeResult[]> {
    const results: ScrapeResult[] = [];
    
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`Scraping article ${i + 1}/${urls.length}: ${url}`);
      
      const result = await this.scrapeArticle(url);
      results.push(result);
      
      if (result.success) {
        console.log(`✓ Successfully scraped: ${result.data?.title}`);
      } else {
        console.log(`✗ Failed to scrape: ${result.error}`);
      }
      
      if (i < urls.length - 1) {
        await this.delay(this.options.delay);
      }
    }
    
    console.log(`Completed scraping. Success: ${results.filter(r => r.success).length}/${urls.length}`);
    return results;
  }

  private async scrapeInParallel(urls: string[], concurrency: number): Promise<ScrapeResult[]> {
    console.log(`Processing ${urls.length} URLs with ${concurrency} concurrent scrapers using Bluebird`);
    
    // Use Bluebird.map with concurrency control
    const results = await Bluebird.map<string, ScrapeResult>(urls, async (url: string, index: number) => {
      const urlNumber = index + 1;
      console.log(`🔄 [${urlNumber}/${urls.length}] Starting: ${url}`);
      
      const result = await this.scrapeArticle(url);
      
      if (result.success) {
        console.log(`✅ [${urlNumber}/${urls.length}] Success: ${result.data?.title}`);
      } else {
        console.log(`❌ [${urlNumber}/${urls.length}] Failed: ${result.error}`);
      }
      
      return result;
    }, { 
      concurrency: concurrency 
    });
    
    const totalSuccess = results.filter((r: ScrapeResult) => r.success).length;
    console.log(`\n🎉 Parallel scraping completed! Success: ${totalSuccess}/${urls.length}`);
    
    return results;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}