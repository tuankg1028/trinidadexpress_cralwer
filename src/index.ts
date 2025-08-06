import { TrinidadExpressScraper } from './scraper';
import { DataExporter } from './exporter';
import { BulkScraper } from './bulk-scraper';
import { URLCollector } from './url-collector';

export async function scrapeArticles(urls: string[], options?: {
  timeout?: number;
  retries?: number;
  delay?: number;
  headless?: boolean;
  exportFormat?: 'json' | 'csv' | 'both';
  outputFilename?: string;
}) {
  const scraper = new TrinidadExpressScraper({
    timeout: options?.timeout,
    retries: options?.retries,
    delay: options?.delay,
    headless: options?.headless
  });

  const exporter = new DataExporter();

  try {
    const results = await scraper.scrapeMultipleArticles(urls);
    
    const exportFormat = options?.exportFormat || 'json';
    
    switch (exportFormat) {
      case 'json':
        await exporter.exportToJSON(results, options?.outputFilename);
        break;
      case 'csv':
        await exporter.exportToCSV(results, options?.outputFilename);
        break;
      case 'both':
        await exporter.exportBoth(results, options?.outputFilename?.replace(/\.(json|csv)$/, ''));
        break;
    }

    return results;
  } finally {
    await scraper.close();
  }
}

export async function scrapeArticle(url: string, options?: {
  timeout?: number;
  retries?: number;
  delay?: number;
  headless?: boolean;
}) {
  return scrapeArticles([url], options);
}

export async function collectUrls(targetCount: number = 10000, options?: {
  scrollDelay?: number;
  headless?: boolean;
  resumeFromFile?: boolean;
}) {
  const collector = new URLCollector({
    targetCount,
    scrollDelay: options?.scrollDelay,
    headless: options?.headless,
    resumeFromFile: options?.resumeFromFile
  });

  try {
    const result = await collector.collectArticleUrls();
    return result;
  } finally {
    await collector.close();
  }
}

export async function bulkScrape(options?: {
  targetUrlCount?: number;
  batchSize?: number;
  exportFormat?: 'json' | 'csv' | 'both';
  headless?: boolean;
}) {
  const bulkScraper = new BulkScraper(options);
  return await bulkScraper.runFullPipeline();
}

export async function retryFailedUrls(failedUrlsFilePath: string, options?: {
  batchSize?: number;
  exportFormat?: 'json' | 'csv' | 'both';
  headless?: boolean;
}) {
  const bulkScraper = new BulkScraper({
    batchSize: options?.batchSize || 25,
    exportFormat: options?.exportFormat || 'json',
    headless: options?.headless !== false
  });
  
  try {
    const results = await bulkScraper.retryFailedUrls(failedUrlsFilePath);
    
    // Export retry results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `retry_results_${timestamp}`;
    
    const exporter = new DataExporter();
    switch (options?.exportFormat || 'json') {
      case 'json':
        await exporter.exportToJSON(results, `${baseName}.json`);
        break;
      case 'csv':
        await exporter.exportToCSV(results, `${baseName}.csv`);
        break;
      case 'both':
        await exporter.exportBoth(results, baseName);
        break;
    }
    
    return results;
  } finally {
    await bulkScraper['cleanup']();
  }
}

export { TrinidadExpressScraper } from './scraper';
export { DataExporter } from './exporter';
export { URLCollector } from './url-collector';
export { BulkScraper } from './bulk-scraper';
export * from './types';

if (require.main === module) {
  // Command line interface
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'collect-urls') {
    const targetCount = parseInt(args[1]) || 10000;
    console.log(`Collecting ${targetCount} URLs...`);
    
    collectUrls(targetCount, { 
      headless: false,
      resumeFromFile: true
    }).then((result) => {
      console.log(`URL collection completed: ${result.totalCollected} URLs`);
    }).catch(error => {
      console.error('URL collection failed:', error);
    });
  } 
  else if (command === 'bulk-scrape') {
    const targetCount = parseInt(args[1]) || 1000;
    console.log(`Starting bulk scrape for ${targetCount} URLs...`);
    
    bulkScrape({
      targetUrlCount: targetCount,
      batchSize: 25,
      exportFormat: 'both',
      headless: false
    }).then(() => {
      console.log('Bulk scraping completed!');
    }).catch(error => {
      console.error('Bulk scraping failed:', error);
    });
  }
  else if (command === 'retry-failed') {
    const failedUrlsFile = args[1];
    if (!failedUrlsFile) {
      console.error('Please provide path to failed URLs file');
      console.log('Usage: npm run start retry-failed <failed-urls-file.json>');
      process.exit(1);
    }
    
    console.log(`Retrying failed URLs from: ${failedUrlsFile}`);
    
    retryFailedUrls(failedUrlsFile, {
      batchSize: 20,
      exportFormat: 'both',
      headless: false
    }).then((results) => {
      const successCount = results.filter(r => r.success).length;
      console.log(`Retry completed! Recovered: ${successCount}/${results.length} URLs`);
    }).catch(error => {
      console.error('Retry failed:', error);
    });
  }
  else {
    // Default: test single article scraping
    const testUrl = 'https://trinidadexpress.com/opinion/columnists/reform-guyana-s-broken-institutional-machinery/article_86be611b-4a3e-4234-a317-8f49159b538d.html';
    
    scrapeArticles([testUrl], { 
      exportFormat: 'both',
      headless: false
    }).then(() => {
      console.log('Test scraping completed!');
    }).catch(error => {
      console.error('Test scraping failed:', error);
    });
  }
}