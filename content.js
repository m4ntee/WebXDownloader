const REGEX = /^https?:\/\/(.+?)\.webex\.com\/(?:recordingservice|webappng)\/sites\/([^\/]+)\/.*?([a-f0-9]{32})[^\?]*(\?.*)?/;
const MATCH = REGEX.exec(location.href);

var PASSWORD;
var API_RESPONSE = -1;
var API_URL = null;

if (MATCH) {
    const SUBDOMAIN = MATCH[1];
    const RECORDING_ID = MATCH[3];
    const AUTH_PARAMS = MATCH[4];
    API_URL = `https://${SUBDOMAIN}.webex.com/webappng/api/v1/recordings/${RECORDING_ID}/stream`;
    if (AUTH_PARAMS) API_URL += AUTH_PARAMS;
}

/**
 * Create the download button to add to the Webex video page.
 */
function createDownloadButton(downloadURL, savepath) {
    const i = document.createElement("i");
    i.setAttribute("title", "Download");
    i.setAttribute("tabindex", "0");
    i.setAttribute("role", "button");
    i.setAttribute("id", "playerDownload");
    i.setAttribute("aria-label", `Download recording: ${savepath}`);
    i.classList.add("icon-download", "recordingDownload");

    const downloadMessage = {
        downloadURL: downloadURL,
        savepath: savepath
    };
    i.addEventListener("click", () => chrome.runtime.sendMessage(downloadMessage));
    i.addEventListener("keypress", () => chrome.runtime.sendMessage(downloadMessage));

    return i;
}

/**
 * Process a JSON-formatted response obtained from a WebEx page.
 */
function parseParametersFromResponse(response) {
    const streamOption = response["mp4StreamOption"] || {};
    const fallbackPlaySrc = response["fallbackPlaySrc"] || (response["downloadRecordingInfo"] && response["downloadRecordingInfo"]["downloadInfo"] && response["downloadRecordingInfo"]["downloadInfo"]["mp4URL"]);

    const host = streamOption["host"];
    const recordingDir = streamOption["recordingDir"];
    const timestamp = streamOption["timestamp"];
    const token = streamOption["token"];
    const xmlName = streamOption["xmlName"];
    const playbackOption = streamOption["playbackOption"];
    const recordName = response["recordName"] || "Webex_Recording";

    return {
        host,
        recordingDir,
        timestamp,
        token,
        xmlName,
        playbackOption,
        recordName,
        fallbackPlaySrc
    };
}

function sanitizeFilename(filename) {
    const allowedChars = /[^\w\s\d\-_~,;\[\]\(\).]/g;
    return filename.replaceAll(allowedChars, "_");
}

function fetchRecordingData() {
    if (!API_URL) return;

    chrome.runtime.sendMessage(
        {
            fetchJson: API_URL,
            password: PASSWORD
        },
        (response) => {
            if (!response || !response["mp4StreamOption"]) return;

            API_RESPONSE = response;
            const params = parseParametersFromResponse(response);
            addDownloadButtonToPage(params);
        }
    );
}

/**
 * Callback used by a MutationObserver object in a
 * WebEx page containing a registration to download.
 */
function mutationCallback(_mutationArray, observer) {
    const playButtons = document.getElementsByClassName("recordingTitle");
    if (!playButtons.length) return;

    observer.disconnect();
    fetchRecordingData();
}

/**
 * Add the download button to the video viewer bar.
 */
function addDownloadButtonToPage(params) {
    const downloadButtons = document.getElementsByClassName("icon-download");
    if (downloadButtons.length || !params.fallbackPlaySrc) return;

    const savename = `${sanitizeFilename(params.recordName)}.mp4`;
    const downloadURL = params.fallbackPlaySrc;
    const downloadButton = createDownloadButton(downloadURL.toString(), savename);

    const titleDivs = document.getElementsByClassName("recordingHeader");
    if (titleDivs.length > 0) {
        titleDivs[0].appendChild(downloadButton);
    }
}

// Add a listener used to receive the password for the WebEx account
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.recPassword) {
        PASSWORD = request.recPassword;
        // If the initial fetch failed because the password arrived late, retry now
        if (API_RESPONSE === -1 || !API_RESPONSE) {
            fetchRecordingData();
        }
    }
    if (request.apiResponse) {
        sendResponse(API_RESPONSE);
    }
});

// Start observing only if we are on a valid recording URL
if (MATCH && document.body) {
    const observer = new MutationObserver(mutationCallback);
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}