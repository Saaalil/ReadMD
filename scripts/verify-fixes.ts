import { collectMatches } from "../src/lib/find.ts";
import { isEmbeddablePreviewSrc, previewImageHtml } from "../src/lib/preview-image.ts";

function assert(ok: unknown, message: string): void {
  if (!ok) throw new Error(message);
}

const orders = collectMatches("Lioncroft OrderWise and order of operations. ORDER.", "order");
assert(orders.length === 3, `expected 3 order matches, got ${orders.length}`);
assert(orders[0]?.from === 10, "first match should be OrderWise");

const none = collectMatches("hello", "   ");
assert(none.length === 0, "blank find query should match nothing");

const blobSrc = "blob:http://tauri.localhost/53ad5bd8-716c-43ed-9255-e2c0ff2eb4e3";
assert(!isEmbeddablePreviewSrc(blobSrc), "blob URLs must not go into innerHTML");

const assetSrc = "http://asset.localhost/C%3A%5CUsers%5CSalil%5CAppData%5CRoaming%5Cfile.png";
assert(!isEmbeddablePreviewSrc(assetSrc), "asset.localhost URLs must not go into innerHTML");
assert(!isEmbeddablePreviewSrc("https://asset.localhost/C:/file.png"), "https asset.localhost must not go into innerHTML");

const blobHtml = previewImageHtml("image", "img/4a9802e1.png", blobSrc);
assert(!blobHtml.includes("blob:"), `blob URL leaked into HTML:\n${blobHtml}`);
assert(!blobHtml.includes("http://tauri.localhost"), `tauri blob host leaked into HTML:\n${blobHtml}`);
assert(!/\ssrc=/.test(blobHtml), `local image HTML must not include src:\n${blobHtml}`);
assert(blobHtml.includes('data-media-ref="img/4a9802e1.png"'), "local images keep a data-media-ref");
assert(blobHtml.startsWith("<img "), "local images should render as img tags");
assert(blobHtml.includes('alt="image"'), "alt text should stay on the tag");

const assetHtml = previewImageHtml("image", "img/4a9802e1.png", assetSrc);
assert(!assetHtml.includes("asset.localhost"), `asset URL leaked into HTML:\n${assetHtml}`);
assert(!/\ssrc=/.test(assetHtml), `asset URL must not be used as src in HTML:\n${assetHtml}`);
assert(assetHtml.includes('data-media-ref="img/4a9802e1.png"'), "asset tags still keep the markdown ref");

const remote = previewImageHtml("Markdown", "https://cdn.jsdelivr.net/logo.svg", "https://cdn.jsdelivr.net/logo.svg");
assert(remote.includes('src="https://cdn.jsdelivr.net/logo.svg"'), "https images pass through");
assert(!remote.includes("data-media-ref"), "remote images do not need a local ref");

const missing = previewImageHtml("image", "https://example.com/missing.png", null);
assert(missing.includes("image-ref"), "unresolved remote images stay as a placeholder");

console.log("verify-fixes: ok");
