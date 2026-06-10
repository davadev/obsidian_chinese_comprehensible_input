export interface DictionaryEntry {
  simplified: string;
  traditional: string;
  pinyin: string;
  definitions: string[];
  hsk?: {
    source: string;
    levels: string[];
  };
  frequencyRank?: number;
  pos?: string[];
}

export interface DictionaryManifest {
  source: string;
  version: string;
  downloadedAt: string;
  shardCount: number;
  license: string;
}

export interface HskManifest {
  source: string;
  version: string;
  downloadedAt: string;
  license: string;
}
