export class TrieNode {
  children = new Map<string, TrieNode>();
  isWord = false;
}

export class Trie {
  private root = new TrieNode();

  /**
   * Note the deliberate index loop rather than `for...of`: `for...of`
   * iterates code POINTS while `matchesFrom` walks the document one code
   * UNIT at a time. Mixing the two meant any word containing a character
   * outside the BMP (𪢌, 𨧀, …) was stored under a key the matcher could
   * never reach, so it never matched. Both sides now agree on UTF-16
   * units, which is also the offset space CodeMirror expects.
   */
  insert(word: string): void {
    let n = this.root;
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
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
    for (let i = 0; i < word.length; i++) {
      const c = n.children.get(word[i]);
      if (!c) return false;
      n = c;
    }
    return true;
  }
}
