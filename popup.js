const REGEX = /^https?:\/\/(.+?)\.webex\.com\/(?:recordingservice|webappng)\/sites\/([^\/]+)\/.*?([a-f0-9]{32})[^\?]*(\?.*)?/;
const UPDATE_URL = "https://api.github.com/repos/jacopo-j/webxdownloader/releases/latest";

function copyLink() {
    let text = document.getElementById("content");
    text.disabled = false;
    text.select();
    document.execCommand("copy");
    text.blur();
    text.disabled = true;
}

function downloadChat() {
    let download = document.getElementById("download");
    let link = document.createElement("a");
    let title = document.getElementById("content").dataset.title;
    if (document.getElementById("chat-opt").checked) {
        link.download = `${title}_chat.txt`;
        let chatData = JSON.parse(download.dataset.content);
        let out = [];
        for (let i = 0; i < chatData.length; i++) {
            let m = chatData[i];
            out.push(`${m.timecode} - ${m.name}\n${m.message}`);
        }
        let file = out.join("\n\n") + "\n";
        link.href = `data:application/octet-stream;charset=utf-8,${encodeURIComponent(file)}`;
    } else if (document.getElementById("json-opt").checked) {
        link.download = `${title}_chat.json`;
        link.href = `data:application/octet-stream;charset=utf-8,${encodeURIComponent(download.dataset.content)}`;
    }
    link.click();
    if (navigator.userAgent.indexOf("Safari") > -1) {
        chrome.runtime.sendMessage({ safariOpenUrl: link.href });
    }
}

function renderSuccess(title, url, chat) {
    document.getElementById("loading").style.display = "none";
    document.getElementById("success").style.display = "block";
    document.getElementById("content").innerText = url;
    document.getElementById("content").dataset.content = url;
    document.getElementById("content").dataset.title = title;
    document.getElementById("copy").onclick = copyLink;
    if (chat && chat.length > 0) {
        document.getElementById("chat").style.display = "block";
        document.getElementById("download").dataset.content = JSON.stringify(chat);
        document.getElementById("download").onclick = downloadChat;
    }
}

function renderFailure() {
    document.getElementById("loading").style.display = "none";
    document.getElementById("errpage").style.display = "block";
}

function renderException(exception) {
    document.body.classList.add("fail");
    document.getElementById("loading").style.display = "none";
    document.getElementById("fail").style.display = "block";
    document.getElementById("error-message").textContent = exception.message || "Unknown error";
}

function checkUpdates() {
    fetch(UPDATE_URL)
        .then(response => response.json())
        .then(data => {
            const latestVersion = data.tag_name;
            const currentVersion = chrome.runtime.getManifest().version;

            if (latestVersion && latestVersion != currentVersion) {
                document.getElementById("updates-available").style.display = "block";

                if (navigator.userAgent.indexOf("Safari") > -1) {
                    const updateButton = document.getElementById("updates-link");
                    updateButton.addEventListener("click", (_event) => {
                        const url = document.getElementById("updates-link").getAttribute("href");
                        chrome.runtime.sendMessage({ safariOpenUrl: url });
                    });
                }
            }
        })
        .catch(() => {});
}

function timeCode(absTime) {
    const date = new Date(parseInt(absTime));
    const hour = ("0" + date.getHours()).slice(-2);
    const minute = ("0" + date.getMinutes()).slice(-2);
    const second = ("0" + date.getSeconds()).slice(-2);
    return `${hour}:${minute}:${second}`;
}

function parseParametersFromResponse(response) {
    const streamOption = response["mp4StreamOption"] || {};

    const host = streamOption["host"];
    const recordingDir = streamOption["recordingDir"];
    const timestamp = streamOption["timestamp"];
    const token = streamOption["token"];
    const xmlName = streamOption["xmlName"];
    const playbackOption = streamOption["playbackOption"];
    const siteid = streamOption["siteid"];
    const recordid = streamOption["recordid"];
    const islogin = streamOption["islogin"];
    const isprevent = streamOption["isprevent"];
    const ispwd = streamOption["ispwd"];

    const hlsUrl = response["downloadRecordingInfo"]?.["downloadInfo"]?.["hlsURL"];

    return {
        host,
        recordingDir,
        timestamp,
        token,
        xmlName,
        playbackOption,
        siteid,
        recordid,
        islogin,
        isprevent,
        ispwd,
        hlsUrl
    };
}

function composeStreamURL(params) {
    if (params["recordingDir"] !== undefined) {
        const url = new URL("apis/html5-pipeline.do", params.host);
        url.searchParams.set("recordingDir", params.recordingDir);
        url.searchParams.set("timestamp", params.timestamp);
        url.searchParams.set("token", params.token);
        url.searchParams.set("xmlName", params.xmlName);
        url.searchParams.set("isMobileOrTablet", "false");
        url.searchParams.set("ext", params.playbackOption);

        return url;
    } else if (params["siteid"] !== undefined) {
        const url = new URL("nbr/MultiThreadDownloadServlet/recording.xml", params.host);
        url.searchParams.set("siteid", params.siteid);
        url.searchParams.set("recordid", params.recordid);
        url.searchParams.set("ticket", params.token);
        url.searchParams.set("timestamp", params.timestamp);
        url.searchParams.set("islogin", params.islogin);
        url.searchParams.set("isprevent", params.isprevent);
        url.searchParams.set("ispwd", params.ispwd);
        url.searchParams.set("play", "1");

        return url;
    }

    return null;
}

function checkResponseForErrors(response) {
    let validResponse = true;

    if (chrome.runtime.lastError) {
        console.log(chrome.runtime.lastError);
        renderFailure();
        validResponse = false;
    } else if (response == -1) {
        renderFailure();
        validResponse = false;
    } else if (!response) {
        renderException(new Error("Received null response"));
        validResponse = false;
    }

    return validResponse;
}

function isThisAWebExPage(url) {
    if (!url) {
        renderFailure();
        return false;
    }
    const match = REGEX.exec(url);
    if (!match) renderFailure();
    return match !== null;
}

function callback(tabs) {
    checkUpdates();

    if (!tabs || !tabs.length || !isThisAWebExPage(tabs[0].url)) return;

    chrome.tabs.sendMessage(tabs[0].id, { apiResponse: true }, (response) => {
        if (!checkResponseForErrors(response)) return;

        try {
            const params = parseParametersFromResponse(response);
            const streamURL = composeStreamURL(params);

            if (streamURL === null) {
                renderException({ message: "Stream URL is null" });
                return;
            }

            // Fetch XML via background service worker to avoid CORS issues
            chrome.runtime.sendMessage({ fetchText: streamURL.toString() }, (text) => {
                if (!text) {
                    // Fallback if XML stream is unreachable but hlsUrl is already available
                    if (params.hlsUrl) {
                        renderSuccess(response["recordName"], params.hlsUrl, []);
                    } else {
                        renderException(new Error("Failed to fetch stream XML"));
                    }
                    return;
                }

                try {
                    const data = (new window.DOMParser()).parseFromString(text, "text/xml");
                    const messages = [...data.getElementsByTagName("Message")];

                    const chat = messages.map((message) => {
                        const datetimeElement = message.getElementsByTagName("DateTimeUTC");
                        const nameElement = message.getElementsByTagName("LoginName");
                        const messageElement = message.getElementsByTagName("Content");

                        return {
                            "timecode": datetimeElement.length > 0 ? timeCode(datetimeElement[0].textContent) : "00:00:00",
                            "name": nameElement.length > 0 ? nameElement[0].textContent : "Name unavailable",
                            "message": messageElement.length > 0 ? messageElement[0].textContent : "Message unavailable",
                        };
                    });

                    let hlsUrl = params.hlsUrl;
                    if (hlsUrl === undefined) {
                        const seq = data.getElementsByTagName("Sequence");
                        if (seq.length > 0) {
                            const filename = seq[0].textContent;
                            hlsUrl = `${params.host}/hls-vod/recordingDir/${params.recordingDir}/timestamp/${params.timestamp}/token/${params.token}/fileName/${filename}.m3u8`;
                        }
                    }

                    const meetingName = response["recordName"];
                    renderSuccess(meetingName, hlsUrl, chat);
                } catch (ex) {
                    renderException(ex);
                }
            });
        } catch (ex) {
            renderException(ex);
        }
    });
}

const query = { active: true, currentWindow: true };
chrome.tabs.query(query, callback);