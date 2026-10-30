import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, sanePublished } from '../src/feed.js';

test('parseFeed: RSS 2.0 item is normalized', () => {
  const xml = `<?xml version="1.0"?>
    <rss><channel>
      <item>
        <title>Big News</title>
        <link>https://example.com/1</link>
        <guid>guid-1</guid>
        <description>&lt;p&gt;Body text&lt;/p&gt;</description>
      </item>
    </channel></rss>`;
  const [it] = parseFeed(xml, 'rss');
  assert.equal(it.title, 'Big News');
  assert.equal(it.link, 'https://example.com/1');
  assert.equal(it.guid, 'guid-1');
  assert.equal(it.summary, 'Body text'); // HTML stripped
});

test('parseFeed: items missing link or title are dropped', () => {
  const xml = `<rss><channel>
    <item><title>No Link</title><guid>g</guid></item>
    <item><link>https://x/2</link><guid>g2</guid></item>
  </channel></rss>`;
  assert.equal(parseFeed(xml, 'rss').length, 0);
});

test('parseFeed: Atom entry (text link) is normalized', () => {
  const xml = `<feed>
    <entry>
      <title>Atom Title</title>
      <link>https://example.com/a</link>
      <id>atom-id-1</id>
      <summary>Atom summary</summary>
    </entry>
  </feed>`;
  const [it] = parseFeed(xml, 'atom');
  assert.equal(it.title, 'Atom Title');
  assert.equal(it.link, 'https://example.com/a');
  assert.equal(it.guid, 'atom-id-1');
  assert.equal(it.summary, 'Atom summary');
});

test('parseFeed: google-news strips publisher suffix and filters by host', () => {
  const xml = `<rss><channel>
    <item>
      <title>Real Headline - The Guardian</title>
      <link>https://news.google.com/articles/aaa</link>
      <guid>gn-1</guid>
      <source url="https://www.theguardian.com">The Guardian</source>
    </item>
    <item>
      <title>Other Outlet Story - BBC</title>
      <link>https://news.google.com/articles/bbb</link>
      <guid>gn-2</guid>
      <source url="https://www.bbc.co.uk">BBC</source>
    </item>
  </channel></rss>`;
  const items = parseFeed(xml, 'google-news', 'theguardian.com');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Real Headline'); // " - The Guardian" stripped
});

test('parseFeed: returns all valid items (the 30-cap lives in collectFeed)', () => {
  const items = Array.from({ length: 40 }, (_, i) =>
    `<item><title>T${i}</title><link>https://x/${i}</link><guid>g${i}</guid></item>`).join('');
  assert.equal(parseFeed(`<rss><channel>${items}</channel></rss>`, 'rss').length, 40);
});

test('sanePublished: in-range timestamp passes through', () => {
  const now = 1_700_000_000_000;
  assert.equal(sanePublished(now - 86_400_000, now), now - 86_400_000); // 1 day ago
});

test('sanePublished: far future is rejected', () => {
  const now = 1_700_000_000_000;
  assert.equal(sanePublished(now + 10 * 86_400_000, now), null); // 10 days ahead
});

test('sanePublished: far past is rejected', () => {
  const now = 1_700_000_000_000;
  assert.equal(sanePublished(now - 5 * 365 * 86_400_000, now), null); // 5 years ago
});

test('sanePublished: small timezone-slack future is allowed', () => {
  const now = 1_700_000_000_000;
  assert.equal(sanePublished(now + 60_000, now), now + 60_000); // 1 min ahead
});

test('sanePublished: NaN/non-number becomes null', () => {
  const now = 1_700_000_000_000;
  assert.equal(sanePublished(NaN, now), null);
  assert.equal(sanePublished(undefined, now), null);
});

test('DW-style RDF feeds preserve items and dc:date publication timestamps',()=>{
  const xml='<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://purl.org/rss/1.0/"><channel><title>DW</title></channel><item rdf:about="https://dw.com/a"><title>中文新闻</title><link>https://dw.com/a</link><description>摘要</description><dc:date>2026-10-27T13:58:00Z</dc:date></item></rdf:RDF>';
  const rows=parseFeed(xml,'official');
  assert.equal(rows.length,1);assert.equal(rows[0].published_at,Date.parse('2026-10-27T13:58:00Z'));
});

test('official Atom feeds use href attributes without losing original links',()=>{
  const rows=parseFeed('<feed><entry><id>1</id><title>News</title><link rel="alternate" href="https://example.org/a"/><published>2026-10-27T00:00:00Z</published></entry></feed>','official');
  assert.equal(rows[0].link,'https://example.org/a');
});
