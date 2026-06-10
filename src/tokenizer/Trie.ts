export class TrieNode {
  children = new Map<string, TrieNode>();
  isWord = false;
}

export class Trie {
  private root = new TrieNode();

  insert(word: string): void {
    let n = this.root;
    for (const ch of word) {
      let next = n.children.get(ch);
      if (!next) {
        next = new TrieNode();
        n.children.set(ch, next);
      }
      n = next;
    }
    n.isWord = true;
  }

  /**
   * Walk the trie starting at `start` over `text` and return all word-end
   * indexes (exclusive) where the trie matches.
   */
  matchesFrom(text: string, start: number): number[] {
    const ends: number[] = [];
    let n = this.root;
    for (let i = start; i < text.length; i++) {
      const child = n.children.get(text[i]);
      if (!child) break;
      n = child;
      if (n.isWord) ends.push(i + 1);
    }
    return ends;
  }

  hasPrefix(word: string): boolean {
    let n = this.root;
    for (const ch of word) {
      const c = n.children.get(ch);
      if (!c) return false;
      n = c;
    }
    return true;
  }
}
