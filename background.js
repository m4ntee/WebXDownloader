// Listener used in the background to execute
// commands passed by parameter from the extension
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.fetchJson) {
        const headers = { headers: { "Accept": "application/json, text/plain, */*" } };
        if (request.password) headers.headers.accessPwd = request.password;
        else headers.headers.appFrom = "pb";

        fetch(request.fetchJson, headers)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                return response.json();
            })
            .then(response => sendResponse(response))
            .catch(_exception => sendResponse(null));
        return true;
    }

    if (request.fetchText) {
        fetch(request.fetchText)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                return response.text();
            })
            .then(response => sendResponse(response))
            .catch(_exception => sendResponse(null));
        return true;
    }

    if (request.safariOpenUrl) {
        chrome.tabs.create({ url: request.safariOpenUrl });
    }

    if (request.downloadURL && request.savepath) {
        chrome.downloads.download({
            url: request.downloadURL,
            filename: request.savepath
        });
    }
});

function reqWatcher(details) {
    if (!details.requestHeaders) return;

    // Find the detail containing the access password (case-insensitive)
    const result = details.requestHeaders.filter((e) => e.name.toLowerCase() === "accesspwd");

    if (result.length > 0) {
        const password = result[0].value;

        // Send directly to the tab that generated the request
        if (details.tabId && details.tabId !== -1) {
            chrome.tabs.sendMessage(details.tabId, { recPassword: password }).catch(() => {});
        } else {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs.length > 0) {
                    chrome.tabs.sendMessage(tabs[0].id, { recPassword: password }).catch(() => {});
                }
            });
        }
    }
}

chrome.webRequest.onSendHeaders.addListener(
    reqWatcher,
    { urls: ["*://*.webex.com/webappng/api/v1/recordings/*"] },
    ["requestHeaders", "extraHeaders"]
);