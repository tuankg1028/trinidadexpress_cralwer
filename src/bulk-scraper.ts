import { URLCollector, CollectorOptions } from './url-collector';
import { TrinidadExpressScraper } from './scraper';
import { DataExporter } from './exporter';
import { ScrapeResult } from './types';
import * as fs from 'fs/promises';
import * as Bluebird from 'bluebird';

export interface BulkScrapingOptions {
  // URL Collection options
  targetUrlCount?: number;
  collectionTimeout?: number;
  scrollDelay?: number;
  resumeCollection?: boolean;
  
  // Scraping options
  scrapingTimeout?: number;
  scrapingRetries?: number;
  scrapingDelay?: number;
  batchSize?: number;
  concurrency?: number;
  
  // General options
  headless?: boolean;
  exportFormat?: 'json' | 'csv' | 'both';
  outputPrefix?: string;
}

export class BulkScraper {
  private urlCollector: URLCollector;
  private articleScraper: TrinidadExpressScraper;
  private exporter: DataExporter;
  private options: Required<BulkScrapingOptions>;

  constructor(options: BulkScrapingOptions = {}) {
    this.options = {
      targetUrlCount: options.targetUrlCount || 10000,
      collectionTimeout: options.collectionTimeout || 60000,
      scrollDelay: options.scrollDelay || 2000,
      resumeCollection: options.resumeCollection !== false,
      scrapingTimeout: options.scrapingTimeout || 30000,
      scrapingRetries: options.scrapingRetries || 3,
      scrapingDelay: options.scrapingDelay || 1000,
      batchSize: options.batchSize || 50,
      concurrency: options.concurrency || 3,
      headless: options.headless !== false,
      exportFormat: options.exportFormat || 'json',
      outputPrefix: options.outputPrefix || 'trinidad_express_bulk'
    };

    this.urlCollector = new URLCollector({
      targetCount: this.options.targetUrlCount,
      timeout: this.options.collectionTimeout,
      scrollDelay: this.options.scrollDelay,
      headless: this.options.headless,
      resumeFromFile: this.options.resumeCollection,
      outputFile: `${this.options.outputPrefix}_urls.json`
    });

    this.articleScraper = new TrinidadExpressScraper({
      timeout: this.options.scrapingTimeout,
      retries: this.options.scrapingRetries,
      delay: this.options.scrapingDelay,
      headless: this.options.headless
    });

    this.exporter = new DataExporter();
  }

  async runFullPipeline(newsUrl: string = 'https://trinidadexpress.com/news/'): Promise<{
    urlCollection: any;
    scrapingResults: ScrapeResult[];
    exportPaths: { json?: string; csv?: string };
  }> {
    console.log('🚀 Starting Trinidad Express Bulk Scraping Pipeline');
    console.log('=' .repeat(60));

    // Phase 1: Collect URLs
    console.log('\n📋 Phase 1: Collecting article URLs...');
    const urlCollection = await this.urlCollector.collectArticleUrls(newsUrl);
    
    if (!urlCollection.success) {
      throw new Error(`URL collection failed: ${urlCollection.error}`);
    }

    console.log(`✅ URL Collection Complete: ${urlCollection.totalCollected} URLs collected`);

    // Phase 2: Scrape articles in batches
    console.log('\n📰 Phase 2: Scraping articles...');
    const scrapingResults = await this.scrapeInBatches(urlCollection.urls);

    console.log(`✅ Scraping Complete: ${scrapingResults.filter(r => r.success).length}/${scrapingResults.length} articles scraped successfully`);

    // Phase 3: Export data
    console.log('\n💾 Phase 3: Exporting data...');
    const exportPaths = await this.exportResults(scrapingResults);

    console.log('\n🎉 Bulk scraping pipeline completed successfully!');
    console.log('=' .repeat(60));

    // Cleanup
    await this.cleanup();

    return {
      urlCollection,
      scrapingResults,
      exportPaths
    };
  }

  async collectUrlsOnly(newsUrl: string = 'https://trinidadexpress.com/news/'): Promise<string[]> {
    console.log('📋 Collecting article URLs only...');
    
    const result = await this.urlCollector.collectArticleUrls(newsUrl);
    await this.urlCollector.close();
    
    if (!result.success) {
      throw new Error(`URL collection failed: ${result.error}`);
    }
    
    console.log(`✅ Collected ${result.totalCollected} URLs`);
    return result.urls;
  }

  async scrapeFromUrlFile(urlFilePath: string): Promise<ScrapeResult[]> {
    console.log(`📰 Loading URLs from: ${urlFilePath}`);
    
    const data = await fs.readFile(urlFilePath, 'utf-8');
    const parsed = JSON.parse(data);
    const urls = parsed.urls || parsed;
    
    if (!Array.isArray(urls)) {
      throw new Error('Invalid URL file format. Expected array of URLs.');
    }
    
    console.log(`📋 Loaded ${urls.length} URLs from file`);
    return await this.scrapeInBatches(urls);
  }

  async retryFailedUrls(failedUrlsFilePath: string): Promise<ScrapeResult[]> {
    console.log(`🔄 Retrying failed URLs from: ${failedUrlsFilePath}`);
    
    const data = await fs.readFile(failedUrlsFilePath, 'utf-8');
    const parsed = JSON.parse(data);
    const urls = parsed.urls || [];
    
    if (!Array.isArray(urls)) {
      throw new Error('Invalid failed URLs file format. Expected array of URLs.');
    }
    
    console.log(`📋 Retrying ${urls.length} failed URLs`);
    
    // Increase retry count and timeout for failed URLs
    const originalRetries = this.articleScraper['options'].retries;
    const originalTimeout = this.articleScraper['options'].timeout;
    
    // Temporarily increase retry settings
    this.articleScraper['options'].retries = Math.max(originalRetries + 2, 5);
    this.articleScraper['options'].timeout = Math.max(originalTimeout * 1.5, 45000);
    
    console.log(`⚙️ Increased retries to ${this.articleScraper['options'].retries} and timeout to ${this.articleScraper['options'].timeout}ms`);
    
    const results = await this.scrapeInBatches(urls);
    
    // Restore original settings
    this.articleScraper['options'].retries = originalRetries;
    this.articleScraper['options'].timeout = originalTimeout;
    
    const successCount = results.filter(r => r.success).length;
    const stillFailedCount = results.filter(r => !r.success).length;
    
    console.log(`🔄 Retry completed: ${successCount} recovered, ${stillFailedCount} still failed`);
    
    return results;
  }

  private async scrapeInBatches(urls: string[]): Promise<ScrapeResult[]> {
    const results: ScrapeResult[] = [];
    const totalBatches = Math.ceil(urls.length / this.options.batchSize);
    
    console.log(`Processing ${urls.length} URLs in ${totalBatches} batches of ${this.options.batchSize}`);

    for (let i = 0; i < urls.length; i += this.options.batchSize) {
      const batch = urls.slice(i, i + this.options.batchSize);
      const batchNumber = Math.floor(i / this.options.batchSize) + 1;
      
      console.log(`\n🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} URLs)`);
      
      const batchResults = await this.articleScraper.scrapeMultipleArticles(batch, this.options.concurrency);
      results.push(...batchResults);
      
      const successCount = batchResults.filter(r => r.success).length;
      console.log(`✓ Batch ${batchNumber} complete: ${successCount}/${batch.length} successful`);
      
      // Save progress after each batch
      if (batchNumber % 5 === 0 || batchNumber === totalBatches) {
        await this.saveProgressResults(results, batchNumber);
      }
      
      // Small delay between batches
      if (i + this.options.batchSize < urls.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return results;
  }

  private async saveProgressResults(results: ScrapeResult[], batchNumber: number): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${this.options.outputPrefix}_progress_batch_${batchNumber}_${timestamp}.json`;
    
    await this.exporter.exportToJSON(results, filename);
    console.log(`💾 Progress saved: batch ${batchNumber}`);
  }

  private async exportResults(results: ScrapeResult[]): Promise<{ json?: string; csv?: string }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `${this.options.outputPrefix}_final_${timestamp}`;
    
    const exportPaths: { json?: string; csv?: string } = {};

    switch (this.options.exportFormat) {
      case 'json':
        exportPaths.json = await this.exporter.exportToJSON(results, `${baseName}.json`);
        break;
      case 'csv':
        exportPaths.csv = await this.exporter.exportToCSV(results, `${baseName}.csv`);
        break;
      case 'both':
        const both = await this.exporter.exportBoth(results, baseName);
        exportPaths.json = both.json;
        exportPaths.csv = both.csv;
        break;
    }

    return exportPaths;
  }

  private async cleanup(): Promise<void> {
    await this.urlCollector.close();
    await this.articleScraper.close();
  }
}