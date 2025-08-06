import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface CollectorOptions {
  targetCount?: number;
  timeout?: number;
  scrollDelay?: number;
  maxScrollAttempts?: number;
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
      scrollDelay: options.scrollDelay || 2000,
      maxScrollAttempts: options.maxScrollAttempts || 50,
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

  async collectArticleUrls(baseUrl: string = 'https://trinidadexpress.com/news/'): Promise<CollectionResult> {
    try {
      await this.init();
      const page = await this.browser!.newPage();
      
      console.log(`Starting URL collection from: ${baseUrl}`);
      console.log(`Target: ${this.options.targetCount} URLs`);
      console.log(`Already collected: ${this.collectedUrls.size} URLs`);

      await page.setDefaultTimeout(this.options.timeout);
      
      // Set a large viewport to see more content (desktop view)
      await page.setViewportSize({ width: 2600, height: 1080 });
      
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

      let scrollAttempts = 0;
      let lastUrlCount = this.collectedUrls.size;
      let stagnantScrolls = 0;
      const maxStagnantScrolls = 5;

      while (
        this.collectedUrls.size < this.options.targetCount && 
        scrollAttempts < this.options.maxScrollAttempts
      ) {
        // Extract URLs from current page state
        const newUrls = await this.extractArticleUrls(page);
        const prevCount = this.collectedUrls.size;
        
        newUrls.forEach(url => this.collectedUrls.add(url));
        
        const newUrlsFound = this.collectedUrls.size - prevCount;
        console.log(`Scroll ${scrollAttempts + 1}: Found ${newUrlsFound} new URLs (Total: ${this.collectedUrls.size})`);

        // Save progress periodically
        if (this.collectedUrls.size % this.options.saveInterval === 0 || 
            this.collectedUrls.size - lastUrlCount >= this.options.saveInterval) {
          await this.saveUrls();
          lastUrlCount = this.collectedUrls.size;
        }

        // Check if we found new URLs
        if (newUrlsFound === 0) {
          stagnantScrolls++;
          if (stagnantScrolls >= maxStagnantScrolls) {
            console.log('No new URLs found after multiple scrolls. Stopping collection.');
            break;
          }
        } else {
          stagnantScrolls = 0;
        }

        // Stop if we've reached our target
        if (this.collectedUrls.size >= this.options.targetCount) {
          console.log(`Target of ${this.options.targetCount} URLs reached!`);
          break;
        }

        // Scroll to bottom and wait for new content
        await this.scrollAndWait(page);
        scrollAttempts++;
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

  private async scrollAndWait(page: Page): Promise<void> {
    // Get current scroll height
    const previousHeight = await page.evaluate(() => document.body.scrollHeight);
    
    // Scroll to bottom
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    // Wait for potential new content to load
    await page.waitForTimeout(this.options.scrollDelay);

    // Check if new content was loaded by comparing scroll height
    try {
      await page.waitForFunction(
        (prevHeight) => document.body.scrollHeight > prevHeight,
        previousHeight,
        { timeout: this.options.scrollDelay }
      );
    } catch (e) {
      // Timeout is fine, just means no new content loaded
    }

    // Additional wait for network requests to complete
    try {
      await page.waitForLoadState('networkidle', { timeout: 3000 });
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