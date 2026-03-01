// test/verify-script-loads.js

async function verifyScriptLoads() {
    const scripts = [];
    const loadResults = [];

    // Fetch the colorado-deep-dive.html file
    const response = await fetch('colorado-deep-dive.html');
    const htmlText = await response.text();

    // Create a DOM parser to extract script tags
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const scriptTags = doc.querySelectorAll('script[src]');

    for (const script of scriptTags) {
        const scriptUrl = script.src;
        const startTime = performance.now();

        try {
            const loadResponse = await fetch(scriptUrl);
            const endTime = performance.now();
            const loadTime = endTime - startTime;

            if (loadResponse.ok) {
                loadResults.push({
                    url: scriptUrl,
                    status: loadResponse.status,
                    loadTime: loadTime.toFixed(2) + ' ms'
                });
            } else {
                loadResults.push({
                    url: scriptUrl,
                    status: loadResponse.status,
                    error: 'Failed to load'
                });
            }
        } catch (error) {
            loadResults.push({
                url: scriptUrl,
                error: 'Loading error'
            });
        }
    }

    return loadResults;
}

verifyScriptLoads().then(results => {
    console.table(results);
    results.forEach(result => {
        if (result.error) {
            alert(`Error loading ${result.url}: ${result.error}`);
        }
    });
});
