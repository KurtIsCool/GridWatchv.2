import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const FACEBOOK_URL =
  "https://www.facebook.com/MOREpowerIloilo";

const DOWNLOAD_ROOT =
  path.resolve("facebook-downloads");

const MAX_IMAGE_BYTES =
  20 * 1024 * 1024;

const MAX_POSTS = 5;

const MAX_SCROLL_ATTEMPTS = 8;

console.log(
  "Starting MORE Power Facebook scraper..."
);

let browser = null;

/* =========================================================
 * HASHING
 * ========================================================= */

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

/* =========================================================
 * FACEBOOK URL NORMALIZATION
 * ========================================================= */

function cleanFacebookUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const url =
      new URL(rawUrl);

    const photoId =
      url.searchParams.get(
        "fbid"
      );

    if (
      photoId &&
      /^\d+$/.test(photoId) &&
      (
        url.pathname ===
          "/photo/" ||
        url.pathname ===
          "/photo.php"
      )
    ) {
      return (
        `${url.origin}/photo/?fbid=${photoId}`
      );
    }

    return `${url.origin}${url.pathname}`.replace(
      /\/$/,
      ""
    );
  } catch {
    return rawUrl;
  }
}

function extractExternalId(itemUrl) {
  if (!itemUrl) {
    return null;
  }

  try {
    const url =
      new URL(itemUrl);

    const postMatch =
      url.pathname.match(
        /\/posts\/(pfbid[A-Za-z0-9]+)/
      );

    if (postMatch) {
      return postMatch[1];
    }

    const videoMatch =
      url.pathname.match(
        /\/MOREpowerIloilo\/videos\/(\d+)/
      );

    if (videoMatch) {
      return `video_${videoMatch[1]}`;
    }

    const photoId =
      url.searchParams.get(
        "fbid"
      );

    if (
      photoId &&
      /^\d+$/.test(photoId) &&
      (
        url.pathname ===
          "/photo/" ||
        url.pathname ===
          "/photo.php"
      )
    ) {
      return `photo_${photoId}`;
    }
  } catch {
    return null;
  }

  return null;
}

/* =========================================================
 * CAPTION HANDLING
 * ========================================================= */

function cleanCaption(text) {
  if (!text) {
    return null;
  }

  const cleaned =
    text
      .replace(
        /\s*See less\s*$/i,
        ""
      )
      .trim();

  return cleaned || null;
}

function isCaptionTruncated(caption) {
  if (!caption) {
    return false;
  }

  const text =
    caption.trim();

  return (
    /\bSee more\s*$/i.test(
      text
    ) ||
    /…\s*See more\s*$/i.test(
      text
    ) ||
    /\.\.\.\s*See more\s*$/i.test(
      text
    )
  );
}

/* =========================================================
 * FACEBOOK MEDIA IDENTITY
 * ========================================================= */

function normalizeMediaIdentity(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const url =
      new URL(rawUrl);

    return url.pathname;
  } catch {
    return rawUrl;
  }
}

function deduplicateMedia(media) {
  const seen =
    new Set();

  const result = [];

  for (
    const item of media || []
  ) {
    const identity =
      normalizeMediaIdentity(
        item.originalUrl
      );

    if (
      !identity ||
      seen.has(identity)
    ) {
      continue;
    }

    seen.add(identity);

    result.push({
      ...item,
      mediaIdentity:
        identity,
    });
  }

  return result;
}

function createMediaFingerprint(
  media
) {
  const identities =
    (media || [])
      .map(
        (item) =>
          normalizeMediaIdentity(
            item.originalUrl
          )
      )
      .filter(Boolean)
      .sort();

  return sha256(
    Buffer.from(
      JSON.stringify(
        identities
      ),
      "utf8"
    )
  );
}

/* =========================================================
 * FILE UTILITIES
 * ========================================================= */

async function loadPreviousPost(
  externalId
) {
  if (!externalId) {
    return null;
  }

  const filename =
    path.join(
      DOWNLOAD_ROOT,
      externalId,
      "post.json"
    );

  try {
    return JSON.parse(
      await fs.readFile(
        filename,
        "utf8"
      )
    );
  } catch {
    return null;
  }
}

async function writeJson(
  filename,
  value
) {
  await fs.writeFile(
    filename,
    JSON.stringify(
      value,
      null,
      2
    ),
    "utf8"
  );
}

/* =========================================================
 * IMAGE FILE EXTENSIONS
 * ========================================================= */

function extensionForMimeType(
  mimeType
) {
  const cleanType =
    mimeType
      ?.split(";")[0]
      ?.trim()
      ?.toLowerCase();

  switch (cleanType) {
    case "image/jpeg":
      return "jpg";

    case "image/png":
      return "png";

    case "image/webp":
      return "webp";

    case "image/gif":
      return "gif";

    case "image/avif":
      return "avif";

    default:
      return "bin";
  }
}

/* =========================================================
 * LOGIN POPUP
 * ========================================================= */

async function closeLoginPopup(
  page
) {
  const selectors = [
    'div[role="dialog"] [aria-label="Close"]',
    'div[role="dialog"] div[role="button"][aria-label="Close"]',
    'div[role="dialog"] button[aria-label="Close"]',
    '[aria-label="Close"][role="button"]',
  ];

  for (
    const selector of selectors
  ) {
    try {
      const button =
        page
          .locator(selector)
          .first();

      if (
        await button.isVisible({
          timeout: 700,
        })
      ) {
        await button.click({
          timeout: 3000,
        });

        console.log(
          "Facebook login popup closed."
        );

        await page.waitForTimeout(
          500
        );

        return true;
      }
    } catch {
      // Try the next selector.
    }
  }

  return false;
}

/* =========================================================
 * SEE MORE
 * ========================================================= */

async function expandSeeMore(
  page
) {
  console.log(
    'Looking for "See more" buttons...'
  );

  const articles =
    page.locator(
      'div[role="article"]'
    );

  const count =
    await articles.count();

  let expanded = 0;

  for (
    let i = 0;
    i < count;
    i++
  ) {
    const article =
      articles.nth(i);

    try {
      const button =
        article
          .getByText(
            "See more",
            {
              exact: true,
            }
          )
          .first();

      if (
        await button.isVisible({
          timeout: 400,
        })
      ) {
        await button.click({
          timeout: 2000,
        });

        expanded++;

        await page.waitForTimeout(
          350
        );

        await closeLoginPopup(
          page
        );
      }
    } catch {
      // Not fatal while logged out.
    }
  }

  console.log(
    `Expanded ${expanded} post(s).`
  );
}

/* =========================================================
 * LOAD MORE PUBLIC POSTS
 * ========================================================= */

async function loadMorePublicPosts(
  page
) {
  console.log(
    "Scrolling Facebook to load more public posts..."
  );

  const postSelector =
    'a[href*="/MOREpowerIloilo/posts/"]';

  let previousArticleCount = 0;

  for (
    let attempt = 1;
    attempt <=
      MAX_SCROLL_ATTEMPTS;
    attempt++
  ) {
    const postLinkCount =
      await page
        .locator(
          postSelector
        )
        .count();

    const articleCount =
      await page
        .locator(
          'div[role="article"]'
        )
        .count();

    console.log(
      `  Attempt ${attempt}: ${postLinkCount} post link(s), ${articleCount} article(s).`
    );

    if (
      postLinkCount >=
      MAX_POSTS
    ) {
      break;
    }

    /*
     * Scroll by a large but realistic viewport amount.
     * Facebook lazy-loads additional public feed cards.
     */
    await page.evaluate(
      () => {
        window.scrollBy(
          0,
          Math.max(
            window.innerHeight *
              1.6,
            1400
          )
        );
      }
    );

    await page.waitForTimeout(
      1800
    );

    await closeLoginPopup(
      page
    );

    /*
     * If the feed appears stuck, one extra End press often
     * triggers Facebook's next lazy-load boundary.
     */
    if (
      articleCount ===
      previousArticleCount
    ) {
      try {
        await page.keyboard.press(
          "End"
        );

        await page.waitForTimeout(
          1400
        );

        await closeLoginPopup(
          page
        );
      } catch {
        // Not fatal.
      }
    }

    previousArticleCount =
      articleCount;
  }

  const finalCount =
    await page
      .locator(
        postSelector
      )
      .count();

  console.log(
    `MORE Power /posts/ links after scrolling: ${finalCount}`
  );

  return finalCount;
}

/* =========================================================
 * FINAL REVISION HASH
 * ========================================================= */

function createRevisionHash(
  post
) {
  const material = {
    externalId:
      post.externalId,

    caption:
      post.caption,

    media:
      (post.media || []).map(
        (media) => ({
          sha256:
            media.sha256 ||
            null,
        })
      ),
  };

  return sha256(
    Buffer.from(
      JSON.stringify(
        material
      ),
      "utf8"
    )
  );
}

/* =========================================================
 * IMAGE DOWNLOADER
 * ========================================================= */

async function downloadImage({
  request,
  imageUrl,
  postDirectory,
  imageNumber,
}) {
  console.log(
    `  Downloading image ${imageNumber}...`
  );

  const response =
    await request.get(
      imageUrl,
      {
        headers: {
          Referer:
            FACEBOOK_URL,
        },

        timeout:
          30000,
      }
    );

  if (!response.ok()) {
    throw new Error(
      `HTTP ${response.status()}`
    );
  }

  const mimeType =
    response
      .headers()
      ["content-type"]
      ?.split(";")[0]
      ?.trim()
      ?.toLowerCase() ||
    "application/octet-stream";

  if (
    !mimeType.startsWith(
      "image/"
    )
  ) {
    throw new Error(
      `Unexpected MIME type: ${mimeType}`
    );
  }

  const buffer =
    await response.body();

  if (
    buffer.length >
    MAX_IMAGE_BYTES
  ) {
    throw new Error(
      `Image exceeds ${MAX_IMAGE_BYTES} bytes`
    );
  }

  const imageHash =
    sha256(buffer);

  const extension =
    extensionForMimeType(
      mimeType
    );

  const filename =
    `image-${String(
      imageNumber
    ).padStart(
      2,
      "0"
    )}.${extension}`;

  const filePath =
    path.join(
      postDirectory,
      filename
    );

  await fs.writeFile(
    filePath,
    buffer
  );

  console.log(
    `    Saved: ${filename}`
  );

  console.log(
    `    Size: ${buffer.length} bytes`
  );

  console.log(
    `    SHA-256: ${imageHash}`
  );

  return {
    filename,
    mimeType,
    bytes:
      buffer.length,
    sha256:
      imageHash,
  };
}

/* =========================================================
 * RAW ARTICLE EXTRACTION
 * ========================================================= */

async function extractRawArticles(
  page
) {
  return page
    .locator(
      'div[role="article"]'
    )
    .evaluateAll(
      (articles) => {
        function canonicalFacebookItemUrl(
          rawUrl
        ) {
          if (!rawUrl) {
            return null;
          }

          try {
            const url =
              new URL(
                rawUrl,
                window.location.origin
              );

            if (
              url.searchParams.has(
                "comment_id"
              )
            ) {
              return null;
            }

            const directPost =
              url.pathname.match(
                /\/MOREpowerIloilo\/posts\/(pfbid[A-Za-z0-9]+)/
              );

            if (directPost) {
              return (
                `${url.origin}/MOREpowerIloilo/posts/${directPost[1]}`
              );
            }

            const directVideo =
              url.pathname.match(
                /\/MOREpowerIloilo\/videos\/(\d+)/
              );

            if (directVideo) {
              return (
                `${url.origin}/MOREpowerIloilo/videos/${directVideo[1]}`
              );
            }

            /*
             * Facebook sometimes uses permalink.php with a
             * story_fbid instead of a /posts/ href.
             */
            const storyFbid =
              url.searchParams.get(
                "story_fbid"
              );

            if (
              storyFbid &&
              /^pfbid[A-Za-z0-9]+$/.test(
                storyFbid
              )
            ) {
              return (
                `${url.origin}/MOREpowerIloilo/posts/${storyFbid}`
              );
            }

            return null;
          } catch {
            return null;
          }
        }

        return articles.map(
          (
            article,
            articleIndex
          ) => {
            const messageElement =
              article.querySelector(
                '[data-ad-preview="message"]'
              ) ||
              article.querySelector(
                '[data-ad-comet-preview="message"]'
              );

            const text =
              messageElement
                ?.innerText
                ?.trim() ||
              "";

            const links = [
              ...article.querySelectorAll(
                "a[href]"
              ),
            ]
              .map(
                (element) => ({
                  url:
                    element.href ||
                    element.getAttribute(
                      "href"
                    ) ||
                    "",

                  text:
                    element
                      .innerText
                      ?.trim() ||
                    "",

                  title:
                    element.getAttribute(
                      "title"
                    ) ||
                    "",

                  ariaLabel:
                    element.getAttribute(
                      "aria-label"
                    ) ||
                    "",
                })
              )
              .filter(
                (item) =>
                  item.url
              );

            let canonical = null;
            let postLink = null;

            for (
              const link of links
            ) {
              const candidate =
                canonicalFacebookItemUrl(
                  link.url
                );

              if (candidate) {
                canonical =
                  candidate;

                postLink =
                  link;

                break;
              }
            }

            /*
             * Occasionally the canonical post URL is present in
             * the article markup but not exposed through an anchor.
             */
            if (!canonical) {
              const html =
                article.outerHTML ||
                "";

              const htmlPostMatch =
                html.match(
                  /\/MOREpowerIloilo\/posts\/(pfbid[A-Za-z0-9]+)/
                );

              if (htmlPostMatch) {
                canonical =
                  `${window.location.origin}/MOREpowerIloilo/posts/${htmlPostMatch[1]}`;
              }

              if (!canonical) {
                const htmlVideoMatch =
                  html.match(
                    /\/MOREpowerIloilo\/videos\/(\d+)/
                  );

                if (htmlVideoMatch) {
                  canonical =
                    `${window.location.origin}/MOREpowerIloilo/videos/${htmlVideoMatch[1]}`;
                }
              }
            }

            let timestampText =
              postLink?.text ||
              null;

            let timestampTitle =
              postLink?.title ||
              null;

            let timestampAriaLabel =
              postLink
                ?.ariaLabel ||
              null;

            const timeElement =
              article.querySelector(
                "time"
              );

            if (timeElement) {
              timestampText =
                timestampText ||
                timeElement
                  .textContent
                  ?.trim() ||
                null;

              timestampTitle =
                timestampTitle ||
                timeElement.getAttribute(
                  "datetime"
                ) ||
                timeElement.getAttribute(
                  "title"
                ) ||
                null;

              timestampAriaLabel =
                timestampAriaLabel ||
                timeElement.getAttribute(
                  "aria-label"
                ) ||
                null;
            }

            const images = [
              ...article.querySelectorAll(
                "img"
              ),
            ]
              .map(
                (img) => ({
                  url:
                    img.currentSrc ||
                    img.src ||
                    "",

                  alt:
                    img.alt ||
                    "",

                  width:
                    img.naturalWidth ||
                    img.width ||
                    0,

                  height:
                    img.naturalHeight ||
                    img.height ||
                    0,
                })
              )
              .filter(
                (image) => {
                  if (
                    !image.url
                  ) {
                    return false;
                  }

                  const isFacebookCdn =
                    image.url.includes(
                      "scontent"
                    ) ||
                    image.url.includes(
                      "fbcdn"
                    );

                  if (
                    !isFacebookCdn
                  ) {
                    return false;
                  }

                  return (
                    image.width >=
                      200 &&
                    image.height >=
                      200
                  );
                }
              );

            const candidateLinks =
              links
                .filter(
                  ({ url }) =>
                    url.includes(
                      "MOREpowerIloilo"
                    ) ||
                    url.includes(
                      "pfbid"
                    ) ||
                    url.includes(
                      "/videos/"
                    ) ||
                    url.includes(
                      "/reel/"
                    ) ||
                    url.includes(
                      "permalink.php"
                    )
                )
                .slice(
                  0,
                  25
                );

            return {
              articleIndex,

              text,

              postUrl:
                canonical,

              timestampText,

              timestampTitle,

              timestampAriaLabel,

              images,

              candidateLinks,
            };
          }
        );
      }
    );
}

/* =========================================================
 * PHOTO FALLBACK
 * ========================================================= */

/*
 * Facebook's logged-out feed sometimes refuses to expose older
 * /posts/ cards, but the Page still renders a "Photos" strip with
 * public photo links. Those links give us a second public evidence
 * path for image advisories.
 */
async function discoverPhotoCandidates(
  page
) {
  const candidates =
    await page
      .locator(
        'a[href*="/photo/?fbid="], a[href*="/photo.php?fbid="]'
      )
      .evaluateAll(
        (links) => {
          const found = [];

          for (const link of links) {
            try {
              const url =
                new URL(
                  link.href,
                  window.location.origin
                );

              const photoId =
                url.searchParams.get(
                  "fbid"
                );

              const set =
                url.searchParams.get(
                  "set"
                ) ||
                "";

              /*
               * Prefer the Page's actual photo strip rather than
               * profile/cover images elsewhere on the page.
               */
              if (
                !photoId ||
                !/^\d+$/.test(
                  photoId
                ) ||
                !set.includes(
                  "pb.100064352995613"
                )
              ) {
                continue;
              }

              const img =
                link.querySelector(
                  "img"
                );

              found.push({
                photoId,

                url:
                  `${url.origin}/photo/?fbid=${photoId}`,

                thumbnail:
                  img
                    ? {
                        url:
                          img.currentSrc ||
                          img.src ||
                          "",

                        alt:
                          img.alt ||
                          "",

                        width:
                          img.naturalWidth ||
                          img.width ||
                          0,

                        height:
                          img.naturalHeight ||
                          img.height ||
                          0,
                      }
                    : null,
              });
            } catch {
              // Ignore malformed links.
            }
          }

          return found.filter(
            (
              candidate,
              index,
              array
            ) =>
              index ===
              array.findIndex(
                (item) =>
                  item.photoId ===
                  candidate.photoId
              )
          );
        }
      );

  console.log(
    `Photo fallback candidates: ${candidates.length}`
  );

  return candidates;
}

async function loadPhotoCandidate(
  context,
  candidate
) {
  const photoPage =
    await context.newPage();

  try {
    console.log(
      `  Opening photo ${candidate.photoId}...`
    );

    await photoPage.goto(
      candidate.url,
      {
        waitUntil:
          "domcontentloaded",

        timeout:
          45000,
      }
    );

    await photoPage.waitForTimeout(
      3000
    );

    await closeLoginPopup(
      photoPage
    );

    await expandSeeMore(
      photoPage
    );

    await photoPage.waitForTimeout(
      800
    );

    const detail =
      await photoPage.evaluate(
        ({
          photoId,
          fallbackThumbnail,
        }) => {
          const messageElements = [
            ...document.querySelectorAll(
              '[data-ad-preview="message"], [data-ad-comet-preview="message"]'
            ),
          ];

          const caption =
            messageElements
              .map(
                (element) =>
                  element
                    .innerText
                    ?.trim() ||
                  ""
              )
              .find(Boolean) ||
            null;

          const images = [
            ...document.querySelectorAll(
              "img"
            ),
          ]
            .map(
              (img) => ({
                url:
                  img.currentSrc ||
                  img.src ||
                  "",

                alt:
                  img.alt ||
                  "",

                width:
                  img.naturalWidth ||
                  img.width ||
                  0,

                height:
                  img.naturalHeight ||
                  img.height ||
                  0,
              })
            )
            .filter(
              (image) =>
                image.url &&
                (
                  image.url.includes(
                    "scontent"
                  ) ||
                  image.url.includes(
                    "fbcdn"
                  )
                ) &&
                image.width >=
                  300 &&
                image.height >=
                  300
            )
            .sort(
              (a, b) =>
                b.width *
                  b.height -
                a.width *
                  a.height
            );

          const selectedImage =
            images[0] ||
            fallbackThumbnail ||
            null;

          const timeElement =
            document.querySelector(
              "time"
            );

          return {
            caption,

            image:
              selectedImage,

            published: {
              text:
                timeElement
                  ?.textContent
                  ?.trim() ||
                null,

              title:
                timeElement
                  ?.getAttribute(
                    "datetime"
                  ) ||
                timeElement
                  ?.getAttribute(
                    "title"
                  ) ||
                null,

              ariaLabel:
                timeElement
                  ?.getAttribute(
                    "aria-label"
                  ) ||
                null,
            },

            photoId,
          };
        },
        {
          photoId:
            candidate.photoId,

          fallbackThumbnail:
            candidate.thumbnail,
        }
      );

    if (
      !detail.image?.url
    ) {
      console.log(
        `  Photo ${candidate.photoId}: no usable image found.`
      );

      return null;
    }

    return {
      source:
        "MORE_POWER_FACEBOOK",

      externalId:
        `photo_${candidate.photoId}`,

      url:
        `https://www.facebook.com/photo/?fbid=${candidate.photoId}`,

      caption:
        cleanCaption(
          detail.caption
        ),

      published:
        detail.published,

      media:
        deduplicateMedia([
          {
            originalUrl:
              detail.image.url,

            alt:
              detail.image.alt ||
              "",

            width:
              detail.image.width ||
              0,

            height:
              detail.image.height ||
              0,
          },
        ]),

      observedAt:
        new Date()
          .toISOString(),
    };
  } catch (error) {
    console.log(
      `  Photo ${candidate.photoId} fallback failed: ${error.message}`
    );

    return null;
  } finally {
    await photoPage.close();
  }
}

/* =========================================================
 * MAIN
 * ========================================================= */

try {
  const isCI =
    process.env.CI ===
    "true";

  console.log(
    isCI
      ? "Launching Playwright Chromium for CI..."
      : "Launching your installed Google Chrome..."
  );

  browser =
    await chromium.launch({
      ...(isCI
        ? {}
        : {
            channel:
              "chrome",
          }),

      headless:
        isCI,
    });

  const context =
    await browser.newContext({
      viewport: {
        width:
          1440,

        height:
          1200,
      },

      locale:
        "en-US",
    });

  const page =
    await context.newPage();

  console.log(
    "Opening Facebook..."
  );

  await page.goto(
    FACEBOOK_URL,
    {
      waitUntil:
        "domcontentloaded",

      timeout:
        60000,
    }
  );

  console.log(
    "Waiting for Facebook to render..."
  );

  await page.waitForTimeout(
    8000
  );

  console.log(
    "Page title:",
    await page.title()
  );

  console.log(
    "Current URL:",
    page.url()
  );

  await closeLoginPopup(
    page
  );

  /*
   * The logged-out feed is nondeterministic. The first card can
   * be a video, placeholder, or other content that has no /posts/
   * permalink. Scroll before extracting so older public Page posts
   * have a chance to enter the DOM.
   */
  await loadMorePublicPosts(
    page
  );

  await expandSeeMore(
    page
  );

  await page.waitForTimeout(
    1200
  );

  const articleCount =
    await page
      .locator(
        'div[role="article"]'
      )
      .count();

  console.log(
    `Found ${articleCount} article elements.`
  );

  const rawArticles =
    await extractRawArticles(
      page
    );

  let posts =
    rawArticles
      .filter(
        (article) => {
          if (
            !article.postUrl
          ) {
            return false;
          }

          return (
            Boolean(
              article.text
            ) ||
            article.images.length >
              0
          );
        }
      )
      .map(
        (article) => {
          const url =
            cleanFacebookUrl(
              article.postUrl
            );

          return {
            source:
              "MORE_POWER_FACEBOOK",

            externalId:
              extractExternalId(
                url
              ),

            url,

            caption:
              cleanCaption(
                article.text
              ),

            published: {
              text:
                article.timestampText,

              title:
                article.timestampTitle,

              ariaLabel:
                article.timestampAriaLabel,
            },

            media:
              deduplicateMedia(
                article.images.map(
                  (
                    image
                  ) => ({
                    originalUrl:
                      image.url,

                    alt:
                      image.alt,

                    width:
                      image.width,

                    height:
                      image.height,
                  })
                )
              ),

            observedAt:
              new Date()
                .toISOString(),
          };
        }
      );

  /*
   * If normal Page posts are unavailable, supplement the run with
   * recent public Page photos. This is especially useful for outage
   * advisories because MORE Power often publishes the advisory as
   * an image.
   */
  const regularPostCount =
    posts.filter(
      (post) =>
        post.externalId
          ?.startsWith(
            "pfbid"
          )
    ).length;

  if (
    regularPostCount === 0 &&
    posts.length <
      MAX_POSTS
  ) {
    const photoCandidates =
      await discoverPhotoCandidates(
        page
      );

    for (
      const candidate of
      photoCandidates
    ) {
      if (
        posts.length >=
        MAX_POSTS
      ) {
        break;
      }

      const photoPost =
        await loadPhotoCandidate(
          context,
          candidate
        );

      if (
        photoPost &&
        !posts.some(
          (existing) =>
            existing.externalId ===
            photoPost.externalId
        )
      ) {
        posts.push(
          photoPost
        );
      }
    }
  }

  /*
   * Remove duplicate DOM representations of the same post.
   */
  posts =
    posts.filter(
      (
        post,
        index,
        array
      ) =>
        Boolean(
          post.externalId
        ) &&
        index ===
          array.findIndex(
            (
              candidate
            ) =>
              candidate.externalId ===
              post.externalId
          )
    );

  posts =
    posts.slice(
      0,
      MAX_POSTS
    );

  console.log("");
  console.log(
    "=============================="
  );
  console.log(
    "MORE POWER FACEBOOK POSTS"
  );
  console.log(
    "=============================="
  );
  console.log(
    `Actual posts detected: ${posts.length}`
  );

  await fs.mkdir(
    DOWNLOAD_ROOT,
    {
      recursive:
        true,
    }
  );

  /*
   * Always save diagnostics. When Facebook changes the public DOM,
   * candidateLinks makes the next failure much easier to inspect.
   */
  await writeJson(
    path.join(
      DOWNLOAD_ROOT,
      "debug-articles.json"
    ),
    rawArticles
  );

  if (
    posts.length === 0
  ) {
    try {
      await fs.writeFile(
        path.join(
          DOWNLOAD_ROOT,
          "debug-page.html"
        ),
        await page.content(),
        "utf8"
      );
    } catch {
      // Diagnostic only.
    }
  }

  const runResults = [];

  let newCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  for (
    const scrapedPost of posts
  ) {
    let post = {
      ...scrapedPost,
    };

    const previous =
      await loadPreviousPost(
        post.externalId
      );

    console.log("");

    if (!previous) {
      console.log(
        `NEW: ${post.externalId}`
      );
    }

    let preservePreviousMedia =
      false;

    if (previous) {
      const currentTruncated =
        isCaptionTruncated(
          post.caption
        );

      const previousTruncated =
        isCaptionTruncated(
          previous.caption
        );

      if (
        !post.caption &&
        previous.caption
      ) {
        console.log(
          `OBSERVATION: ${post.externalId}`
        );
        console.log(
          "  Current caption missing; preserving previous caption."
        );

        post.caption =
          previous.caption;
      }

      if (
        currentTruncated &&
        previous.caption &&
        !previousTruncated
      ) {
        console.log(
          `OBSERVATION: ${post.externalId}`
        );
        console.log(
          "  Current caption truncated; preserving previous full caption."
        );

        post.caption =
          previous.caption;
      }

      if (
        post.media.length ===
          0 &&
        Array.isArray(
          previous.media
        ) &&
        previous.media.length >
          0
      ) {
        console.log(
          `OBSERVATION: ${post.externalId}`
        );
        console.log(
          "  Current media missing; preserving previous media evidence."
        );

        post.media =
          previous.media.map(
            (item) => ({
              ...item,
            })
          );

        preservePreviousMedia =
          true;
      }

      /*
       * If the visible media identities are the same, reuse the
       * already-downloaded evidence locally. A fresh GitHub runner
       * has no previous files, so CI still downloads the images.
       */
      if (
        !preservePreviousMedia &&
        Array.isArray(
          previous.media
        ) &&
        previous.media.length >
          0 &&
        post.media.length >
          0 &&
        createMediaFingerprint(
          post.media
        ) ===
          createMediaFingerprint(
            previous.media
          )
      ) {
        post.media =
          previous.media.map(
            (item) => ({
              ...item,
            })
          );

        preservePreviousMedia =
          true;
      }
    }

    const postDirectory =
      path.join(
        DOWNLOAD_ROOT,
        post.externalId
      );

    await fs.mkdir(
      postDirectory,
      {
        recursive:
          true,
      }
    );

    if (
      !preservePreviousMedia
    ) {
      const downloadedMedia =
        [];

      let imageNumber = 0;

      for (
        const media of
        post.media
      ) {
        imageNumber++;

        try {
          const downloaded =
            await downloadImage({
              request:
                context.request,

              imageUrl:
                media.originalUrl,

              postDirectory,

              imageNumber,
            });

          downloadedMedia.push({
            ...media,

            ...downloaded,
          });
        } catch (error) {
          console.error(
            `    FAILED image ${imageNumber}: ${error.message}`
          );
        }
      }

      post.media =
        downloadedMedia;
    }

    const revisionHash =
      createRevisionHash(
        post
      );

    let status =
      "NEW";

    if (previous) {
      status =
        previous.revisionHash ===
        revisionHash
          ? "UNCHANGED"
          : "UPDATED";
    }

    if (
      status ===
      "NEW"
    ) {
      newCount++;
    } else if (
      status ===
      "UPDATED"
    ) {
      updatedCount++;

      console.log(
        `UPDATED: ${post.externalId}`
      );
    } else {
      unchangedCount++;

      console.log(
        `UNCHANGED: ${post.externalId}`
      );
    }

    console.log(
      `  Images: ${post.media.length}`
    );

    console.log(
      `  Revision SHA-256: ${revisionHash}`
    );

    const savedPost = {
      ...post,

      retrievedAt:
        new Date()
          .toISOString(),

      revisionHash,
    };

    const postJsonPath =
      path.join(
        postDirectory,
        "post.json"
      );

    await writeJson(
      postJsonPath,
      savedPost
    );

    console.log(
      `  Saved metadata: ${postJsonPath}`
    );

    runResults.push({
      externalId:
        post.externalId,

      url:
        post.url,

      caption:
        post.caption,

      published:
        post.published,

      mediaCount:
        post.media.length,

      revisionHash,

      status,
    });
  }

  const index = {
    source:
      "MORE_POWER_FACEBOOK",

    sourceUrl:
      FACEBOOK_URL,

    retrievedAt:
      new Date()
        .toISOString(),

    postCount:
      runResults.length,

    posts:
      runResults,
  };

  await writeJson(
    path.join(
      DOWNLOAD_ROOT,
      "index.json"
    ),
    index
  );

  console.log("");
  console.log(
    "=============================="
  );
  console.log(
    "RUN SUMMARY"
  );
  console.log(
    "=============================="
  );
  console.log(
    `DETECTED:  ${posts.length}`
  );
  console.log(
    `NEW:       ${newCount}`
  );
  console.log(
    `UPDATED:   ${updatedCount}`
  );
  console.log(
    `UNCHANGED: ${unchangedCount}`
  );
  console.log("");
  console.log(
    `Saved to: ${DOWNLOAD_ROOT}`
  );

  console.log("");
  console.log(
    "Keeping browser open for 5 seconds..."
  );

  await page.waitForTimeout(
    5000
  );
} catch (error) {
  console.error("");
  console.error(
    "MORE Power Facebook scraper failed."
  );
  console.error(error);

  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close();
  }
}
