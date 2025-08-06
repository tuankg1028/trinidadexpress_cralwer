export interface ArticleData {
  url: string;
  title: string;
  publishedDate: string;
  category: string[];
  content: string;
  readingTime?: string;
  source?: string;
  scrapedAt: Date;
}

export interface ScrapeOptions {
  timeout?: number;
  retries?: number;
  delay?: number;
  headless?: boolean;
}

export interface ScrapeResult {
  success: boolean;
  data?: ArticleData;
  error?: string;
}