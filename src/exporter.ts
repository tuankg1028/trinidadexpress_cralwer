import * as fs from 'fs/promises';
import * as path from 'path';
import { ArticleData, ScrapeResult } from './types';

export class DataExporter {
  private outputDir: string;

  constructor(outputDir: string = './output') {
    this.outputDir = outputDir;
  }

  async ensureOutputDir(): Promise<void> {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error('Error creating output directory:', error);
    }
  }

  async exportToJSON(results: ScrapeResult[], filename?: string): Promise<string> {
    await this.ensureOutputDir();
    
    const successfulResults = results.filter(r => r.success).map(r => r.data);
    const failedResults = results.filter(r => !r.success);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = filename || `trinidad_express_articles_${timestamp}.json`;
    const filePath = path.join(this.outputDir, fileName);
    
    const exportData = {
      metadata: {
        totalArticles: results.length,
        successfulScrapes: successfulResults.length,
        failedScrapes: failedResults.length,
        exportedAt: new Date().toISOString()
      },
      articles: successfulResults,
      failedUrls: failedResults.map(r => ({
        url: r.data?.url || 'unknown',
        error: r.error,
        timestamp: new Date().toISOString()
      }))
    };
    
    await fs.writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf-8');
    console.log(`✓ Exported ${successfulResults.length} articles to ${filePath}`);
    
    // Also create a separate failed URLs file for easy retry
    if (failedResults.length > 0) {
      await this.exportFailedUrls(failedResults, timestamp);
    }
    
    return filePath;
  }

  async exportFailedUrls(failedResults: ScrapeResult[], timestamp: string): Promise<string> {
    const failedUrlsFile = `failed_urls_${timestamp}.json`;
    const filePath = path.join(this.outputDir, failedUrlsFile);
    
    const failedData = {
      generatedAt: new Date().toISOString(),
      totalFailed: failedResults.length,
      urls: failedResults.map(r => r.data?.url || 'unknown'),
      detailedErrors: failedResults.map(r => ({
        url: r.data?.url || 'unknown',
        error: r.error,
        timestamp: new Date().toISOString()
      }))
    };
    
    await fs.writeFile(filePath, JSON.stringify(failedData, null, 2) + '\n', 'utf-8');
    console.log(`✓ Exported ${failedResults.length} failed URLs to ${filePath}`);
    
    return filePath;
  }

  async exportToCSV(results: ScrapeResult[], filename?: string): Promise<string> {
    await this.ensureOutputDir();
    
    const successfulResults = results.filter(r => r.success).map(r => r.data!);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = filename || `trinidad_express_articles_${timestamp}.csv`;
    const filePath = path.join(this.outputDir, fileName);
    
    if (successfulResults.length === 0) {
      console.log('No successful results to export to CSV');
      return filePath;
    }
    
    const headers = [
      'URL',
      'Title',
      'Published Date',
      'Category',
      'Content',
      'Reading Time',
      'Source',
      'Scraped At'
    ];
    
    const csvRows = [headers.join(',')];
    
    for (const article of successfulResults) {
      const row = [
        this.escapeCsvField(article.url),
        this.escapeCsvField(article.title),
        this.escapeCsvField(article.publishedDate),
        this.escapeCsvField(article.category.join('; ')),
        this.escapeCsvField(article.content),
        this.escapeCsvField(article.readingTime || ''),
        this.escapeCsvField(article.source || ''),
        this.escapeCsvField(article.scrapedAt.toISOString())
      ];
      csvRows.push(row.join(','));
    }
    
    await fs.writeFile(filePath, csvRows.join('\n'), 'utf-8');
    console.log(`✓ Exported ${successfulResults.length} articles to ${filePath}`);
    
    return filePath;
  }

  private escapeCsvField(field: string): string {
    if (field.includes(',') || field.includes('\n') || field.includes('"')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }

  async exportBoth(results: ScrapeResult[], baseName?: string): Promise<{ json: string; csv: string }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = baseName || `trinidad_express_articles_${timestamp}`;
    
    const jsonPath = await this.exportToJSON(results, `${base}.json`);
    const csvPath = await this.exportToCSV(results, `${base}.csv`);
    
    return { json: jsonPath, csv: csvPath };
  }
}