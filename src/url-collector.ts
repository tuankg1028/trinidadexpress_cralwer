import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface CollectorOptions {
  targetCount?: number;
  timeout?: number;
  pageDelay?: number;
  maxPages?: number;
  saveInterval?: number;
  headless?: boolean;
  resumeFromFile?: boolean;
  outputFile?: string;
}

export interface CollectionResult {
  urls: string[];
  totalCollected: number;
  success: boolean;
  error?: string;
}

export class URLCollector {
  private browser: Browser | null = null;
  private options: Required<CollectorOptions>;
  private collectedUrls: Set<string> = new Set();
  private outputDir: string = './output';

  constructor(options: CollectorOptions = {}) {
    this.options = {
      targetCount: options.targetCount || 10000,
      timeout: options.timeout || 60000,
      pageDelay: options.pageDelay || 2000,
      maxPages: options.maxPages || 100,
      saveInterval: options.saveInterval || 100,
      headless: options.headless !== false,
      resumeFromFile: options.resumeFromFile || false,
      outputFile: options.outputFile || 'collected_urls.json'
    };
  }

  async init(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({ 
        headless: this.options.headless,
        args: ['--no-sandbox', '--disable-dev-shm-usage']
      });
    }
    
    await fs.mkdir(this.outputDir, { recursive: true });
    
    if (this.options.resumeFromFile) {
      await this.loadExistingUrls();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async collectArticleUrls(baseUrl: string = 'https://trinidadexpress.com/search/'): Promise<CollectionResult> {
    try {
      await this.init();
      const page = await this.browser!.newPage();
      
      console.log(`Starting URL collection from: ${baseUrl}`);
      console.log(`Target: ${this.options.targetCount} URLs`);
      console.log(`Already collected: ${this.collectedUrls.size} URLs`);

      await page.setDefaultTimeout(this.options.timeout);
      
      // Set a large viewport to see more content (desktop view)
      await page.setViewportSize({ width: 1920, height: 2160 });
      
      await page.goto(baseUrl, { waitUntil: 'load' });

      let currentPage = 1;
      let lastUrlCount = this.collectedUrls.size;
      let stagnantPages = 0;
      const maxStagnantPages = 3;

      while (
        this.collectedUrls.size < this.options.targetCount && 
        currentPage <= this.options.maxPages
      ) {
        // Generate URL for current page
        const pageUrl = this.generatePageUrl(baseUrl, currentPage);
        console.log(`Visiting page ${currentPage}: ${pageUrl}`);
        
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
        
        // Scroll to bottom to ensure page fully loads
        await this.scrollToBottomAndWait(page);
        
        // Extract URLs from current page
        const newUrls = await this.extractArticleUrls(page);
        const prevCount = this.collectedUrls.size;
        
        newUrls.forEach(url => this.collectedUrls.add(url));
        
        const newUrlsFound = this.collectedUrls.size - prevCount;
        console.log(`Page ${currentPage}: Found ${newUrlsFound} new URLs (Total: ${this.collectedUrls.size})`);

        // Save progress periodically
        if (this.collectedUrls.size % this.options.saveInterval === 0 || 
            this.collectedUrls.size - lastUrlCount >= this.options.saveInterval) {
          await this.saveUrls();
          lastUrlCount = this.collectedUrls.size;
        }

        // Check if we found new URLs
        if (newUrlsFound === 0) {
          stagnantPages++;
          if (stagnantPages >= maxStagnantPages) {
            console.log('No new URLs found after multiple pages. Stopping collection.');
            break;
          }
        } else {
          stagnantPages = 0;
        }

        // Stop if we've reached our target
        if (this.collectedUrls.size >= this.options.targetCount) {
          console.log(`Target of ${this.options.targetCount} URLs reached!`);
          break;
        }

        currentPage++;
      }

      // Final save
      await this.saveUrls();
      await page.close();

      return {
        urls: Array.from(this.collectedUrls),
        totalCollected: this.collectedUrls.size,
        success: true
      };

    } catch (error) {
      return {
        urls: Array.from(this.collectedUrls),
        totalCollected: this.collectedUrls.size,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async extractArticleUrls(page: Page): Promise<string[]> {
    return await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="article_"]');
      const urls: string[] = [];
      
      links.forEach((link) => {
        const href = (link as HTMLAnchorElement).href;
        if (href && href.includes('article_')) {
          // Filter out social media and external URLs, keep only Trinidad Express article URLs
          if (
            href.includes('trinidadexpress.com') && 
            !href.includes('facebook.com') && 
            !href.includes('twitter.com') && 
            !href.includes('wa.me') && 
            !href.includes('mailto:') &&
            !href.includes('utm_medium=social')
          ) {
            try {
              const absoluteUrl = new URL(href, window.location.origin).toString();
              // Clean URL by removing query parameters
              const cleanUrl = absoluteUrl.split('?')[0];
              urls.push(cleanUrl);
            } catch (e) {
              // Skip invalid URLs
            }
          }
        }
      });
      
      return [...new Set(urls)]; // Remove duplicates
    });
  }

  private generatePageUrl(baseUrl: string, page: number): string {
    // Calculate offset: page 1 = offset 1010, page 2 = offset 2010, etc.
    const offset = (page * 1000) + 10;
    
    // Parse base URL and add/update the offset parameter
    const url = new URL(baseUrl);
    url.searchParams.set('o', offset.toString());
    url.searchParams.set('q', '');
    url.searchParams.set('t', 'article');
    url.searchParams.set('d1', '1000 days ago');
    url.searchParams.set('l', '1000');
    url.searchParams.set('app[0]', 'editorial');
    return url.toString();
  }

  private async scrollToBottomAndWait(page: Page): Promise<void> {
    // Get current scroll height
    const previousHeight = await page.evaluate(() => document.body.scrollHeight);
    
    // Scroll to bottom
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    // Wait for potential new content to load
    await page.waitForTimeout(this.options.pageDelay);

    // Check if new content was loaded by comparing scroll height
    try {
      await page.waitForFunction(
        (prevHeight) => document.body.scrollHeight > prevHeight,
        previousHeight,
        { timeout: this.options.pageDelay }
      );
    } catch (e) {
      // Timeout is fine, just means no new content loaded
    }

    // Additional wait for network requests to complete
    try {
      await page.waitForLoadState('networkidle', { timeout: 10_000 });
    } catch (e) {
      // Timeout is acceptable here
    }
  }

  private async saveUrls(): Promise<void> {
    const outputPath = path.join(this.outputDir, this.options.outputFile);
    const data = {
      collectedAt: new Date().toISOString(),
      totalUrls: this.collectedUrls.size,
      urls: Array.from(this.collectedUrls)
    };
    
    await fs.writeFile(outputPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    console.log(`✓ Saved ${this.collectedUrls.size} URLs to ${outputPath}`);
  }

  private async loadExistingUrls(): Promise<void> {
    try {
      const outputPath = path.join(this.outputDir, this.options.outputFile);
      const data = await fs.readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(data);
      
      if (parsed.urls && Array.isArray(parsed.urls)) {
        parsed.urls.forEach((url: string) => this.collectedUrls.add(url));
        console.log(`Resumed with ${this.collectedUrls.size} existing URLs`);
      }
    } catch (error) {
      console.log('No existing URL file found or failed to load. Starting fresh.');
    }
  }
}