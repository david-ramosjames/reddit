import { describe, expect, it } from "vitest";
import { extractPostIdFromRedditUrl, parseRedditRssXml } from "./redditRss.js";

describe("extractPostIdFromRedditUrl", () => {
  it("parses standard thread URL", () => {
    expect(
      extractPostIdFromRedditUrl(
        "https://www.reddit.com/r/legaladvice/comments/abc123x/my_title/"
      )
    ).toBe("abc123x");
  });
});

describe("parseRedditRssXml", () => {
  it("parses Atom-style Reddit feed entries", () => {
    const now = Math.floor(Date.now() / 1000);
    const updated = new Date((now - 3600) * 1000).toISOString();
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Rear ended in Austin — insurer stalling</title>
    <link href="https://www.reddit.com/r/legaladvice/comments/zz9999/rear_ended/"/>
    <updated>${updated}</updated>
    <author><name>/u/someone</name></author>
    <content type="html">&lt;p&gt;Not sure what to document.&lt;/p&gt;</content>
  </entry>
</feed>`;
    const posts = parseRedditRssXml(xml, "legaladvice", now - 86400);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.redditPostId).toBe("zz9999");
    expect(posts[0]!.subreddit).toBe("legaladvice");
    expect(posts[0]!.title).toContain("Rear ended");
    expect(posts[0]!.selftext.toLowerCase()).toContain("document");
    expect(posts[0]!.author).toBe("someone");
    expect(posts[0]!.rssIngestion).toBe(true);
  });
});
