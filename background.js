function mediaFallback(url, shortcode){
	const params = new URLSearchParams();
	params.set("size", "l");
	const imgIndex = url.searchParams.get("img_index");
	if (imgIndex){
		params.set("img_index", imgIndex);
	}
	return `${url.origin}/p/${shortcode}/media/?${params.toString()}`;
}

// Unescapes one level of JSON string escaping (\", \\, \/, \uXXXX -> real char).
function unescapeOnce(s){
	return s.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (match, hex, ch) => {
		return hex ? String.fromCharCode(parseInt(hex, 16)) : ch;
	});
}

// Instagram's /media/ redirect ignores img_index, so for carousel posts we
// pull the real per-slide image URLs from the (public, login-free) embed
// page instead and pick the one matching img_index. That data arrives
// nested a few levels deep as an escaped JSON string inside the page's JS,
// so we unescape repeatedly (a no-op once it's already clean) until the
// URLs read cleanly - a signed CDN URL breaks if even one escape level is
// left in place (e.g. "%3D" left escaped as "%" fails signature checks).
function extractDisplayUrl(html, imgIndex){
	const sidecarIdx = html.indexOf("edge_sidecar_to_children");
	let segment = sidecarIdx > -1 ? html.slice(sidecarIdx) : html;
	for (let i = 0; i < 4; i++){
		segment = unescapeOnce(segment);
	}

	const re = /"display_url":"(https:[^"]+?)"/g;
	const urls = [];
	let m;
	while ((m = re.exec(segment)) !== null){
		urls.push(m[1]);
	}
	if (urls.length === 0){
		return null;
	}
	const idx = Math.min(Math.max(imgIndex - 1, 0), urls.length - 1);
	return urls[idx];
}

async function resolveFullImage(link){
	console.log("resolving full image for: ", link);
	const url = new URL(link);
	const segments = url.pathname.split("/").filter(Boolean);
	const pIndex = segments.indexOf("p");
	if (pIndex === -1 || !segments[pIndex + 1]){
		return link;
	}
	const shortcode = segments[pIndex + 1];
	const imgIndex = parseInt(url.searchParams.get("img_index"), 10) || 1;
	const fallback = mediaFallback(url, shortcode);

	try{
		const res = await fetch(`${url.origin}/p/${shortcode}/embed/captioned/`);
		if (!res.ok){
			return fallback;
		}
		const html = await res.text();
		const displayUrl = extractDisplayUrl(html, imgIndex);
		return displayUrl || fallback;
	} catch (e){
		console.log("embed fetch failed, falling back to media redirect: ", e);
		return fallback;
	}
}

async function linkCallback(word){
	const pageUrl = word.pageUrl;
	const target = pageUrl && pageUrl.indexOf("/p/") != -1 ? pageUrl : word.linkUrl;
	const fullUrl = await resolveFullImage(target);
	console.log("full: ", fullUrl);
	chrome.tabs.create({url: fullUrl});
}

chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.create({
		id: "open-full-size",
		title: "Open Full Size",
		documentUrlPatterns: ["*://*.instagram.com/*"],
		contexts: ["link", "page"]
	});
});

chrome.contextMenus.onClicked.addListener(linkCallback);
