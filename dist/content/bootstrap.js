"use strict";
// Content entrypoint (classic script)
//
// NOTE: This file is injected via chrome.scripting.executeScript({ files: [...] }).
// It must remain compatible with classic-script execution.
(() => {
    try {
        AS.Controller.bootstrap();
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error('[ArticleSummarizer] Content bootstrap failed', err);
    }
})();
